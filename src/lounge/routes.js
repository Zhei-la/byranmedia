/* 바이란 라운지: 회원 화면 */
const express = require('express');
const db = require('../db');
const L = require('./core');
const T = require('./translate');
const P = require('./points');
const E = require('./enroll');

const router = express.Router();

// async 함수에서 난 오류가 서버를 멈추지 않고 오류 화면으로 가도록 감싼다
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const get = (p, ...h) => router.get(p, ...h.map(wrap));
const post = (p, ...h) => router.post(p, ...h.map(wrap));

/* ---------------- 공통 ---------------- */
const LOUNGE_PATHS = ['/community', '/library', '/reviews', '/course', '/store', '/challenge', '/my', '/consult', '/onboard', '/prompts', '/agency'];

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
  } catch (e) {
    console.error('[라운지 공통]', e.message);
  }
  next();
}
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
    q(`SELECT p.id, p.category, p.title, p.is_pinned, p.views, p.created_at, p.user_id,
              COALESCE(u.nickname,u.name) AS nick, u.role,
              (SELECT count(*) FROM lounge_comments c WHERE c.post_id=p.id AND c.is_hidden=false)::int AS comments
         FROM lounge_posts p LEFT JOIN users u ON u.id=p.user_id
        WHERE p.is_hidden=false
        ORDER BY (p.category='notice' AND p.is_pinned) DESC, p.created_at DESC LIMIT 8`),
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
        WHERE is_active=true AND cardinality(image_ids) > 0 ORDER BY created_at DESC LIMIT 8`),
    q(`SELECT id, title, subtitle, price_text, list_price, price_note, badge, ptype FROM lounge_products WHERE is_active=true ORDER BY sort_order, id LIMIT 3`).then(E.priced),
  ]);

  res.render('lounge/home', {
    title: '', active: 'home',
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
    form: { nickname: req.user.nickname || '', interest: req.user.interest || '' },
    next: safeNext(req.query.next) || '',
  });
});

post('/onboard', async (req, res) => {
  if (!req.user) return res.redirect('/login');
  const nextUrl = safeNext(req.body.next) || '';
  const form = { nickname: String(req.body.nickname || ''), interest: String(req.body.interest || '') };
  const fail = (msg) => res.status(400).render('lounge/onboard', { title: '프로필 설정', error: msg, form, next: nextUrl });

  const chk = L.checkNick(form.nickname, { admin: isAdmin(req) });
  if (!chk.ok) return fail(chk.msg);
  const interest = L.INTERESTS.includes(form.interest) ? form.interest : null;
  const first = !req.user.nickname;
  try {
    await db.query(
      `UPDATE users SET nickname=$1, interest=$2, lounge_at=COALESCE(lounge_at, now()) WHERE id=$3`,
      [chk.value, interest, req.user.id]
    );
  } catch (e) {
    if (e.code === '23505') return fail('이미 누가 쓰고 있는 닉네임이에요.');
    throw e;
  }
  flash(req, first ? `환영해요, ${chk.value}님! 자료실에서 무료 자료집부터 챙겨 가세요 🎁` : '프로필을 바꿨어요.');
  res.redirect(nextUrl || (first ? '/library' : '/my'));
});

/* ---------------- 커뮤니티 ---------------- */
const PAGE = 15;

get('/community', async (req, res) => {
  const cat = L.CATEGORIES[req.query.cat] ? req.query.cat : 'all';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const showPinned = cat === 'all' || cat === 'notice';
  const params = [];
  let where = `p.is_hidden=false`;
  if (cat !== 'all') {
    params.push(cat);
    where += ` AND p.category=$${params.length}`;
  }
  // 고정 공지는 위에 따로 보여주므로 목록에서는 뺀다
  if (showPinned) where += ` AND NOT (p.category='notice' AND p.is_pinned)`;
  const { rows: cnt } = await db.query(`SELECT count(*)::int AS n FROM lounge_posts p WHERE ${where}`, params);
  const { rows: pinned } = showPinned && page === 1
    ? await db.query(
        `SELECT p.id, p.category, p.title, p.views, p.created_at, COALESCE(u.nickname,u.name) AS nick, u.role,
                (SELECT count(*) FROM lounge_likes l WHERE l.post_id=p.id)::int AS likes,
                (SELECT count(*) FROM lounge_comments c WHERE c.post_id=p.id AND c.is_hidden=false)::int AS comments
           FROM lounge_posts p LEFT JOIN users u ON u.id=p.user_id
          WHERE p.is_hidden=false AND p.category='notice' AND p.is_pinned=true
          ORDER BY p.created_at DESC LIMIT 5`)
    : { rows: [] };
  params.push(PAGE, (page - 1) * PAGE);
  const { rows: posts } = await db.query(
    `SELECT p.id, p.category, p.title, p.views, p.created_at, p.user_id, p.image_id,
            COALESCE(u.nickname,u.name) AS nick, u.role,
            (SELECT count(*) FROM lounge_likes l WHERE l.post_id=p.id)::int AS likes,
            (SELECT count(*) FROM lounge_comments c WHERE c.post_id=p.id AND c.is_hidden=false)::int AS comments
       FROM lounge_posts p LEFT JOIN users u ON u.id=p.user_id
      WHERE ${where}
      ORDER BY p.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const { rows: chat } = await db.query(
    `SELECT c.id, c.body, c.created_at, COALESCE(u.nickname,u.name) AS nick, u.role
       FROM lounge_chat c JOIN users u ON u.id=c.user_id
      WHERE c.is_hidden=false ORDER BY c.id DESC LIMIT 30`
  );
  const pt = req.user && req.user.nickname ? await P.summary(req.user.id) : null;
  res.render('lounge/community', {
    title: '커뮤니티', active: 'community', cat, page, pt,
    pages: Math.max(1, Math.ceil(cnt[0].n / PAGE)), total: cnt[0].n,
    pinned, posts, chat: chat.reverse(), write: req.query.write === '1',
    writeCat: L.CATEGORIES[req.query.wc] ? req.query.wc : (cat !== 'all' && cat !== 'notice' ? cat : 'hello'),
  });
});

