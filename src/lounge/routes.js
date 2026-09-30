/* 바이란 라운지: 회원 화면 */
const express = require('express');
const db = require('../db');
const L = require('./core');
const T = require('./translate');
const P = require('./points');
const E = require('./enroll');
const V = require('./visits');

const router = express.Router();

// async 함수에서 난 오류가 서버를 멈추지 않고 오류 화면으로 가도록 감싼다
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const get = (p, ...h) => router.get(p, ...h.map(wrap));
const post = (p, ...h) => router.post(p, ...h.map(wrap));

/* ---------------- 공통 ---------------- */
const LOUNGE_PATHS = ['/member', '/community', '/library', '/reviews', '/course', '/store', '/challenge', '/my', '/consult', '/onboard', '/prompts', '/agency'];

// 라운지 화면마다 필요한 값
async function locals(req, res, next) {
  try {
    res.locals.L = L;
    res.locals.S = await L.settings();
    res.locals.active = '';
    res.locals.flash = req.session ? req.session.flash || null : null;
    if (req.session && req.session.flash) delete req.session.flash;
    res.locals.me = req.user && req.user.nickname ? { nick: req.user.nickname } : null;
    res.locals.nick = req.user ? req.user.nickname || req.user.name : '';
    res.locals.P = P;
    res.locals.pts = req.user && req.user.nickname ? await P.balance(req.user.id) : null;
    res.locals.student = req.user && req.user.nickname ? await E.isStudent(req.user.id) : false;
    res.locals.soon = L.soonOf(res.locals.S, req.user);
    res.locals.chatBan = banned(req, 'chat');
    res.locals.writeBan = banned(req, 'write');
    // 내가 공유한 프롬프트에 운영자 수정 요청이 있으면 위쪽에 알림
    res.locals.fixCount = req.user && req.user.nickname
      ? (await db.query(`SELECT count(*)::int AS n FROM lounge_prompts WHERE user_id=$1 AND status='fix'`, [req.user.id])).rows[0].n
      : 0;
    // 아직 준비 안 된 곳은 들어가지 않고 이전 화면으로
    if (req.method === 'GET' && L.soonBlocked(res.locals.soon, req.originalUrl.split('?')[0])) {
      if (req.session) req.session.flash = SOON_MSG;
      let to = back(req, '/');
      if (L.soonBlocked(res.locals.soon, to.split('?')[0])) to = '/';
      return res.redirect(to);
    }
  } catch (e) {
    console.error('[라운지 공통]', e.message);
    res.locals.soon = res.locals.soon || {};
  }
  next();
}
const SOON_MSG = '준비중입니다. 조금만 기다려 주세요 🙏';
router.use([/^\/$/, ...LOUNGE_PATHS.map((p) => new RegExp('^' + p + '(?=/|$)'))], locals);

function flash(req, msg) {
  req.session.flash = msg;
}
function back(req, fallback = '/') {
  const r = req.get('referer') || '';
  try {
    const u = new URL(r);
    if (u.host === req.get('host')) return u.pathname + u.search;
  } catch (e) {}
  return fallback;
}
function safeNext(v) {
  const s = String(v || '');
  return s.startsWith('/') && !s.startsWith('//') ? s : '';
}
const wantsJson = (req) => (req.get('accept') || '').includes('json');

/** 제재 중인지: 'chat' | 'write' → 끝나는 날 글자 또는 null */
function banned(req, kind) {
  const u = req.user;
  if (!u || u.role === 'admin') return null;
  const until = kind === 'write' ? u.write_ban_until : u.chat_ban_until;
  if (!until || new Date(until) <= new Date()) return null;
  const d = new Date(until);
  return d.getFullYear() > new Date().getFullYear() + 50 ? '무기한' : d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', timeZone: 'Asia/Seoul' }) + '까지';
}

/** 로그인 + 닉네임 설정까지 끝난 회원 */
function member(req, res, next) {
  if (!req.user) {
    if (req.method === 'GET') return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    if (wantsJson(req)) return res.status(401).json({ error: '로그인이 필요해요.' });
    return res.redirect(`/login?next=${encodeURIComponent(back(req))}`);
  }
  if (req.user.status === 'suspended') {
    return res.status(403).render('error', { title: '이용이 중지된 계정', message: '문의가 필요하면 카카오톡 채널로 연락해 주세요.' });
  }
  if (!req.user.nickname) {
    if (req.method === 'GET') return res.redirect(`/onboard?next=${encodeURIComponent(req.originalUrl)}`);
    if (wantsJson(req)) return res.status(403).json({ error: '먼저 닉네임을 정해 주세요.' });
    flash(req, '먼저 닉네임을 정해 주세요.');
    return res.redirect('/onboard');
  }
  next();
}
const isAdmin = (req) => req.user && req.user.role === 'admin';

/* ---------------- 홈 ---------------- */
get('/', async (req, res) => {
  const q = (sql, p) => db.query(sql, p).then((r) => r.rows).catch((e) => { console.error('[홈]', e.message); return []; });

  const [results, board, chat, sections, reviews, cohort, prompts, courses] = await Promise.all([
    q(`SELECT r.id, r.kind, r.headline, r.channel, r.image_id, COALESCE(u.nickname,u.name) AS nick
         FROM lounge_results r JOIN users u ON u.id=r.user_id
        WHERE r.is_hidden=false ORDER BY r.created_at DESC LIMIT 12`),
    q(`SELECT p.id, p.category, p.title, p.is_pinned, p.views, p.created_at, p.user_id, p.prompt_id,
              COALESCE(u.nickname, u.name, p.guest_name, '손님') AS nick, u.role,
              (SELECT count(*) FROM lounge_comments c WHERE c.post_id=p.id AND c.is_hidden=false)::int AS comments
         FROM lounge_posts p LEFT JOIN users u ON u.id=p.user_id
        WHERE p.is_hidden=false AND p.category IN ('request','proof')
        ORDER BY p.created_at DESC LIMIT 8`),
    q(`SELECT c.id, c.body, c.created_at, COALESCE(u.nickname,u.name) AS nick, u.role
         FROM lounge_chat c JOIN users u ON u.id=c.user_id
        WHERE c.is_hidden=false ORDER BY c.id DESC LIMIT 6`),
    q(`SELECT section, count(*)::int AS n, bool_or(access='code') AS has_code, bool_or(access='points') AS has_points, min(sort_order) AS so
         FROM lounge_resources WHERE is_active=true GROUP BY section ORDER BY so, section`),
    q(`SELECT r.id, r.rating, r.body, r.industry, COALESCE(r.author_name, u.nickname, u.name) AS nick, p.title AS product
         FROM lounge_reviews r LEFT JOIN users u ON u.id=r.user_id LEFT JOIN lounge_products p ON p.id=r.product_id
        WHERE r.status='approved' ORDER BY r.approved_at DESC NULLS LAST, r.id DESC LIMIT 6`),
    q(`SELECT id, name, title, start_date, days, status FROM lounge_cohorts
        WHERE status IN ('recruiting','running') ORDER BY start_date DESC LIMIT 1`),
    q(`SELECT id, title, category, image_ids FROM lounge_prompts
        WHERE is_active=true AND status='live' AND user_id IS NULL AND cardinality(image_ids) > 0 ORDER BY created_at DESC LIMIT 8`),
    q(`SELECT id, title, subtitle, price_text, list_price, price_note, badge, ptype FROM lounge_products WHERE is_active=true ORDER BY sort_order, id LIMIT 3`).then(E.priced),
  ]);

  const todayViews = await V.publicToday().catch(() => 0);
  res.render('lounge/home', {
    title: '', active: 'home', todayViews,
    results, board, chat: chat.reverse(), sections, reviews, cohort: cohort[0] || null, prompts, courses,
    ogT: '바이란 라운지 · AI로 시작하는 1인 창업 커뮤니티',
    ogD: '무료 자료집, AI 프롬프트, 같이 성장하는 커뮤니티. 카카오로 3초면 시작해요.',
  });
});

/* ---------------- 닉네임 설정 (첫 방문) ---------------- */
get('/onboard', (req, res) => {
  if (!req.user) return res.redirect('/login');
  if (req.user.nickname && !req.query.edit) return res.redirect(safeNext(req.query.next) || '/');
  res.render('lounge/onboard', {
    title: '프로필 설정', error: null,
    form: { nickname: req.user.nickname || '', interest: req.user.interest || '', country: req.user.country || L.guessCountry(req.get('accept-language')) },
    next: safeNext(req.query.next) || '',
  });
});

