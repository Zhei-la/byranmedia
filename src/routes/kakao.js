const express = require('express');
const crypto = require('crypto');
const db = require('../db');

const router = express.Router();

const KEY = process.env.KAKAO_REST_API_KEY || '';
const SECRET = process.env.KAKAO_CLIENT_SECRET || '';

/** 카카오 로그인을 쓸 수 있는 상태인지. 키가 없으면 버튼 자체를 숨긴다. */
function kakaoReady() {
  return Boolean(KEY);
}

/** 콜백 주소. 카카오 개발자 화면에 등록한 값과 글자 하나까지 같아야 한다. */
function redirectUri(req) {
  if (process.env.KAKAO_REDIRECT_URI) return process.env.KAKAO_REDIRECT_URI;
  const base = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  return `${base.replace(/\/$/, '')}/auth/kakao/callback`;
}

/* ---------------- 카카오로 보내기 ---------------- */
router.get('/auth/kakao', (req, res) => {
  if (!kakaoReady()) {
    return res.status(503).render('error', {
      title: '카카오 로그인 준비 중',
      message: '카카오 로그인이 아직 설정되지 않았습니다. 이메일로 로그인해 주세요.',
    });
  }

  // 요청을 위조당하지 않도록 임의의 값을 만들어 세션에 넣어둔다.
  const state = crypto.randomBytes(16).toString('hex');
  req.session.kakaoState = state;

  const url = new URL('https://kauth.kakao.com/oauth/authorize');
  url.searchParams.set('client_id', KEY);
  url.searchParams.set('redirect_uri', redirectUri(req));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);

  res.redirect(url.toString());
});

/* ---------------- 카카오에서 돌아옴 ---------------- */
router.get('/auth/kakao/callback', async (req, res) => {
  const fail = (msg) =>
    res.status(400).render('error', { title: '카카오 로그인 실패', message: msg });

  if (!kakaoReady()) return fail('카카오 로그인이 설정되지 않았습니다.');

  if (req.query.error) {
    return fail('카카오 로그인을 취소했거나 동의하지 않았습니다.');
  }

  const { code, state } = req.query;
  if (!code) return fail('인증 정보를 받지 못했습니다. 다시 시도해 주세요.');

  const saved = req.session.kakaoState;
  delete req.session.kakaoState;
  if (!saved || saved !== state) {
    return fail('로그인 요청이 만료됐습니다. 처음부터 다시 시도해 주세요.');
  }

  try {
    // 1) 인증 코드를 토큰으로 바꾼다
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: KEY,
      redirect_uri: redirectUri(req),
      code: String(code),
    });
    if (SECRET) body.set('client_secret', SECRET);

    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body,
    });
    const token = await tokenRes.json();
    if (!tokenRes.ok || !token.access_token) {
      console.error('[카카오 토큰]', token);
      return fail('카카오 인증에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    }

    // 2) 토큰으로 사용자 정보를 받아온다
    const meRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    const me = await meRes.json();
    if (!meRes.ok || !me.id) {
      console.error('[카카오 사용자]', me);
      return fail('카카오 계정 정보를 가져오지 못했습니다.');
    }

    const kakaoId = String(me.id);
    const acc = me.kakao_account || {};
    // 이메일과 닉네임은 사용자가 동의하지 않으면 오지 않는다
    const email = acc.email ? String(acc.email).toLowerCase() : null;
    const nick =
      (acc.profile && acc.profile.nickname) ||
      (me.properties && me.properties.nickname) ||
      '카카오 사용자';

    // 3) 이미 연결된 계정이 있는지 본다
    let { rows } = await db.query(`SELECT id, status FROM users WHERE kakao_id = $1`, [kakaoId]);

    // 4) 없으면, 같은 이메일의 기존 계정에 연결해 준다
    if (rows.length === 0 && email) {
      const found = await db.query(`SELECT id, status FROM users WHERE email = $1`, [email]);
      if (found.rows.length) {
        await db.query(`UPDATE users SET kakao_id = $1 WHERE id = $2`, [kakaoId, found.rows[0].id]);
        rows = found.rows;
      }
    }

    // 5) 그래도 없으면 새로 만든다. 승인 전까지는 도구를 쓸 수 없다.
    if (rows.length === 0) {
      const created = await db.query(
        `INSERT INTO users (email, password_hash, name, kakao_id, provider, status)
         VALUES ($1, NULL, $2, $3, 'kakao', 'pending') RETURNING id, status`,
        [email, nick, kakaoId]
      );
      rows = created.rows;
    }

    const user = rows[0];
    req.session.regenerate((err) => {
      if (err) return fail('로그인 처리 중 문제가 생겼습니다.');
      req.session.userId = user.id;
      db.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]).catch(() => {});
      res.redirect(user.status === 'active' ? '/hub' : '/pending');
    });
  } catch (e) {
    console.error('[카카오 콜백]', e);
    fail('카카오 서버와 통신하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
});

module.exports = router;
module.exports.kakaoReady = kakaoReady;