post('/community', member, async (req, res) => {
  let category = L.CATEGORIES[req.body.category] ? req.body.category : 'free';
  if (category === 'notice' && !isAdmin(req)) category = 'free';
  const title = String(req.body.title || '').trim().slice(0, 120);
  const body = String(req.body.body || '').trim().slice(0, 5000);
  if (!title || !body) {
    flash(req, '제목과 내용을 모두 적어 주세요.');
    return res.redirect(`/community?write=1&wc=${category}`);
  }
  // 도배 방지: 1분에 3개까지
  const { rows: rc } = await db.query(
    `SELECT count(*)::int AS n FROM lounge_posts WHERE user_id=$1 AND created_at > now() - interval '1 minute'`,
    [req.user.id]
  );
  if (rc[0].n >= 3 && !isAdmin(req)) {
    flash(req, '글을 너무 빨리 올리고 있어요. 잠시 후 다시 올려 주세요.');
    return res.redirect('/community');
  }
  const imageId = req.body.image ? await L.saveImage(req.user.id, req.body.image) : null;
  const pinned = category === 'notice' && req.body.pinned === '1';
  const { rows } = await db.query(
    `INSERT INTO lounge_posts (user_id, category, title, body, image_id, is_pinned)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [req.user.id, category, title, body, imageId, pinned]
  );
  let got = 0;
  const r = await P.rules();
  const earnable = category !== 'notice' && category !== 'secret';
  if (earnable && body.length >= r.postMin) got = await P.earn(req.user.id, 'post', rows[0].id);
  if (got) flash(req, `글을 올렸어요. +${got}P 적립! 💎`);
  else if (earnable && body.length < r.postMin) flash(req, `글을 올렸어요. (내용이 ${r.postMin}자 이상이면 포인트가 쌓여요)`);
  else if (earnable) flash(req, `글을 올렸어요. 오늘 글 포인트는 다 받았어요 (하루 ${r.postDaily}개까지).`);
  else flash(req, '글을 올렸어요.');
  res.redirect(`/community/${rows[0].id}`);
});

async function loadPost(id) {
  const { rows } = await db.query(
    `SELECT p.*, COALESCE(u.nickname,u.name) AS nick, u.role,
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
  if (!locked) db.query(`UPDATE lounge_posts SET views=views+1 WHERE id=$1`, [p.id]).catch(() => {});
  const { rows: comments } = locked ? { rows: [] } : await db.query(
    `SELECT c.id, c.body, c.created_at, c.user_id, COALESCE(u.nickname,u.name) AS nick, u.role
       FROM lounge_comments c LEFT JOIN users u ON u.id=c.user_id
      WHERE c.post_id=$1 AND c.is_hidden=false ORDER BY c.created_at`,
    [p.id]
  );
  let liked = false;
  if (req.user) {
    const r = await db.query(`SELECT 1 FROM lounge_likes WHERE post_id=$1 AND user_id=$2`, [p.id, req.user.id]);
    liked = r.rows.length > 0;
  }
  res.render('lounge/post', { title: locked ? '비밀글' : p.title, active: 'community', p, comments, liked, locked });
});

post('/community/:id(\\d+)/comment', member, async (req, res) => {
  const p = await loadPost(req.params.id);
  if (!p || !canSee(req, p)) return res.redirect('/community');
  const body = String(req.body.body || '').trim().slice(0, 1000);
  if (!body) return res.redirect(`/community/${p.id}`);
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
  const { rows } = await db.query(
    `SELECT c.id, c.body, c.created_at, COALESCE(u.nickname,u.name) AS nick, u.role
       FROM lounge_chat c JOIN users u ON u.id=c.user_id
      WHERE c.is_hidden=false AND c.id > $1 ORDER BY c.id DESC LIMIT 40`,
    [after]
  );
  const { rows: on } = await db.query(
    `SELECT count(DISTINCT user_id)::int AS n FROM lounge_chat WHERE created_at > now() - interval '30 minutes'`
  );
  res.json({
    online: on[0].n,
    items: rows.reverse().map((m) => ({ id: m.id, nick: m.nick, admin: m.role === 'admin', body: m.body, ago: L.ago(m.created_at) })),
  });
});

post('/chat', member, async (req, res) => {
  const body = String(req.body.body || '').trim().slice(0, 300);
  if (!body) return res.status(400).json({ error: '내용을 적어 주세요.' });
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
const P_PAGE = 24;

get('/prompts', async (req, res) => {
  const cat = L.PROMPT_CATS.includes(req.query.cat) ? req.query.cat : '';
  const q = String(req.query.q || '').trim().slice(0, 60);
  const sort = req.query.sort === 'popular' ? 'popular' : 'new';
  const fav = req.query.fav === '1' && req.user;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);

  const params = [];
  let where = 'p.is_active=true';
  if (cat) { params.push(cat); where += ` AND p.category=$${params.length}`; }
  if (q) { params.push(`%${q}%`); where += ` AND (p.title ILIKE $${params.length} OR p.prompt ILIKE $${params.length})`; }
  if (fav) { params.push(req.user.id); where += ` AND EXISTS (SELECT 1 FROM lounge_prompt_likes k WHERE k.prompt_id=p.id AND k.user_id=$${params.length})`; }

  const { rows: cnt } = await db.query(`SELECT count(*)::int AS n FROM lounge_prompts p WHERE ${where}`, params);
  params.push(P_PAGE, (page - 1) * P_PAGE);
  const order = sort === 'popular' ? 'p.copies DESC, p.views DESC, p.id DESC' : 'p.created_at DESC, p.id DESC';
  const { rows: items } = await db.query(
    `SELECT p.id, p.title, p.category, p.image_ids, left(p.prompt, 140) AS preview, p.copies
       FROM lounge_prompts p WHERE ${where} ORDER BY ${order}
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const { rows: cats } = await db.query(
    `SELECT category, count(*)::int AS n FROM lounge_prompts WHERE is_active GROUP BY category`
  );
  const { rows: tot } = await db.query(`SELECT count(*)::int AS n FROM lounge_prompts WHERE is_active`);
  res.render('lounge/prompts', {
    title: 'AI 프롬프트', active: 'prompts', items, cat, q, sort, fav: !!fav, page,
    pages: Math.max(1, Math.ceil(cnt[0].n / P_PAGE)), total: cnt[0].n, all: tot[0].n,
    catCount: Object.fromEntries(cats.map((c) => [c.category, c.n])),
    ogT: '바이란 AI 프롬프트 모음 · 이미지 누르고 바로 복사',
    ogD: 'AI 인물·화보·캐릭터 이미지 프롬프트 모음. 마음에 드는 이미지를 누르면 프롬프트를 볼 수 있어요.',
  });
});

get('/prompts/builder', (req, res) => {
  res.render('lounge/builder', {
    title: '프롬프트 생성기', active: 'prompts', aiOn: T.aiReady(),
    ogT: '프롬프트 생성기 · 칸만 채우면 완성',
    ogD: '인물·화보·제품 이미지 프롬프트를 칸만 채워서 만들어요. 미드저니·챗지피티·Flux용.',
  });
});

get('/prompts/:id(\\d+)', async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM lounge_prompts WHERE id=$1 AND (is_active OR $2)`, [req.params.id, !!isAdmin(req)]);
  const p = rows[0];
  if (!p) return res.status(404).render('error', { title: '없는 프롬프트', message: '지워졌거나 없는 프롬프트예요.' });
  db.query(`UPDATE lounge_prompts SET views=views+1 WHERE id=$1`, [p.id]).catch(() => {});
  const S = res.locals.S;
  const canCopy = S.prompt_public === '1' || !!(req.user && req.user.nickname);
  let liked = false;
  if (req.user) {
    const r = await db.query(`SELECT 1 FROM lounge_prompt_likes WHERE prompt_id=$1 AND user_id=$2`, [p.id, req.user.id]);
    liked = r.rows.length > 0;
  }
  const { rows: more } = await db.query(
    `SELECT id, title, image_ids FROM lounge_prompts
      WHERE is_active AND id<>$1 AND category=$2 AND cardinality(image_ids)>0 ORDER BY created_at DESC LIMIT 4`,
    [p.id, p.category]
  );
  res.render('lounge/prompt', {
    title: p.title, active: 'prompts', p, canCopy, liked, more,
    // 로그인 전에는 앞부분만 보여준다
    shown: canCopy ? p.prompt : p.prompt.slice(0, Math.min(220, Math.floor(p.prompt.length * 0.35))),
    ogT: `${p.title} · 바이란 AI 프롬프트`,
    ogD: '이미지를 누르면 프롬프트를 바로 복사할 수 있어요.',
    ogImg: p.image_ids[0] ? `/u/img/${p.image_ids[0]}` : null,
  });
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

post('/prompts/:id(\\d+)/copied', async (req, res) => {
  await db.query(`UPDATE lounge_prompts SET copies=copies+1 WHERE id=$1`, [req.params.id]).catch(() => {});
  res.json({ ok: true });
});

post('/prompts/:id(\\d+)/like', member, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const del = await db.query(`DELETE FROM lounge_prompt_likes WHERE prompt_id=$1 AND user_id=$2`, [id, req.user.id]);
  if (!del.rowCount) {
    await db.query(`INSERT INTO lounge_prompt_likes (prompt_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, req.user.id]).catch(() => {});
  }
  if (wantsJson(req)) return res.json({ liked: !del.rowCount });
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
  const [myReviews, posts, u, favs, resOpened] = await Promise.all([
    db.query(
      `SELECT r.id, r.status, r.rating, r.body, r.created_at, p.title AS product
         FROM lounge_reviews r LEFT JOIN lounge_products p ON p.id=r.product_id
        WHERE r.user_id=$1 ORDER BY r.created_at DESC LIMIT 10`, [uid]),
    db.query(`SELECT id, title, category, created_at FROM lounge_posts WHERE user_id=$1 AND is_hidden=false ORDER BY created_at DESC LIMIT 10`, [uid]),
    db.query(`SELECT status, referred_by, created_at FROM users WHERE id=$1`, [uid]),
    db.query(
      `SELECT p.id, p.title, p.image_ids FROM lounge_prompt_likes k JOIN lounge_prompts p ON p.id=k.prompt_id
        WHERE k.user_id=$1 AND p.is_active ORDER BY k.created_at DESC LIMIT 12`, [uid]),
    db.query(
      `SELECT r.id, r.title, r.section FROM lounge_unlocks x JOIN lounge_resources r ON r.id=x.resource_id
        WHERE x.user_id=$1 AND r.is_active ORDER BY x.created_at DESC LIMIT 12`, [uid]),
  ]);
  res.render('lounge/my', {
    title: '마이페이지', active: 'my',
    myReviews: myReviews.rows, posts: posts.rows, acct: u.rows[0], favs: favs.rows, opened: resOpened.rows, pt, hist, enrolls, stuRes, upsell,
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