post('/onboard', async (req, res) => {
  if (!req.user) return res.redirect('/login');
  const nextUrl = safeNext(req.body.next) || '';
  const form = { nickname: String(req.body.nickname || ''), interest: String(req.body.interest || ''), country: String(req.body.country || '').toUpperCase() };
  const fail = (msg) => res.status(400).render('lounge/onboard', { title: '프로필 설정', error: msg, form, next: nextUrl });

  const chk = L.checkNick(form.nickname, { admin: isAdmin(req) });
  if (!chk.ok) return fail(chk.msg);
  const interest = L.INTERESTS.includes(form.interest) ? form.interest : null;
  if (!L.COUNTRY[form.country]) return fail('나라를 골라 주세요. (Please choose your country)');
  const first = !req.user.nickname;
  // 프로필 사진: 새로 올렸으면 저장, '사진 지우기'면 비움
  let avatarId = req.user.avatar_id || null;
  if (req.body.avatar_remove === '1') avatarId = null;
  if (req.body.avatar) {
    const id = await L.saveImage(req.user.id, req.body.avatar).catch(() => null);
    if (id) avatarId = id;
  }
  try {
    await db.query(
      `UPDATE users SET nickname=$1, interest=$2, country=$3, avatar_id=$4, lounge_at=COALESCE(lounge_at, now()),
              source=COALESCE(source, $6) WHERE id=$5`,
      [chk.value, interest, form.country, avatarId, req.user.id, V.SOURCES[V.readCookie(req, 'bsrc')] ? V.readCookie(req, 'bsrc') : 'direct']
    );
  } catch (e) {
    if (e.code === '23505') return fail('이미 누가 쓰고 있는 닉네임이에요.');
    throw e;
  }
  const libSoon = (res.locals.soon || {}).library;
  flash(req, first ? (libSoon ? `환영해요, ${chk.value}님! 채팅에서 인사 남기거나 원하는 프롬프트를 요청해 보세요 👋` : `환영해요, ${chk.value}님! 자료실에서 무료 자료집부터 챙겨 가세요 🎁`) : '프로필을 바꿨어요.');
  let to = nextUrl || (first ? (libSoon ? '/' : '/library') : '/my');
  if (L.soonBlocked(res.locals.soon || {}, to.split('?')[0].split('#')[0])) to = '/';
  res.redirect(to);
});

/* ---------------- 커뮤니티 ---------------- */
const PAGE = 15;

// 커뮤니티는 세 칸만: 채팅 · 프롬프트 요청 · 인증
const CTABS = ['chat', 'request', 'proof'];
get('/community', async (req, res) => {
  const cat = CTABS.includes(req.query.cat) ? req.query.cat : 'chat';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  let posts = [], total = 0, chat = [];
  if (cat === 'chat') {
    const r = await db.query(
      `SELECT c.id, c.body, c.created_at, COALESCE(u.nickname,u.name) AS nick, u.role
         FROM lounge_chat c JOIN users u ON u.id=c.user_id
        WHERE c.is_hidden=false ORDER BY c.id DESC LIMIT 60`
    );
    chat = r.rows.reverse();
  } else {
    const { rows: cnt } = await db.query(`SELECT count(*)::int AS n FROM lounge_posts WHERE is_hidden=false AND category=$1`, [cat]);
    total = cnt[0].n;
    const r = await db.query(
      `SELECT p.id, p.category, p.title, p.views, p.created_at, p.user_id, p.image_id, p.prompt_id,
              COALESCE(u.nickname, u.name, p.guest_name, '손님') AS nick, u.role, p.user_id IS NULL AS guest, u.avatar_id, u.country,
              (SELECT count(*) FROM lounge_likes l WHERE l.post_id=p.id)::int AS likes,
              (SELECT count(*) FROM lounge_comments c WHERE c.post_id=p.id AND c.is_hidden=false)::int AS comments
         FROM lounge_posts p LEFT JOIN users u ON u.id=p.user_id
        WHERE p.is_hidden=false AND p.category=$1
        ORDER BY p.created_at DESC LIMIT $2 OFFSET $3`,
      [cat, PAGE, (page - 1) * PAGE]
    );
    posts = r.rows;
  }
  res.render('lounge/community', {
    title: '커뮤니티', active: 'community', cat, page, posts, chat,
    pages: Math.max(1, Math.ceil(total / PAGE)), total,
    write: req.query.write === '1',
  });
});

// 프롬프트 요청은 로그인 없이도, 나머지는 회원만
function memberOrGuestRequest(req, res, next) {
  if (!req.user && req.body.category === 'request') return next();
  return member(req, res, next);
}

