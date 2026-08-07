const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { ensureCode, findByCode } = require('../referral');

const router = express.Router();

/** 복사할 때 딸려오는 공백이나 따옴표를 걷어낸다 */
function clean(v) {
  return String(v || '').trim().replace(/^["']|["']$/g, '');
}

const KEY = clean(process.env.KAKAO_REST_API_KEY);
const SECRET = clean(process.env.KAKAO_CLIENT_SECRET);

/** 카카오 로그인을 쓸 수 있는 상태인지. 키가 없으면 버튼 자체를 숨긴다. */
function kakaoReady() {
  return Boolean(KEY);
}

/** 콜백 주소. 카카오 개발자 화면에 등록한 값과 글자 하나까지 같아야 한다. */
function redirectUri(req) {
  const fixed = clean(process.env.KAKAO_REDIRECT_URI);
  if (fixed) return fixed;
  const base = clean(process.env.BASE_URL) || `${req.protocol}://${req.get('host')}`;
  return `${base.replace(/\/+$/, '')}/auth/kakao/callback`;
}

/* ---------------- 카카오로 보내기 ---------------- */
router.get(['/auth/kakao'], (req, res) => {
  if (!kakaoReady()) {
    return res.status(503).render('error', {
      title: '카카오 로그인 준비 중',
      message: '카카오 로그인이 아직 설정되지 않았습니다. 이메일로 로그인해 주세요.',
    });
  }

  // 요청을 위조당하지 않도록 임의의 값을 만들어 세션에 넣어둔다.
  const state = crypto.randomBytes(16).toString('hex');
  req.session.kakaoState = state;

  // 카카오에 다녀오는 동안 추천 코드를 기억해 둔다
  const ref = String(req.query.ref || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  req.session.refCode = ref ? ref.slice(0, 12) : null;

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
      console.error('[카카오 진단] 보낸 redirect_uri =', JSON.stringify(redirectUri(req)));
      console.error('[카카오 진단] 키 길이 =', KEY.length, '| 앞 6자 =', KEY.slice(0, 6),
                    '| 앞뒤 공백 =', KEY !== KEY.trim());
      console.error('[카카오 진단] client_secret 사용 =', SECRET ? '예' : '아니오');
      console.error('[카카오 진단] BASE_URL =', JSON.stringify(process.env.BASE_URL || '(없음)'));
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
    const isNew = rows.length === 0;
    let linkedByRef = false;
    if (isNew) {
      // 추천 코드는 새로 가입할 때만 반영한다
      let referredBy = null;
      const refCode = req.session.refCode;
      if (refCode) {
        const owner = await findByCode(refCode);
        if (owner) {
          referredBy = owner.id;
          linkedByRef = true;
        }
      }
      let created;
      try {
        created = await db.query(
          `INSERT INTO users (email, password_hash, name, kakao_id, provider, status, referred_by)
           VALUES ($1, NULL, $2, $3, 'kakao', 'pending', $4) RETURNING id, status`,
          [email, nick, kakaoId, referredBy]
        );
      } catch (e) {
        if (e.code !== '42703') throw e;
        // 추천 컬럼이 아직 없는 데이터베이스
        created = await db.query(
          `INSERT INTO users (email, password_hash, name, kakao_id, provider, status)
           VALUES ($1, NULL, $2, $3, 'kakao', 'pending') RETURNING id, status`,
          [email, nick, kakaoId]
        );
      }
      rows = created.rows;
    }
    delete req.session.refCode;

    let user = rows[0];

    // 운영자 본인 계정은 자동으로 관리자로 만든다.
    // 카카오만으로 로그인하는 구조라 이 장치가 없으면 아무도 승인할 수 없다.
    const adminKakao = (process.env.ADMIN_KAKAO_ID || '').trim();
    const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const isOwner =
      (adminKakao && adminKakao === kakaoId) || (adminEmail && email && adminEmail === email);
    if (isOwner) {
      const up = await db.query(
        `UPDATE users SET role='admin', status='active'
          WHERE id=$1 RETURNING id, status`,
        [user.id]
      );
      user = up.rows[0];
    }

    await ensureCode(user.id);

    req.session.regenerate((err) => {
      if (err) return fail('로그인 처리 중 문제가 생겼습니다.');
      req.session.userId = user.id;
      db.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]).catch(() => {});
      // 막 가입한 사람에게는 추천인을 물어본다. 링크로 이미 연결됐으면 건너뛴다.
      if (user.status === 'active') return res.redirect('/hub');
      if (isNew && !linkedByRef) return res.redirect('/welcome');
      res.redirect('/pending');
    });
  } catch (e) {
    console.error('[카카오 콜백]', e);
    fail('카카오 서버와 통신하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
});

module.exports = router;
module.exports.kakaoReady = kakaoReady;