post('/community', memberOrGuestRequest, async (req, res) => {
  const category = req.body.category === 'request' ? 'request' : 'proof';
  const wb = banned(req, 'write');
  if (wb) { flash(req, `운영자가 글쓰기를 막아 뒀어요 (${wb}).`); return res.redirect(`/community?cat=${category}`); }
  const title = String(req.body.title || '').trim().slice(0, 120);
  const body = String(req.body.body || '').trim().slice(0, 5000);
  const backTo = `/community?cat=${category}&write=1#write`;
  if (!title || !body) {
    flash(req, '제목과 내용을 모두 적어 주세요.');
    return res.redirect(backTo);
  }

  // 로그인 없이 남기는 프롬프트 요청
  if (!req.user) {
    if (req.body.website) return res.redirect('/community?cat=request'); // 자동 등록 봇 걸러내기 (보이지 않는 칸)
    const ip = String(req.ip || '').slice(0, 64);
    const { rows: rc } = await db.query(
      `SELECT count(*) FILTER (WHERE created_at > now() - interval '10 minutes')::int AS m10,
              count(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS d1
         FROM lounge_posts WHERE guest_ip=$1`,
      [ip]
    );
    if (rc[0].m10 >= 3 || rc[0].d1 >= 10) {
      flash(req, '요청을 너무 많이 남겼어요. 잠시 후 다시 남겨 주세요.');
      return res.redirect('/community?cat=request');
    }
    const name = String(req.body.guest_name || '').trim().replace(/\s+/g, ' ').slice(0, 20) || null;
    if (name && !L.checkNick(name.slice(0, 10)).ok) {
      flash(req, '이름에 쓸 수 없는 단어가 있어요. 비워 두셔도 돼요.');
      return res.redirect(backTo);
    }
    const { rows } = await db.query(
      `INSERT INTO lounge_posts (user_id, category, title, body, guest_name, guest_ip)
       VALUES (NULL, 'request', $1, $2, $3, $4) RETURNING id`,
      [title, body, name, ip]
    );
    flash(req, '요청을 남겼어요! 프롬프트가 올라오면 이 글에서 확인할 수 있어요. 주소를 저장해 두세요 🙏');
    return res.redirect(`/community/${rows[0].id}`);
  }

  // 도배 방지: 1분에 3개까지
  const { rows: rc } = await db.query(
    `SELECT count(*)::int AS n FROM lounge_posts WHERE user_id=$1 AND created_at > now() - interval '1 minute'`,
    [req.user.id]
  );
  if (rc[0].n >= 3 && !isAdmin(req)) {
    flash(req, '글을 너무 빨리 올리고 있어요. 잠시 후 다시 올려 주세요.');
    return res.redirect(`/community?cat=${category}`);
  }
  const imageId = req.body.image ? await L.saveImage(req.user.id, req.body.image) : null;
  const { rows } = await db.query(
    `INSERT INTO lounge_posts (user_id, category, title, body, image_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [req.user.id, category, title, body, imageId]
  );
  let got = 0;
  const r = await P.rules();
  if (body.length >= r.postMin) got = await P.earn(req.user.id, 'post', rows[0].id);
  if (got) flash(req, `글을 올렸어요. +${got}P 적립! 💎`);
  else if (body.length < r.postMin) flash(req, `글을 올렸어요. (내용이 ${r.postMin}자 이상이면 포인트가 쌓여요)`);
  else flash(req, `글을 올렸어요. 오늘 글 포인트는 다 받았어요 (하루 ${r.postDaily}개까지).`);
  res.redirect(`/community/${rows[0].id}`);
});

async function loadPost(id) {
  const { rows } = await db.query(
    `SELECT p.*, COALESCE(u.nickname, u.name, p.guest_name, '손님') AS nick, u.role, u.avatar_id, u.country,
            (SELECT count(*) FROM lounge_likes l WHERE l.post_id=p.id)::int AS likes
       FROM lounge_posts p LEFT JOIN users u ON u.id=p.user_id WHERE p.id=$1`,
    [id]
  );
  return rows[0] || null;
}
const canSee = (req, p) => !p.is_hidden && (p.category !== 'secret' || (req.user && (req.user.id === p.user_id || isAdmin(req))));

get('/community/:id(\\d+)', async (req, res) => {
  const p = await loadPost(req.params.id);
  if (!p || (p.is_hidden && !isAdmin(req))) {
    return res.status(404).render('error', { title: '없는 글', message: '지워졌거나 없는 글이에요.' });
  }
  const locked = !canSee(req, p) && !isAdmin(req);
  if (!locked) V.countView('c', 'lounge_posts', p.id, req); // 하루에 기기 1대당 1번
  const { rows: comments } = locked ? { rows: [] } : await db.query(
    `SELECT c.id, c.body, c.created_at, c.user_id, COALESCE(u.nickname,u.name) AS nick, u.country, u.avatar_id, u.role
       FROM lounge_comments c LEFT JOIN users u ON u.id=c.user_id
      WHERE c.post_id=$1 AND c.is_hidden=false ORDER BY c.created_at`,
    [p.id]
  );
  let liked = false;
  if (req.user) {
    const r = await db.query(`SELECT 1 FROM lounge_likes WHERE post_id=$1 AND user_id=$2`, [p.id, req.user.id]);
    liked = r.rows.length > 0;
  }
  // 프롬프트 요청: 올라온 프롬프트, 운영자는 연결할 프롬프트 목록
  let answer = null, promptList = [];
  if (p.category === 'request' && !locked) {
    if (p.prompt_id) {
      const r = await db.query(`SELECT id, title, image_ids FROM lounge_prompts WHERE id=$1 AND is_active`, [p.prompt_id]);
      answer = r.rows[0] || null;
    }
    if (isAdmin(req)) {
      const r = await db.query(`SELECT id, title FROM lounge_prompts WHERE is_active ORDER BY created_at DESC LIMIT 60`);
      promptList = r.rows;
    }
  }
  res.render('lounge/post', { title: locked ? '비밀글' : p.title, active: 'community', p, comments, liked, locked, answer, promptList });
});

// 운영자: 요청 글에 만든 프롬프트 연결 (답글도 자동으로 남김)
post('/community/:id(\\d+)/answer', member, async (req, res) => {
  if (!isAdmin(req)) return res.redirect('/community');
  const p = await loadPost(req.params.id);
  if (!p || p.category !== 'request') return res.redirect('/community');
  const pid = parseInt(req.body.prompt_id, 10) || null;
  await db.query(`UPDATE lounge_posts SET prompt_id=$1 WHERE id=$2`, [pid, p.id]);
  if (pid && !p.prompt_id) {
    const r = await db.query(`SELECT title FROM lounge_prompts WHERE id=$1`, [pid]);
    if (r.rows[0]) {
      await db.query(
        `INSERT INTO lounge_comments (post_id, user_id, body) VALUES ($1,$2,$3)`,
        [p.id, req.user.id, `요청하신 프롬프트 올렸어요! 👉 「${r.rows[0].title}」 ${res.locals.baseUrl}/prompts/${pid}`]
      );
    }
  }
  flash(req, pid ? '프롬프트를 연결했어요. 요청 글에 완료로 표시돼요.' : '연결을 풀었어요.');
  res.redirect(`/community/${p.id}`);
});

post('/community/:id(\\d+)/comment', member, async (req, res) => {
  const p = await loadPost(req.params.id);
  if (!p || !canSee(req, p)) return res.redirect('/community');
  const body = String(req.body.body || '').trim().slice(0, 1000);
  if (!body) return res.redirect(`/community/${p.id}`);
  const wb = banned(req, 'write');
  if (wb) { flash(req, `운영자가 댓글을 막아 뒀어요 (${wb}).`); return res.redirect(`/community/${p.id}`); }
  const { rows } = await db.query(
    `INSERT INTO lounge_comments (post_id, user_id, body) VALUES ($1,$2,$3) RETURNING id`,
    [p.id, req.user.id, body]
  );
  res.redirect(`/community/${p.id}#c${rows[0].id}`);
});

post('/community/:id(\\d+)/like', member, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const del = await db.query(`DELETE FROM lounge_likes WHERE post_id=$1 AND user_id=$2`, [id, req.user.id]);
  if (!del.rowCount) {
    await db.query(`INSERT INTO lounge_likes (post_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, req.user.id]).catch(() => {});
  }
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM lounge_likes WHERE post_id=$1`, [id]);
  if (wantsJson(req)) return res.json({ liked: !del.rowCount, likes: rows[0].n });
  res.redirect(`/community/${id}`);
});

post('/community/:id(\\d+)/delete', member, async (req, res) => {
  const p = await loadPost(req.params.id);
  if (p && (p.user_id === req.user.id || isAdmin(req))) {
    await db.query(`UPDATE lounge_posts SET is_hidden=true WHERE id=$1`, [p.id]);
    const lost = await P.revoke('post', p.id);
    flash(req, lost ? `글을 지웠어요. 이 글로 받은 ${lost}P도 빠졌어요.` : '글을 지웠어요.');
  }
  res.redirect('/community');
});

post('/community/:id(\\d+)/pin', member, async (req, res) => {
  if (isAdmin(req)) await db.query(`UPDATE lounge_posts SET is_pinned = NOT is_pinned WHERE id=$1`, [req.params.id]);
  res.redirect(`/community/${req.params.id}`);
});

post('/comments/:id(\\d+)/delete', member, async (req, res) => {
  const { rows } = await db.query(`SELECT post_id, user_id FROM lounge_comments WHERE id=$1`, [req.params.id]);
  if (rows[0] && (rows[0].user_id === req.user.id || isAdmin(req))) {
    await db.query(`UPDATE lounge_comments SET is_hidden=true WHERE id=$1`, [req.params.id]);
  }
  res.redirect(rows[0] ? `/community/${rows[0].post_id}` : '/community');
});

/* ---------------- 신고 ---------------- */
post('/report', member, async (req, res) => {
  const type = ['post', 'comment', 'chat', 'result'].includes(req.body.type) ? req.body.type : null;
  const id = parseInt(req.body.id, 10);
  if (type && id) {
    await db.query(
      `INSERT INTO lounge_reports (target_type, target_id, user_id, reason) VALUES ($1,$2,$3,$4)`,
      [type, id, req.user.id, String(req.body.reason || '').slice(0, 40)]
    );
  }
  if (wantsJson(req)) return res.json({ ok: true });
  flash(req, '신고가 접수됐어요. 운영자가 확인할게요.');
  res.redirect(back(req));
});

/* ---------------- 실시간 채팅 ---------------- */
get('/chat/messages', async (req, res) => {
  const after = parseInt(req.query.after, 10) || 0;
  // badge: 운영자 👑 / 수강생 🎓 (직접 표시했거나 피드백 과정 수강 중)
  const { rows } = await db.query(
    `SELECT c.id, c.body, c.created_at, c.user_id, COALESCE(u.nickname,u.name) AS nick, u.country, u.avatar_id,
            CASE WHEN u.role='admin' THEN 'admin'
                 WHEN u.is_student OR EXISTS (
                   SELECT 1 FROM lounge_enrollments e LEFT JOIN lounge_products p ON p.id=e.product_id
                    WHERE e.user_id=u.id AND ${E.ACTIVE} AND COALESCE(p.ptype,'course')='course') THEN 'student'
                 ELSE '' END AS badge
       FROM lounge_chat c JOIN users u ON u.id=c.user_id
      WHERE c.is_hidden=false AND c.id > $1 ORDER BY c.id DESC LIMIT 40`,
    [after]
  );
  const { rows: on } = await db.query(
    `SELECT count(DISTINCT user_id)::int AS n FROM lounge_chat WHERE created_at > now() - interval '30 minutes'`
  );
  res.json({
    online: on[0].n,
    items: rows.reverse().map((m) => ({ id: m.id, uid: m.user_id, nick: m.nick, badge: m.badge, flag: m.country ? L.flag(m.country) : '', ava: m.avatar_id || null, admin: m.badge === 'admin', body: m.body, at: m.created_at })),
  });
});

post('/chat', member, async (req, res) => {
  const body = String(req.body.body || '').trim().slice(0, 300);
  if (!body) return res.status(400).json({ error: '내용을 적어 주세요.' });
  const cb = banned(req, 'chat');
  if (cb) return res.status(403).json({ error: `운영자가 채팅을 막아 뒀어요 (${cb}).` });
  const { rows: rc } = await db.query(
    `SELECT count(*)::int AS n FROM lounge_chat WHERE user_id=$1 AND created_at > now() - interval '20 seconds'`,
    [req.user.id]
  );
  if (rc[0].n >= 4) return res.status(429).json({ error: '조금만 천천히 보내 주세요.' });
  const { rows } = await db.query(`INSERT INTO lounge_chat (user_id, body) VALUES ($1,$2) RETURNING id`, [req.user.id, body]);
  res.json({ ok: true, id: rows[0].id });
});

/* ---------------- 성과 인증샷 ---------------- */
post('/results', member, async (req, res) => {
  const kind = L.RESULT_KINDS[req.body.kind] ? req.body.kind : 'income';
  const headline = String(req.body.headline || '').trim().slice(0, 24);
  const channel = String(req.body.channel || '').trim().slice(0, 20) || null;
  if (!headline || !req.body.image) {
    flash(req, '사진과 한 줄 설명을 모두 넣어 주세요.');
    return res.redirect(back(req));
  }
  const imageId = await L.saveImage(req.user.id, req.body.image);
  if (!imageId) {
    flash(req, '사진을 올리지 못했어요. 다른 사진으로 해 주세요.');
    return res.redirect(back(req));
  }
  await db.query(
    `INSERT INTO lounge_results (user_id, image_id, kind, headline, channel) VALUES ($1,$2,$3,$4,$5)`,
    [req.user.id, imageId, kind, headline, channel]
  );
  flash(req, '성과를 올렸어요! 축하해요 🎉');
  res.redirect(back(req));
});

post('/results/:id(\\d+)/delete', member, async (req, res) => {
  const { rows } = await db.query(`SELECT user_id FROM lounge_results WHERE id=$1`, [req.params.id]);
  if (rows[0] && (rows[0].user_id === req.user.id || isAdmin(req))) {
    await db.query(`UPDATE lounge_results SET is_hidden=true WHERE id=$1`, [req.params.id]);
  }
  res.redirect(back(req));
});

/* ---------------- 사진 보기 ---------------- */
get('/u/img/:id(\\d+)', async (req, res) => {
  const { rows } = await db.query(`SELECT mime, data FROM lounge_images WHERE id=$1`, [req.params.id]);
  if (!rows.length) return res.status(404).end();
  res.set('Content-Type', rows[0].mime);
  res.set('Cache-Control', 'public, max-age=2592000, immutable');
  res.send(rows[0].data);
});

/* ---------------- 자료실 ---------------- */
// 라이브 코드로 연 자료는 세션에 기억한다 (다시 넣지 않아도 되게)
const codeOpen = (req) => !!(req.session && req.session.liveOk);

// sp: { all: 수강·구매 중인 상품 번호, course: 그중 강의 과정 번호 }
function canOpen(req, r, owned, sp) {
  if (!req.user || !req.user.nickname) return false;
  if (isAdmin(req)) return true;
  if (r.access === 'course') {
    // 고른 과정이 있으면 그 과정(전자책 포함) 구매자만, 안 골랐으면 강의 수강생 누구나
    return r.product_ids && r.product_ids.length ? r.product_ids.some((id) => sp.all.includes(id)) : sp.course.length > 0;
  }
  if (r.access === 'code') return codeOpen(req) || owned.has(r.id) || sp.all.length > 0;
  if (r.access === 'points') return owned.has(r.id) || sp.all.length > 0; // 수강생·전자책 구매자는 포인트 없이 열람
  return true;
}
async function studentIds(req) {
  if (!req.user) return { all: [], course: [] };
  const [all, course] = await Promise.all([E.activeProductIds(req.user.id), E.activeCourseIds(req.user.id)]);
  return { all, course };
}
async function ownedSet(req) {
  if (!req.user) return new Set();
  const { rows } = await db.query(`SELECT resource_id FROM lounge_unlocks WHERE user_id=$1`, [req.user.id]);
  return new Set(rows.map((x) => x.resource_id));
}

get('/library', async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, title, description, kind, section, access, lock_note, sort_order, cost, product_ids FROM lounge_resources
      WHERE is_active=true ORDER BY sort_order, id`
  );
  const owned = await ownedSet(req);
  const sp = await studentIds(req);
  const groups = [];
  const idx = {};
  for (const r of rows) {
    r.open = canOpen(req, r, owned, sp);
    if (!(r.section in idx)) {
      idx[r.section] = groups.length;
      groups.push({ name: r.section, items: [] });
    }
    groups[idx[r.section]].items.push(r);
  }
  const hasCode = rows.some((r) => r.access === 'code');
  const hasPoints = rows.some((r) => r.access === 'points');
  const pt = req.user && req.user.nickname ? await P.summary(req.user.id) : null;
  const { rows: products } = await db.query(
    `SELECT id, title, subtitle, kind, badge, price_text, list_price, price_note, ptype FROM lounge_products
      WHERE is_active=true ORDER BY (ptype='ebook') DESC, sort_order, id`
  );
  await E.priced(products);
  res.render('lounge/library', { products, mine: sp.all,
    title: '자료실', active: 'library', groups, hasCode, hasPoints, pt, codeOk: codeOpen(req), isStu: sp.all.length > 0,
    sec: String(req.query.s || ''),
  });
});

post('/library/code', member, async (req, res) => {
  const S = await L.settings();
  const code = String(req.body.code || '').trim().toLowerCase();
  if (S.live_code && code && code === S.live_code.trim().toLowerCase()) {
    req.session.liveOk = true;
    flash(req, '코드가 맞아요! 라이브 전용 자료가 열렸어요 🎉');
  } else {
    flash(req, '코드가 맞지 않아요. 라이브에서 알려드린 코드를 다시 확인해 주세요.');
  }
  res.redirect('/library');
});

get('/library/:id(\\d+)', member, async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM lounge_resources WHERE id=$1 AND is_active=true`, [req.params.id]);
  const r = rows[0];
  if (!r) return res.status(404).render('error', { title: '없는 자료', message: '자료를 찾지 못했어요.' });
  if (!canOpen(req, r, await ownedSet(req), await studentIds(req))) {
    flash(req, r.access === 'points'
      ? `포인트 ${P.fmt(r.cost)}P로 여는 자료예요. 자료실에서 [포인트로 열기]를 눌러 주세요.`
      : r.access === 'course' ? '수강생만 볼 수 있는 자료예요.' : '라이브 코드를 넣어야 열리는 자료예요.');
    return res.redirect(`/library#r${r.id}`);
  }
  // 본 기록은 회원·코드 자료만 남긴다 (포인트 자료는 구매로만, 수강생 열람은 수강권이 끝나면 닫혀야 하므로 남기지 않는다)
  if ((r.access === 'member' || r.access === 'code') && !isAdmin(req)) {
    db.query(`INSERT INTO lounge_unlocks (user_id, resource_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.user.id, r.id]).catch(() => {});
  }
  const url = L.safeLink(r.url);
  // 사이트 안 주소나 노션 자료집은 바로 그 페이지로 보낸다
  if (url && !r.body && r.kind === 'link') return res.redirect(url);
  res.render('lounge/resource', { title: r.title, active: 'library', r, url });
});

post('/library/:id(\\d+)/buy', member, async (req, res) => {
  const { rows } = await db.query(`SELECT id, title, cost, access FROM lounge_resources WHERE id=$1 AND is_active=true`, [req.params.id]);
  const r = rows[0];
  if (!r || r.access !== 'points') return res.redirect('/library');
  if (isAdmin(req) || (await E.activeProductIds(req.user.id)).length) return res.redirect(`/library/${r.id}`);
  const out = await P.buy(req.user.id, r);
  if (out.ok) flash(req, `${P.fmt(r.cost)}P를 써서 「${r.title}」을 열었어요 🎉 남은 포인트 ${P.fmt(out.left)}P`);
  else if (out.why === 'owned') flash(req, '이미 열어 둔 자료예요.');
  else flash(req, `포인트가 ${P.fmt(out.need)}P 모자라요. 커뮤니티에 글·후기를 남기고 모아 보세요!`);
  res.redirect(`/library#r${r.id}`);
});

/* ---------------- 프롬프트 갤러리 ---------------- */
const P_PAGE = 30;

// 프롬프트: 바이란 공식(user_id 없음) + 모두의 프롬프트(회원 공유)
const PUB = `p.is_active AND p.status='live'`;
async function promptList(req, res, shared) {
  const cat = L.PROMPT_CATS.includes(req.query.cat) ? req.query.cat : '';
  const q = String(req.query.q || '').trim().slice(0, 60);
  const sort = ['popular', 'old'].includes(req.query.sort) ? req.query.sort : 'new';
  const fav = req.query.fav === '1' && req.user;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const scope = shared ? 'p.user_id IS NOT NULL' : 'p.user_id IS NULL';

  const params = [];
  let where = `${PUB} AND ${scope}`;
  if (cat) { params.push(cat); where += ` AND p.category=$${params.length}`; }
  if (q) { params.push(`%${q}%`); where += ` AND (p.title ILIKE $${params.length} OR p.prompt ILIKE $${params.length})`; }
  if (fav) { params.push(req.user.id); where += ` AND EXISTS (SELECT 1 FROM lounge_prompt_likes k WHERE k.prompt_id=p.id AND k.user_id=$${params.length})`; }

  const { rows: cnt } = await db.query(`SELECT count(*)::int AS n FROM lounge_prompts p WHERE ${where}`, params);
  params.push(P_PAGE, (page - 1) * P_PAGE);
  // 인기순: 하트·즐겨찾기 3점, 복사해 간 기기 2점, 조회 20번에 1점 / 날짜순: 오래된 것부터
  const order = sort === 'popular'
    ? '(p.hearts * 3 + p.favs * 3 + p.copiers * 2 + p.views / 20) DESC, p.created_at DESC'
    : sort === 'old' ? 'p.created_at ASC, p.id ASC' : 'p.created_at DESC, p.id DESC';
  const { rows: items } = await db.query(
    `SELECT p.id, p.title, p.category, p.image_ids, left(p.prompt, 140) AS preview, p.copies, p.user_id,
            p.hearts, p.copiers, p.favs, to_char(p.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY.MM.DD') AS date_s,
            COALESCE(u.nickname, u.name) AS author, u.avatar_id AS author_avatar, u.country AS author_country
       FROM lounge_prompts p LEFT JOIN users u ON u.id=p.user_id WHERE ${where} ORDER BY ${order}
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const { rows: cats } = await db.query(`SELECT category, count(*)::int AS n FROM lounge_prompts p WHERE ${PUB} AND ${scope} GROUP BY category`);
  const { rows: tot } = await db.query(
    `SELECT count(*) FILTER (WHERE p.user_id IS NULL)::int AS official, count(*) FILTER (WHERE p.user_id IS NOT NULL)::int AS shared
       FROM lounge_prompts p WHERE ${PUB}`
  );
  res.render('lounge/prompts', {
    title: shared ? '모두의 프롬프트' : 'AI 프롬프트', active: 'prompts', shared, items, cat, q, sort, fav: !!fav, page,
    pages: Math.max(1, Math.ceil(cnt[0].n / P_PAGE)), total: cnt[0].n,
    all: shared ? tot[0].shared : tot[0].official, counts: tot[0],
    catCount: Object.fromEntries(cats.map((c) => [c.category, c.n])),
    ogT: shared ? '모두의 프롬프트 · 바이란 회원들이 공유한 AI 프롬프트' : '바이란 AI 프롬프트 모음 · 이미지 누르고 바로 복사',
    ogD: shared ? '회원들이 직접 만들어 공유한 AI 이미지 프롬프트. 누르면 바로 복사할 수 있어요.' : 'AI 인물·화보·캐릭터 이미지 프롬프트 모음. 마음에 드는 이미지를 누르면 프롬프트를 볼 수 있어요.',
  });
}
get('/prompts', (req, res) => promptList(req, res, false));
get('/prompts/shared', (req, res) => promptList(req, res, true));

get('/prompts/builder', (req, res) => {
  res.render('lounge/builder', {
    title: '프롬프트 생성기', active: 'prompts', aiOn: T.aiReady(),
    ogT: '프롬프트 생성기 · 칸만 채우면 완성',
    ogD: '인물·화보·제품 이미지 프롬프트를 칸만 채워서 만들어요. 미드저니·챗지피티·Flux용.',
  });
});

get('/prompts/:id(\\d+)', async (req, res) => {
  const { rows } = await db.query(
    `SELECT p.*, COALESCE(u.nickname, u.name) AS author, u.avatar_id AS author_avatar, u.country AS author_country,
            to_char(p.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY.MM.DD') AS date_s
       FROM lounge_prompts p LEFT JOIN users u ON u.id=p.user_id WHERE p.id=$1`,
    [req.params.id]
  );
  const p = rows[0];
  const mine = !!(p && req.user && p.user_id === req.user.id);
  // 숨김·수정 요청 중인 프롬프트는 운영자와 올린 사람만 볼 수 있다
  if (!p || (!(p.is_active && p.status === 'live') && !isAdmin(req) && !mine)) {
    return res.status(404).render('error', { title: '없는 프롬프트', message: '지워졌거나 없는 프롬프트예요.' });
  }
  V.countView('p', 'lounge_prompts', p.id, req); // 하루에 기기 1대당 1번
  const S = res.locals.S;
  // 바이란이 올린 프롬프트는 누구나 복사, 회원이 공유한 프롬프트는 가입한 회원만
  const canCopy = !p.user_id || !!(req.user && req.user.nickname);
  let liked = false;
  if (req.user) {
    const r = await db.query(`SELECT 1 FROM lounge_prompt_likes WHERE prompt_id=$1 AND user_id=$2`, [p.id, req.user.id]);
    liked = r.rows.length > 0;
  }
  const hk = heartKey(req);
  const hearted = hk ? (await db.query(`SELECT 1 FROM lounge_prompt_hearts WHERE prompt_id=$1 AND who=$2`, [p.id, hk])).rows.length > 0 : false;
  const { rows: more } = await db.query(
    `SELECT p.id, p.title, p.image_ids FROM lounge_prompts p
      WHERE ${PUB} AND p.id<>$1 AND p.category=$2 AND cardinality(p.image_ids)>0
        AND (p.user_id IS NULL) = $3
      ORDER BY p.created_at DESC LIMIT 4`,
    [p.id, p.category, !p.user_id]
  );
  res.render('lounge/prompt', {
    title: p.title, active: 'prompts', p, canCopy, liked, hearted, more, mine,
    shown: canCopy ? p.prompt : p.prompt.slice(0, Math.min(220, Math.floor(p.prompt.length * 0.35))),
    ogT: `${p.title} · 바이란 AI 프롬프트`,
    ogD: '이미지를 누르면 프롬프트를 바로 복사할 수 있어요.',
    ogImg: p.image_ids[0] ? `/u/img/${p.image_ids[0]}` : null,
  });
});

/* ---------- 모두의 프롬프트: 회원이 공유 · 고치기 · 지우기 ---------- */
async function readPromptForm(req, existing) {
  const title = String(req.body.title || '').trim().slice(0, 120);
  const prompt = String(req.body.prompt || '').trim().slice(0, 12000);
  const max = isAdmin(req) ? 8 : 4;
  let keep = [].concat(req.body.keep || []).map((x) => parseInt(x, 10)).filter((x) => x && existing && existing.image_ids.includes(x));
  const uploads = [].concat(req.body.images || []).filter(Boolean).slice(0, max);
  for (const d of uploads) {
    if (keep.length >= max) break;
    const imgId = await L.saveImage(req.user.id, d);
    if (imgId) keep.push(imgId);
  }
  return {
    title, prompt, image_ids: keep.slice(0, max),
    category: L.PROMPT_CATS.includes(req.body.category) ? req.body.category : '기타',
    negative: String(req.body.negative || '').trim().slice(0, 4000) || null,
    note: String(req.body.note || '').trim().slice(0, 300) || null,
    model: String(req.body.model || '').trim().slice(0, 40) || null,
  };
}
async function loadPrompt(id) {
  const { rows } = await db.query(`SELECT * FROM lounge_prompts WHERE id=$1`, [id]);
  return rows[0] || null;
}
const canEditPrompt = (req, p) => p && req.user && (isAdmin(req) || p.user_id === req.user.id);

get('/prompts/share', member, (req, res) => {
  res.render('lounge/prompt-form', { title: '프롬프트 공유하기', active: 'prompts', p: null, error: null });
});
post('/prompts/share', member, async (req, res) => {
  const wb = banned(req, 'write');
  if (wb) { flash(req, `운영자가 글쓰기·공유를 막아 뒀어요 (${wb}).`); return res.redirect('/prompts/shared'); }
  const { rows: rc } = await db.query(
    `SELECT count(*)::int AS n FROM lounge_prompts WHERE user_id=$1 AND created_at > now() - interval '1 day'`, [req.user.id]
  );
  if (rc[0].n >= 10 && !isAdmin(req)) {
    flash(req, '오늘은 공유를 많이 하셨어요. 내일 다시 올려 주세요 🙏');
    return res.redirect('/prompts/shared');
  }
  const f = await readPromptForm(req, null);
  if (!f.title || !f.prompt) {
    return res.status(400).render('lounge/prompt-form', { title: '프롬프트 공유하기', active: 'prompts', p: Object.assign({ id: null, image_ids: [] }, f), error: '제목과 프롬프트를 넣어 주세요.' });
  }
  const { rows } = await db.query(
    `INSERT INTO lounge_prompts (title, category, prompt, negative, model, note, image_ids, is_active, user_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,'live') RETURNING id`,
    [f.title, f.category, f.prompt, f.negative, f.model, f.note, f.image_ids, req.user.id]
  );
  flash(req, '프롬프트를 공유했어요! 모두의 프롬프트에 올라갔어요 🙌');
  res.redirect(`/prompts/${rows[0].id}`);
});
get('/prompts/:id(\\d+)/edit', member, async (req, res) => {
  const p = await loadPrompt(req.params.id);
  if (!canEditPrompt(req, p)) return res.redirect(`/prompts/${req.params.id}`);
  res.render('lounge/prompt-form', { title: '프롬프트 고치기', active: 'prompts', p, error: null });
});
post('/prompts/:id(\\d+)/edit', member, async (req, res) => {
  const p = await loadPrompt(req.params.id);
  if (!canEditPrompt(req, p)) return res.redirect(`/prompts/${req.params.id}`);
  const f = await readPromptForm(req, p);
  if (!f.title || !f.prompt) {
    return res.status(400).render('lounge/prompt-form', { title: '프롬프트 고치기', active: 'prompts', p: Object.assign({}, p, f), error: '제목과 프롬프트를 넣어 주세요.' });
  }
  // 올린 사람이 고치면 수정 요청은 풀리고 다시 공개
  const byAuthor = p.user_id && p.user_id === req.user.id;
  await db.query(
    `UPDATE lounge_prompts SET title=$1, category=$2, prompt=$3, negative=$4, model=$5, note=$6, image_ids=$7, updated_at=now()
            ${byAuthor ? `, status='live', fix_note=NULL, is_active=true` : ''}
      WHERE id=$8`,
    [f.title, f.category, f.prompt, f.negative, f.model, f.note, f.image_ids, p.id]
  );
  flash(req, byAuthor && p.status === 'fix' ? '고쳐서 다시 올렸어요. 고마워요! 🙏' : '프롬프트를 고쳤어요.');
  res.redirect(`/prompts/${p.id}`);
});
post('/prompts/:id(\\d+)/delete', member, async (req, res) => {
  const p = await loadPrompt(req.params.id);
  if (!canEditPrompt(req, p)) return res.redirect(`/prompts/${req.params.id}`);
  await db.query(`DELETE FROM lounge_prompts WHERE id=$1`, [p.id]);
  flash(req, '프롬프트를 지웠어요.');
  res.redirect(p.user_id ? (isAdmin(req) && p.user_id !== req.user.id ? '/prompts/shared' : '/my#myprompts') : '/prompts');
});
// 운영자: 회원 프롬프트에 수정 요청 (고칠 때까지 숨길 수 있음) / 요청 풀기
post('/prompts/:id(\\d+)/fix', member, async (req, res) => {
  if (!isAdmin(req)) return res.redirect(`/prompts/${req.params.id}`);
  const p = await loadPrompt(req.params.id);
  if (!p) return res.redirect('/prompts/shared');
  if (req.body.clear === '1') {
    await db.query(`UPDATE lounge_prompts SET status='live', fix_note=NULL, is_active=true WHERE id=$1`, [p.id]);
    flash(req, '수정 요청을 풀고 다시 공개했어요.');
  } else {
    const note = String(req.body.note || '').trim().slice(0, 500);
    if (!note) { flash(req, '무엇을 고쳐 달라고 할지 적어 주세요.'); return res.redirect(`/prompts/${p.id}#fix`); }
    await db.query(`UPDATE lounge_prompts SET status='fix', fix_note=$1 WHERE id=$2`, [note, p.id]);
    flash(req, '수정 요청을 보냈어요. 올린 분이 고칠 때까지 목록에서 숨겨져요.');
  }
  res.redirect(`/prompts/${p.id}`);
});

// 생성기: 한국어 → 영어 (AI 키가 있으면 AI, 없으면 단어장)
const tHits = new Map();
post('/prompts/translate', async (req, res) => {
  const key = req.ip;
  const now = Date.now();
  const arr = (tHits.get(key) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (arr.length >= 40) return res.status(429).json({ error: '잠시 후 다시 눌러 주세요.' });
  arr.push(now);
  tHits.set(key, arr);
  if (tHits.size > 5000) tHits.clear();
  const out = await T.translateFields((req.body && req.body.fields) || {});
  res.json(out);
});

// 하트: 회원은 1명당, 비회원은 기기 1대당 한 번 (다시 누르면 취소)
function heartKey(req) {
  if (req.user) return 'u:' + req.user.id;
  const d = V.deviceId(req);
  return d ? 'd:' + d : null;
}
// 복사: 기기 1대당 한 번만 '가져간 사람'으로 셈 (운영자는 쿠키가 없으면 회원 번호로)
function copyKey(req) {
  const d = V.deviceId(req);
  if (d) return 'd:' + d;
  return req.user ? 'u:' + req.user.id : null;
}
post('/prompts/:id(\\d+)/copied', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await db.query(`UPDATE lounge_prompts SET copies=copies+1 WHERE id=$1`, [id]).catch(() => {});
  const k = copyKey(req);
  if (k) {
    const r = await db.query(`INSERT INTO lounge_prompt_copies (prompt_id, who) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, k]).catch(() => ({ rowCount: 0 }));
    if (r.rowCount) await db.query(`UPDATE lounge_prompts SET copiers=copiers+1 WHERE id=$1`, [id]).catch(() => {});
  }
  res.json({ ok: true });
});
post('/prompts/:id(\\d+)/heart', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const k = heartKey(req);
  if (!k) return res.status(400).json({ error: '잠시 후 다시 눌러 주세요.' });
  const del = await db.query(`DELETE FROM lounge_prompt_hearts WHERE prompt_id=$1 AND who=$2`, [id, k]);
  if (!del.rowCount) await db.query(`INSERT INTO lounge_prompt_hearts (prompt_id, who) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, k]).catch(() => {});
  const { rows } = await db.query(
    `UPDATE lounge_prompts SET hearts = (SELECT count(*) FROM lounge_prompt_hearts WHERE prompt_id=$1) WHERE id=$1 RETURNING hearts`, [id]
  );
  res.json({ hearted: !del.rowCount, hearts: rows[0] ? rows[0].hearts : 0 });
});

post('/prompts/:id(\\d+)/like', member, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const del = await db.query(`DELETE FROM lounge_prompt_likes WHERE prompt_id=$1 AND user_id=$2`, [id, req.user.id]);
  if (!del.rowCount) {
    await db.query(`INSERT INTO lounge_prompt_likes (prompt_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, req.user.id]).catch(() => {});
  }
  const { rows: fv } = await db.query(
    `UPDATE lounge_prompts SET favs = (SELECT count(*) FROM lounge_prompt_likes WHERE prompt_id=$1) WHERE id=$1 RETURNING favs`, [id]
  );
  if (wantsJson(req)) return res.json({ liked: !del.rowCount, favs: fv[0] ? fv[0].favs : 0 });
  res.redirect(`/prompts/${id}`);
});

/* ---------------- 후기 ---------------- */
get('/reviews', async (req, res) => {
  const pid = parseInt(req.query.p, 10) || 0;
  const { rows: products } = await db.query(
    `SELECT p.id, p.title, count(r.id)::int AS n
       FROM lounge_products p JOIN lounge_reviews r ON r.product_id=p.id AND r.status='approved'
      GROUP BY p.id ORDER BY p.sort_order, p.id`
  );
  const { rows: reviews } = await db.query(
    `SELECT r.id, r.rating, r.body, r.industry, r.image_id, r.created_at, r.product_id,
            COALESCE(r.author_name, u.nickname, u.name) AS nick, p.title AS product
       FROM lounge_reviews r LEFT JOIN users u ON u.id=r.user_id LEFT JOIN lounge_products p ON p.id=r.product_id
      WHERE r.status='approved' ${pid ? 'AND r.product_id=$1' : ''}
      ORDER BY r.approved_at DESC NULLS LAST, r.id DESC LIMIT 60`,
    pid ? [pid] : []
  );
  const { rows: results } = await db.query(
    `SELECT r.id, r.kind, r.headline, r.channel, r.image_id, r.user_id, COALESCE(u.nickname,u.name) AS nick
       FROM lounge_results r JOIN users u ON u.id=r.user_id
      WHERE r.is_hidden=false ORDER BY r.created_at DESC LIMIT 24`
  );
  const { rows: all } = await db.query(`SELECT id, title FROM lounge_products WHERE is_active ORDER BY sort_order, id`);
  const { rows: st } = await db.query(
    `SELECT count(*)::int AS n, COALESCE(round(avg(rating)::numeric,1),0)::float AS avg FROM lounge_reviews WHERE status='approved'`
  );
  const pt = req.user && req.user.nickname ? await P.summary(req.user.id) : null;
  res.render('lounge/reviews', {
    title: '후기', active: 'community', products, reviews, results, all, pid, st: st[0], pt,
    write: req.query.write === '1',
  });
});

post('/reviews', member, async (req, res) => {
  const body = String(req.body.body || '').trim().slice(0, 3000);
  if (body.length < 10) {
    flash(req, '후기는 10자 이상 적어 주세요.');
    return res.redirect('/reviews?write=1');
  }
  const rating = Math.min(5, Math.max(1, parseInt(req.body.rating, 10) || 5));
  const productId = parseInt(req.body.product_id, 10) || null;
  const industry = String(req.body.industry || '').trim().slice(0, 40) || null;
  const imageId = req.body.image ? await L.saveImage(req.user.id, req.body.image) : null;
  const { rows } = await db.query(
    `INSERT INTO lounge_reviews (user_id, product_id, rating, industry, body, image_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [req.user.id, productId, rating, industry, body, imageId]
  );
  const got = await P.earn(req.user.id, 'review', rows[0].id);
  flash(req, got
    ? `후기를 보냈어요. +${got}P 적립! 💎 운영자가 확인한 뒤 올라가요.`
    : '후기를 보냈어요. 운영자가 확인한 뒤 올라가요. (오늘 후기 포인트는 이미 받았어요)');
  res.redirect('/reviews');
});

/* ---------------- 수강 신청 ---------------- */
get('/store', (req, res) => res.redirect(301, '/course'));
get('/course', async (req, res) => {
  const { rows: products } = await db.query(
    `SELECT p.*, (SELECT count(*) FROM lounge_reviews r WHERE r.product_id=p.id AND r.status='approved')::int AS reviews
       FROM lounge_products p WHERE p.is_active=true ORDER BY p.sort_order, p.id`
  );
  await E.priced(products);
  const mine = req.user ? await E.activeProductIds(req.user.id) : [];
  res.render('lounge/course', { title: '수강 · 전자책 신청', active: 'library', products, mine, sent: req.query.sent === '1', pick: parseInt(req.query.pick, 10) || null });
});

post('/course/apply', async (req, res) => {
  if (String(req.body.website || '').trim()) return res.redirect('/course?sent=1');
  const { rows } = await db.query(`SELECT id, title FROM lounge_products WHERE id=$1 AND is_active`, [req.body.product_id]);
  const p = rows[0];
  const name = String(req.body.name || (req.user && (req.user.nickname || req.user.name)) || '').trim().slice(0, 100);
  const phone = String(req.body.phone || '').trim().slice(0, 40);
  const message = String(req.body.message || '').trim().slice(0, 2000);
  if (!p || !name || !phone) {
    flash(req, '과정, 이름, 연락처를 모두 넣어 주세요.');
    return res.redirect('/course#apply');
  }
  const { rows: cnt } = await db.query(
    `SELECT count(*)::int AS n FROM inquiries WHERE ip=$1 AND created_at > now() - interval '10 minutes'`, [req.ip]
  );
  if (cnt[0].n >= 5) {
    flash(req, '신청이 여러 건 접수됐어요. 잠시 후 다시 시도해 주세요.');
    return res.redirect('/course#apply');
  }
  await db.query(
    `INSERT INTO inquiries (name, phone, business, plan, message, ip) VALUES ($1,$2,$3,$4,$5,$6)`,
    [name, phone, req.user ? `라운지 회원 #${req.user.id}` : null, `수강 신청 · ${p.title}`.slice(0, 60), message || null, req.ip]
  );
  res.redirect('/course?sent=1#apply');
});

/* ---------------- 챌린지 ---------------- */
function dayIndex(startDate) {
  // 오늘(한국 시간)이 시작일로부터 몇 번째 날인지. 시작 전이면 0 이하.
  const s = new Date(String(startDate instanceof Date ? startDate.toISOString() : startDate).slice(0, 10) + 'T00:00:00Z');
  const t = new Date(L.kstToday() + 'T00:00:00Z');
  return Math.floor((t - s) / 86400000) + 1;
}

get('/challenge', async (req, res) => {
  const { rows: cohorts } = await db.query(`SELECT * FROM lounge_cohorts ORDER BY start_date DESC, id DESC LIMIT 20`);
  const cur = cohorts.find((c) => c.status !== 'ended') || null;
  let mine = null, missions = [], subs = new Set(), board = [], past = [];
  if (cur) {
    if (req.user) {
      const m = await db.query(`SELECT * FROM lounge_cohort_members WHERE cohort_id=$1 AND user_id=$2`, [cur.id, req.user.id]);
      mine = m.rows[0] || null;
    }
    const canSeeMissions = isAdmin(req) || (mine && mine.status === 'approved');
    if (canSeeMissions) {
      missions = (await db.query(`SELECT * FROM lounge_missions WHERE cohort_id=$1 ORDER BY day`, [cur.id])).rows;
      if (req.user) {
        const s = await db.query(`SELECT mission_id FROM lounge_submissions WHERE cohort_id=$1 AND user_id=$2`, [cur.id, req.user.id]);
        subs = new Set(s.rows.map((r) => r.mission_id));
      }
      board = (await db.query(
        `SELECT COALESCE(u.nickname,u.name) AS nick, count(s.id)::int AS done
           FROM lounge_cohort_members m JOIN users u ON u.id=m.user_id
           LEFT JOIN lounge_submissions s ON s.cohort_id=m.cohort_id AND s.user_id=m.user_id
          WHERE m.cohort_id=$1 AND m.status='approved'
          GROUP BY u.id ORDER BY nick LIMIT 200`,
        [cur.id]
      )).rows;
    }
  }
  if (req.user) {
    past = (await db.query(
      `SELECT c.id, c.name, c.title, c.days,
              (SELECT count(*) FROM lounge_submissions s WHERE s.cohort_id=c.id AND s.user_id=$1)::int AS done
         FROM lounge_cohorts c JOIN lounge_cohort_members m ON m.cohort_id=c.id AND m.user_id=$1 AND m.status='approved'
        WHERE c.status='ended' ORDER BY c.start_date DESC`,
      [req.user.id]
    )).rows;
  }
  const today = cur ? dayIndex(cur.start_date) : 0;
  res.render('lounge/challenge', {
    title: '챌린지', active: 'challenge', cur, mine, missions, subs, board, past, today,
  });
});

post('/challenge/apply', member, async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM lounge_cohorts WHERE id=$1 AND status <> 'ended'`, [req.body.cohort_id]);
  const c = rows[0];
  if (!c) return res.redirect('/challenge');
  const orderNo = String(req.body.order_no || '').trim().slice(0, 60);
  const contact = String(req.body.contact || '').trim().slice(0, 80);
  if (!contact) {
    flash(req, '연락처를 적어 주세요.');
    return res.redirect('/challenge');
  }
  await db.query(
    `INSERT INTO lounge_cohort_members (cohort_id, user_id, order_no, contact) VALUES ($1,$2,$3,$4)
     ON CONFLICT (cohort_id, user_id) DO UPDATE SET order_no=EXCLUDED.order_no, contact=EXCLUDED.contact,
       status=CASE WHEN lounge_cohort_members.status='approved' THEN 'approved' ELSE 'pending' END`,
    [c.id, req.user.id, orderNo || null, contact]
  );
  flash(req, '참가 신청을 받았어요. 확인되면 바로 열어 드릴게요.');
  res.redirect('/challenge');
});

post('/challenge/submit', member, async (req, res) => {
  const { rows } = await db.query(
    `SELECT m.*, c.start_date, c.status AS cstatus FROM lounge_missions m JOIN lounge_cohorts c ON c.id=m.cohort_id WHERE m.id=$1`,
    [req.body.mission_id]
  );
  const m = rows[0];
  if (!m) return res.redirect('/challenge');
  const mem = await db.query(`SELECT status FROM lounge_cohort_members WHERE cohort_id=$1 AND user_id=$2`, [m.cohort_id, req.user.id]);
  if (!mem.rows[0] || mem.rows[0].status !== 'approved') {
    flash(req, '참가자로 등록된 뒤에 제출할 수 있어요.');
    return res.redirect('/challenge');
  }
  if (m.day > dayIndex(m.start_date) || m.cstatus === 'ended') {
    flash(req, '아직 열리지 않았거나 끝난 미션이에요.');
    return res.redirect('/challenge');
  }
  const body = String(req.body.body || '').trim().slice(0, 3000);
  const link = L.safeUrl(req.body.link) || null;
  if (!body && !link) {
    flash(req, '내용이나 링크 중 하나는 넣어 주세요.');
    return res.redirect(`/challenge#m${m.id}`);
  }
  const r = await db.query(
    `INSERT INTO lounge_submissions (cohort_id, mission_id, user_id, body, link) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (mission_id, user_id) DO UPDATE SET body=EXCLUDED.body, link=EXCLUDED.link
     RETURNING (xmax = 0) AS inserted`,
    [m.cohort_id, m.id, req.user.id, body, link]
  );
  flash(req, r.rows[0].inserted ? `Day ${m.day} 미션 완료! 👏` : `Day ${m.day} 제출물을 고쳤어요.`);
  res.redirect(`/challenge#m${m.id}`);
});

/* ---------------- 마이페이지 ---------------- */
/* ---------------- 회원 프로필 (네이버 카페처럼: 쓴 글 · 공유한 프롬프트 · 댓글) ---------------- */
get('/member/:id(\\d+)', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { rows } = await db.query(
    `SELECT u.id, u.nickname, u.avatar_id, u.country, u.interest, u.role, u.is_student, u.lounge_at, u.created_at,
            EXISTS (SELECT 1 FROM lounge_enrollments e LEFT JOIN lounge_products p ON p.id=e.product_id
                     WHERE e.user_id=u.id AND ${E.ACTIVE} AND COALESCE(p.ptype,'course')='course') AS has_course,
            (SELECT count(*) FROM lounge_posts p WHERE p.user_id=u.id AND p.is_hidden=false AND p.category<>'secret')::int AS n_posts,
            (SELECT count(*) FROM lounge_prompts p WHERE p.user_id=u.id AND p.is_active AND p.status='live')::int AS n_prompts,
            (SELECT count(*) FROM lounge_comments c WHERE c.user_id=u.id AND c.is_hidden=false)::int AS n_comments,
            (SELECT COALESCE(sum(hearts),0) FROM lounge_prompts p WHERE p.user_id=u.id AND p.is_active AND p.status='live')::int AS n_hearts
       FROM users u WHERE u.id=$1 AND u.nickname IS NOT NULL AND u.status <> 'suspended'`,
    [id]
  );
  const m = rows[0];
  if (!m) return res.status(404).render('error', { title: '없는 회원', message: '찾는 회원이 없어요.' });
  const tab = ['prompts', 'comments'].includes(req.query.t) ? req.query.t : 'posts';
  let items = [];
  if (tab === 'posts') {
    items = (await db.query(
      `SELECT p.id, p.category, p.title, p.created_at, p.image_id, p.prompt_id,
              (SELECT count(*) FROM lounge_comments c WHERE c.post_id=p.id AND c.is_hidden=false)::int AS comments
         FROM lounge_posts p WHERE p.user_id=$1 AND p.is_hidden=false AND p.category<>'secret'
        ORDER BY p.created_at DESC LIMIT 50`, [id])).rows;
  } else if (tab === 'prompts') {
    items = (await db.query(
      `SELECT p.id, p.title, p.category, p.image_ids, p.hearts, p.copiers, p.favs
         FROM lounge_prompts p WHERE p.user_id=$1 AND p.is_active AND p.status='live'
        ORDER BY p.created_at DESC LIMIT 60`, [id])).rows;
  } else {
    items = (await db.query(
      `SELECT c.id, left(c.body, 140) AS body, c.created_at, p.id AS post_id, p.title
         FROM lounge_comments c JOIN lounge_posts p ON p.id=c.post_id
        WHERE c.user_id=$1 AND c.is_hidden=false AND p.is_hidden=false AND p.category<>'secret'
        ORDER BY c.created_at DESC LIMIT 50`, [id])).rows;
  }
  res.render('lounge/member', {
    title: `${m.nickname}님의 프로필`, active: 'community', m, tab, items,
    isMe: !!(req.user && req.user.id === m.id),
    badge: m.role === 'admin' ? 'admin' : m.is_student || m.has_course ? 'student' : '',
  });
});

get('/my', member, async (req, res) => {
  const uid = req.user.id;
  const [pt, hist, enrolls] = await Promise.all([P.summary(uid), P.history(uid, 15), E.list(uid)]);
  const liveE = enrolls.filter((e) => e.is_active && e.product_id);
  const sp = liveE.map((e) => e.product_id);
  const hasCourse = liveE.some((e) => e.ptype === 'course');
  let upsell = 0; // 전자책만 가진 사람: 피드백 과정으로 넘어오면 차감되는 금액
  if (!hasCourse && liveE.some((e) => e.ptype === 'ebook')) {
    // 실제로 낸 금액을 차감 (기록이 없으면 지금 가격)
    const eb = liveE.find((e) => e.ptype === 'ebook');
    upsell = eb.amount || (await E.currentPrice(eb.product_id));
  }
  const { rows: stuRes } = sp.length ? await db.query(
    `SELECT id, title, section FROM lounge_resources
      WHERE is_active AND access='course' AND ((cardinality(product_ids)=0 AND $2) OR product_ids && $1::int[]) ORDER BY sort_order, id`, [sp, hasCourse]
  ) : { rows: [] };
  const [myReviews, posts, u, favs, resOpened, myPrompts] = await Promise.all([
    db.query(
      `SELECT r.id, r.status, r.rating, r.body, r.created_at, p.title AS product
         FROM lounge_reviews r LEFT JOIN lounge_products p ON p.id=r.product_id
        WHERE r.user_id=$1 ORDER BY r.created_at DESC LIMIT 10`, [uid]),
    db.query(`SELECT id, title, category, created_at FROM lounge_posts WHERE user_id=$1 AND is_hidden=false ORDER BY created_at DESC LIMIT 10`, [uid]),
    db.query(`SELECT status, referred_by, created_at FROM users WHERE id=$1`, [uid]),
    db.query(
      `SELECT p.id, p.title, p.image_ids FROM lounge_prompt_likes k JOIN lounge_prompts p ON p.id=k.prompt_id
        WHERE k.user_id=$1 AND p.is_active AND p.status='live' ORDER BY k.created_at DESC LIMIT 12`, [uid]),
    db.query(
      `SELECT r.id, r.title, r.section FROM lounge_unlocks x JOIN lounge_resources r ON r.id=x.resource_id
        WHERE x.user_id=$1 AND r.is_active ORDER BY x.created_at DESC LIMIT 12`, [uid]),
    db.query(
      `SELECT id, title, image_ids, status, fix_note, copies FROM lounge_prompts
        WHERE user_id=$1 ORDER BY (status='fix') DESC, created_at DESC LIMIT 24`, [uid]),
  ]);
  res.render('lounge/my', {
    title: '마이페이지', active: 'my',
    myReviews: myReviews.rows, posts: posts.rows, acct: u.rows[0], favs: favs.rows, opened: resOpened.rows, myPrompts: myPrompts.rows, pt, hist, enrolls, stuRes, upsell,
  });
});

/* ---------------- 대행 신청 (스레드 · 블로그) ---------------- */
const AGENCY = { threads: '스레드 운영 대행', blog: '블로그 운영 대행', both: '스레드 + 블로그', diag: '무료 계정 진단', unsure: '잘 모르겠어요 (상담 먼저)' };
const AGENCY_PAGES = require('./agency-data');
get('/agency/:svc(threads|blog)', (req, res) => {
  const d = AGENCY_PAGES[req.params.svc];
  res.render('lounge/agency-service', {
    title: d.name, active: 'library', d, AGENCY, sent: req.query.sent === '1', error: null,
    form: { service: d.key },
    ogT: `바이란 · ${d.name}`, ogD: d.sub,
  });
});
get('/agency', (req, res) => {
  res.render('lounge/agency', {
    title: '대행 문의', active: 'library', sent: req.query.sent === '1', error: null,
    form: { service: AGENCY[req.query.s] ? req.query.s : 'threads' }, AGENCY,
    ogT: '바이란 · 스레드·블로그 운영 대행', ogD: '직접 하기 어렵다면 맡겨 주세요. 스레드·블로그 운영 대행 신청.',
  });
});

post('/agency', async (req, res) => {
  if (String(req.body.website || '').trim()) return res.redirect('/agency?sent=1');
  const form = {
    service: AGENCY[req.body.service] ? req.body.service : 'unsure',
    name: String(req.body.name || '').trim().slice(0, 100),
    phone: String(req.body.phone || '').trim().slice(0, 40),
    industry: String(req.body.industry || '').trim().slice(0, 80),
    link: String(req.body.link || '').trim().slice(0, 300),
    message: String(req.body.message || '').trim().slice(0, 3000),
  };
  const svcBack = (String(req.body.back || '').match(/^\/agency\/(threads|blog)$/) || [])[1];
  const fail = (msg) => svcBack
    ? res.status(400).render('lounge/agency-service', { title: AGENCY_PAGES[svcBack].name, active: 'library', d: AGENCY_PAGES[svcBack], sent: false, error: msg, form, AGENCY })
    : res.status(400).render('lounge/agency', { title: '대행 문의', active: 'library', sent: false, error: msg, form, AGENCY });
  if (!form.name) return fail('이름이나 상호를 적어 주세요.');
  if (!form.phone) return fail('연락받을 번호나 카톡 아이디를 적어 주세요.');
  const { rows: cnt } = await db.query(
    `SELECT count(*)::int AS n FROM inquiries WHERE ip=$1 AND created_at > now() - interval '10 minutes'`, [req.ip]
  );
  if (cnt[0].n >= 5) return fail('신청이 여러 건 접수됐어요. 잠시 후 다시 시도해 주세요.');
  const msg = [form.link ? `계정·사이트: ${form.link}` : '', form.message].filter(Boolean).join('\n\n');
  const biz = [form.industry, req.user ? `라운지 회원 #${req.user.id}` : ''].filter(Boolean).join(' · ');
  await db.query(
    `INSERT INTO inquiries (name, phone, business, plan, message, ip) VALUES ($1,$2,$3,$4,$5,$6)`,
    [form.name, form.phone, biz.slice(0, 200) || null, `대행 신청 · ${AGENCY[form.service]}`.slice(0, 60), msg || null, req.ip]
  );
  const backTo = /^\/agency\/(threads|blog)$/.test(String(req.body.back || '')) ? req.body.back : '/agency';
  res.redirect(`${backTo}?sent=1#apply`);
});

/* ---------------- 1:1 상담 ---------------- */
const CONSULT_TYPES = { start: '시작하고 싶어요', grow: '매출을 올리고 싶어요', course: '강의·챌린지 문의', pay: '결제·환불', etc: '기타' };
get('/consult', (req, res) => {
  const t = CONSULT_TYPES[req.query.type] ? CONSULT_TYPES[req.query.type] : '';
  res.render('lounge/consult', { title: '1:1 상담', active: 'consult', sent: req.query.sent === '1', error: null, form: { type: t }, TYPES: Object.values(CONSULT_TYPES) });
});

post('/consult', async (req, res) => {
  if (String(req.body.website || '').trim()) return res.redirect('/consult?sent=1');
  const TYPES = Object.values(CONSULT_TYPES);
  const form = {
    type: TYPES.includes(req.body.type) ? req.body.type : '기타',
    name: String(req.body.name || (req.user && (req.user.nickname || req.user.name)) || '').trim().slice(0, 100),
    phone: String(req.body.phone || '').trim().slice(0, 40),
    message: String(req.body.message || '').trim().slice(0, 3000),
  };
  const fail = (msg) => res.status(400).render('lounge/consult', { title: '1:1 상담', active: 'consult', sent: false, error: msg, form, TYPES });
  if (!form.name) return fail('이름이나 닉네임을 적어 주세요.');
  if (!form.phone) return fail('연락받을 번호나 카톡 아이디를 적어 주세요.');
  const { rows: cnt } = await db.query(
    `SELECT count(*)::int AS n FROM inquiries WHERE ip=$1 AND created_at > now() - interval '10 minutes'`, [req.ip]
  );
  if (cnt[0].n >= 5) return fail('문의가 여러 건 접수됐어요. 잠시 후 다시 시도해 주세요.');
  await db.query(
    `INSERT INTO inquiries (name, phone, email, business, plan, message, ip) VALUES ($1,$2,NULL,$3,$4,$5,$6)`,
    [form.name, form.phone, req.user ? `라운지 회원 #${req.user.id}` : null, `라운지 상담 · ${form.type}`, form.message || null, req.ip]
  );
  res.redirect('/consult?sent=1');
});

module.exports = router;
