/* 바이란 라운지: 회원 화면 */
const express = require('express');
const db = require('../db');
const L = require('./core');

const router = express.Router();

/* ---------------- 공통 ---------------- */
const LOUNGE_PATHS = ['/', '/community', '/library', '/reviews', '/store', '/challenge', '/my', '/consult', '/onboard'];

// 라운지 화면마다 필요한 값
async function locals(req, res, next) {
  try {
    res.locals.L = L;
    res.locals.S = await L.settings();
    res.locals.me = null;
    res.locals.active = '';
    res.locals.flash = req.session ? req.session.flash || null : null;
    if (req.session && req.session.flash) delete req.session.flash;
    if (req.user) {
      res.locals.me = await L.summary(req.user.id);
      res.locals.nick = req.user.nickname || req.user.name;
    }
  } catch (e) {
    console.error('[라운지 공통]', e.message);
  }
  next();
}
router.use(LOUNGE_PATHS.map((p) => (p === '/' ? /^\/$/ : new RegExp('^' + p + '(/|$)'))), locals);

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

/** 로그인 + 닉네임 설정까지 끝난 회원 */
function member(req, res, next) {
  if (!req.user) {
    if (req.method === 'GET') return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    return res.status(401).json({ error: '로그인이 필요해요.' });
  }
  if (req.user.status === 'suspended') {
    return res.status(403).render('error', { title: '이용이 중지된 계정', message: '문의가 필요하면 카카오톡 채널로 연락해 주세요.' });
  }
  if (!req.user.nickname) {
    if (req.method === 'GET') return res.redirect(`/onboard?next=${encodeURIComponent(req.originalUrl)}`);
    flash(req, '먼저 닉네임을 정해 주세요.');
    return res.redirect('/onboard');
  }
  next();
}
const isAdmin = (req) => req.user && req.user.role === 'admin';

/* ---------------- 홈 ---------------- */
router.get('/', async (req, res) => {
  const q = (sql, p) => db.query(sql, p).then((r) => r.rows).catch((e) => { console.error('[홈]', e.message); return []; });

  const [stat] = await q(
    `SELECT (SELECT count(*) FROM users WHERE nickname IS NOT NULL)::int AS members,
            (SELECT count(*) FROM lounge_points WHERE reason='attend' AND day=(now() AT TIME ZONE 'Asia/Seoul')::date)::int AS today_attend,
            (SELECT count(*) FROM lounge_posts WHERE category='proof' AND is_hidden=false)::int AS proofs,
            (SELECT count(*) FROM lounge_results WHERE is_hidden=false)::int AS results,
            (SELECT count(*) FROM lounge_reviews WHERE status='approved')::int AS reviews`
  );
  const [proofs, results, board, chat, gifts, reviews, cohort, rank] = await Promise.all([
    q(`SELECT p.id, p.body, p.title, p.created_at, COALESCE(u.nickname,u.name) AS nick,
              (SELECT count(*) FROM lounge_likes l WHERE l.post_id=p.id)::int AS likes,
              (SELECT COALESCE(sum(amount) FILTER (WHERE amount>0),0) FROM lounge_points x WHERE x.user_id=u.id)::int AS earned
         FROM lounge_posts p JOIN users u ON u.id=p.user_id
        WHERE p.category='proof' AND p.is_hidden=false
        ORDER BY p.created_at DESC LIMIT 4`),
    q(`SELECT r.id, r.kind, r.headline, r.channel, r.image_id, COALESCE(u.nickname,u.name) AS nick
         FROM lounge_results r JOIN users u ON u.id=r.user_id
        WHERE r.is_hidden=false ORDER BY r.created_at DESC LIMIT 12`),
    q(`SELECT p.id, p.category, p.title, p.is_pinned, p.views, p.created_at, p.user_id,
              COALESCE(u.nickname,u.name) AS nick, u.role,
              (SELECT count(*) FROM lounge_comments c WHERE c.post_id=p.id AND c.is_hidden=false)::int AS comments,
              (SELECT count(*) FROM lounge_likes l WHERE l.post_id=p.id)::int AS likes
         FROM lounge_posts p LEFT JOIN users u ON u.id=p.user_id
        WHERE p.is_hidden=false
        ORDER BY (p.category='notice' AND p.is_pinned) DESC, p.created_at DESC LIMIT 8`),
    q(`SELECT c.id, c.body, c.created_at, COALESCE(u.nickname,u.name) AS nick, u.role
         FROM lounge_chat c JOIN users u ON u.id=c.user_id
        WHERE c.is_hidden=false ORDER BY c.id DESC LIMIT 6`),
    q(`SELECT id, title, description, kind, cost, is_welcome FROM lounge_resources
        WHERE is_active=true ORDER BY is_welcome DESC, sort_order, id LIMIT 4`),
    q(`SELECT r.id, r.rating, r.body, r.industry, COALESCE(r.author_name, u.nickname, u.name) AS nick, p.title AS product
         FROM lounge_reviews r LEFT JOIN users u ON u.id=r.user_id LEFT JOIN lounge_products p ON p.id=r.product_id
        WHERE r.status='approved' ORDER BY r.approved_at DESC NULLS LAST, r.id DESC LIMIT 6`),
    q(`SELECT id, name, title, start_date, days, status FROM lounge_cohorts
        WHERE status IN ('recruiting','running') ORDER BY start_date DESC LIMIT 1`),
    L.rankings(),
  ]);

  res.render('lounge/home', {
    title: '', active: 'home',
    stat: stat || {}, proofs, results, board, chat: chat.reverse(), gifts, reviews,
    cohort: cohort[0] || null, rank,
    ogT: '바이란 라운지 · AI로 시작하는 1인 창업 커뮤니티',
    ogD: '출석하고, 인증하고, 같이 성장해요. 가입하면 무료 자료를 바로 드려요.',
  });
});

/* ---------------- 닉네임 설정 (첫 방문) ---------------- */
router.get('/onboard', (req, res) => {
  if (!req.user) return res.redirect('/login');
  if (req.user.nickname && !req.query.edit) return res.redirect(safeNext(req.query.next) || '/');
  res.render('lounge/onboard', {
    title: '프로필 설정', error: null,
    form: { nickname: req.user.nickname || '', interest: req.user.interest || '' },
    next: safeNext(req.query.next) || '',
  });
});

router.post('/onboard', async (req, res) => {
  if (!req.user) return res.redirect('/login');
  const nextUrl = safeNext(req.body.next) || '';
  const form = { nickname: String(req.body.nickname || ''), interest: String(req.body.interest || '') };
  const fail = (msg) => res.status(400).render('lounge/onboard', { title: '프로필 설정', error: msg, form, next: nextUrl });

  const chk = L.checkNick(form.nickname);
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
  if (first) {
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM lounge_resources WHERE is_active AND is_welcome`);
    flash(req, rows[0].n
      ? `환영해요, ${chk.value}님! 가입 선물 ${rows[0].n}개가 보관함에 들어갔어요 🎁`
      : `환영해요, ${chk.value}님! 오늘 출석부터 찍어볼까요?`);
  } else {
    flash(req, '프로필을 바꿨어요.');
  }
  res.redirect(nextUrl || (first ? '/' : '/my'));
});

function safeNext(v) {
  const s = String(v || '');
  return s.startsWith('/') && !s.startsWith('//') ? s : '';
}

/* ---------------- 출석 ---------------- */
router.post('/attend', member, async (req, res) => {
  const got = await L.award(req.user.id, 'attend');
  flash(req, got ? `출석 완료! +${got}P` : '오늘은 이미 출석했어요. 내일 또 만나요!');
  res.redirect(back(req));
});

/* ---------------- 커뮤니티 ---------------- */
const PAGE = 15;

router.get('/community', async (req, res) => {
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
            (SELECT count(*) FROM lounge_comments c WHERE c.post_id=p.id AND c.is_hidden=false)::int AS comments,
            (SELECT COALESCE(sum(amount) FILTER (WHERE amount>0),0) FROM lounge_points x WHERE x.user_id=u.id)::int AS earned
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
  res.render('lounge/community', {
    title: '커뮤니티', active: 'community', cat, page,
    pages: Math.max(1, Math.ceil(cnt[0].n / PAGE)), total: cnt[0].n,
    pinned, posts, chat: chat.reverse(), write: req.query.write === '1',
    writeCat: L.CATEGORIES[req.query.wc] ? req.query.wc : (cat !== 'all' && cat !== 'notice' ? cat : 'proof'),
  });
});

router.post('/community', member, async (req, res) => {
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
  if (category === 'proof') got = await L.award(req.user.id, 'proof', { refId: rows[0].id });
  if (category === 'hello') got = await L.award(req.user.id, 'hello', { refId: rows[0].id });
  flash(req, got ? `글을 올렸어요. +${got}P` : '글을 올렸어요.');
  res.redirect(`/community/${rows[0].id}`);
});

async function loadPost(id) {
  const { rows } = await db.query(
    `SELECT p.*, COALESCE(u.nickname,u.name) AS nick, u.role,
            (SELECT COALESCE(sum(amount) FILTER (WHERE amount>0),0) FROM lounge_points x WHERE x.user_id=u.id)::int AS earned,
            (SELECT count(*) FROM lounge_likes l WHERE l.post_id=p.id)::int AS likes
       FROM lounge_posts p LEFT JOIN users u ON u.id=p.user_id WHERE p.id=$1`,
    [id]
  );
  return rows[0] || null;
}
const canSee = (req, p) => !p.is_hidden && (p.category !== 'secret' || (req.user && (req.user.id === p.user_id || isAdmin(req))));

router.get('/community/:id(\\d+)', async (req, res) => {
  const p = await loadPost(req.params.id);
  if (!p || (p.is_hidden && !isAdmin(req))) {
    return res.status(404).render('error', { title: '없는 글', message: '지워졌거나 없는 글이에요.' });
  }
  const locked = !canSee(req, p) && !isAdmin(req);
  if (!locked) db.query(`UPDATE lounge_posts SET views=views+1 WHERE id=$1`, [p.id]).catch(() => {});
  const { rows: comments } = locked ? { rows: [] } : await db.query(
    `SELECT c.id, c.body, c.created_at, c.user_id, COALESCE(u.nickname,u.name) AS nick, u.role,
            (SELECT COALESCE(sum(amount) FILTER (WHERE amount>0),0) FROM lounge_points x WHERE x.user_id=u.id)::int AS earned
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

router.post('/community/:id(\\d+)/comment', member, async (req, res) => {
  const p = await loadPost(req.params.id);
  if (!p || !canSee(req, p)) return res.redirect('/community');
  const body = String(req.body.body || '').trim().slice(0, 1000);
  if (!body) return res.redirect(`/community/${p.id}`);
  const { rows } = await db.query(
    `INSERT INTO lounge_comments (post_id, user_id, body) VALUES ($1,$2,$3) RETURNING id`,
    [p.id, req.user.id, body]
  );
  const got = p.user_id !== req.user.id ? await L.award(req.user.id, 'comment', { refId: rows[0].id }) : 0;
  flash(req, got ? `댓글을 달았어요. +${got}P` : '댓글을 달았어요.');
  res.redirect(`/community/${p.id}#c${rows[0].id}`);
});

router.post('/community/:id(\\d+)/like', member, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const del = await db.query(`DELETE FROM lounge_likes WHERE post_id=$1 AND user_id=$2`, [id, req.user.id]);
  if (!del.rowCount) {
    await db.query(`INSERT INTO lounge_likes (post_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, req.user.id]).catch(() => {});
  }
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM lounge_likes WHERE post_id=$1`, [id]);
  if (req.xhr || (req.get('accept') || '').includes('json')) return res.json({ liked: !del.rowCount, likes: rows[0].n });
  res.redirect(`/community/${id}`);
});

router.post('/community/:id(\\d+)/delete', member, async (req, res) => {
  const p = await loadPost(req.params.id);
  if (p && (p.user_id === req.user.id || isAdmin(req))) {
    await db.query(`UPDATE lounge_posts SET is_hidden=true WHERE id=$1`, [p.id]);
    flash(req, '글을 지웠어요.');
  }
  res.redirect('/community');
});

router.post('/community/:id(\\d+)/pin', member, async (req, res) => {
  if (isAdmin(req)) await db.query(`UPDATE lounge_posts SET is_pinned = NOT is_pinned WHERE id=$1`, [req.params.id]);
  res.redirect(`/community/${req.params.id}`);
});

router.post('/comments/:id(\\d+)/delete', member, async (req, res) => {
  const { rows } = await db.query(`SELECT post_id, user_id FROM lounge_comments WHERE id=$1`, [req.params.id]);
  if (rows[0] && (rows[0].user_id === req.user.id || isAdmin(req))) {
    await db.query(`UPDATE lounge_comments SET is_hidden=true WHERE id=$1`, [req.params.id]);
  }
  res.redirect(rows[0] ? `/community/${rows[0].post_id}` : '/community');
});

/* ---------------- 신고 ---------------- */
router.post('/report', member, async (req, res) => {
  const type = ['post', 'comment', 'chat', 'result'].includes(req.body.type) ? req.body.type : null;
  const id = parseInt(req.body.id, 10);
  if (type && id) {
    await db.query(
      `INSERT INTO lounge_reports (target_type, target_id, user_id, reason) VALUES ($1,$2,$3,$4)`,
      [type, id, req.user.id, String(req.body.reason || '').slice(0, 40)]
    );
  }
  if ((req.get('accept') || '').includes('json')) return res.json({ ok: true });
  flash(req, '신고가 접수됐어요. 운영자가 확인할게요.');
  res.redirect(back(req));
});

/* ---------------- 실시간 채팅 ---------------- */
router.get('/chat/messages', async (req, res) => {
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

router.post('/chat', member, async (req, res) => {
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
router.post('/results', member, async (req, res) => {
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
  const { rows } = await db.query(
    `INSERT INTO lounge_results (user_id, image_id, kind, headline, channel) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [req.user.id, imageId, kind, headline, channel]
  );
  const got = await L.award(req.user.id, 'result', { refId: rows[0].id });
  flash(req, got ? `성과를 올렸어요! +${got}P` : '성과를 올렸어요!');
  res.redirect(back(req));
});

router.post('/results/:id(\\d+)/delete', member, async (req, res) => {
  const { rows } = await db.query(`SELECT user_id FROM lounge_results WHERE id=$1`, [req.params.id]);
  if (rows[0] && (rows[0].user_id === req.user.id || isAdmin(req))) {
    await db.query(`UPDATE lounge_results SET is_hidden=true WHERE id=$1`, [req.params.id]);
  }
  res.redirect(back(req));
});

/* ---------------- 사진 보기 ---------------- */
router.get('/u/img/:id(\\d+)', async (req, res) => {
  const { rows } = await db.query(`SELECT mime, data FROM lounge_images WHERE id=$1`, [req.params.id]);
  if (!rows.length) return res.status(404).end();
  res.set('Content-Type', rows[0].mime);
  res.set('Cache-Control', 'public, max-age=2592000, immutable');
  res.send(rows[0].data);
});

/* ---------------- 자료실 ---------------- */
async function ownedSet(userId) {
  if (!userId) return new Set();
  const { rows } = await db.query(`SELECT resource_id FROM lounge_unlocks WHERE user_id=$1`, [userId]);
  return new Set(rows.map((r) => r.resource_id));
}
const owns = (r, set, user) => !!user && user.nickname && (r.is_welcome || set.has(r.id));

router.get('/library', async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, title, description, kind, cost, is_welcome FROM lounge_resources
      WHERE is_active=true ORDER BY is_welcome DESC, cost, sort_order, id`
  );
  const set = await ownedSet(req.user && req.user.id);
  const items = rows.map((r) => ({ ...r, owned: owns(r, set, req.user) }));
  let history = [];
  if (req.user) {
    const h = await db.query(
      `SELECT amount, reason, memo, created_at FROM lounge_points WHERE user_id=$1 ORDER BY created_at DESC LIMIT 8`,
      [req.user.id]
    );
    history = h.rows;
  }
  res.render('lounge/library', { title: '자료실', active: 'library', items, history });
});

router.post('/library/:id(\\d+)/unlock', member, async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM lounge_resources WHERE id=$1 AND is_active=true`, [req.params.id]);
  const r = rows[0];
  if (!r) return res.redirect('/library');
  const set = await ownedSet(req.user.id);
  if (owns(r, set, req.user)) return res.redirect(`/library/${r.id}`);
  if (r.cost > 0) {
    const ok = await L.spend(req.user.id, r.cost, 'unlock', r.id, r.title.slice(0, 120));
    if (!ok) {
      flash(req, `포인트가 모자라요. ${r.cost}P가 필요해요.`);
      return res.redirect('/library');
    }
  }
  await db.query(`INSERT INTO lounge_unlocks (user_id, resource_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.user.id, r.id]);
  flash(req, `「${r.title}」을 열었어요. 보관함에도 담겼어요.`);
  res.redirect(`/library/${r.id}`);
});

router.get('/library/:id(\\d+)', member, async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM lounge_resources WHERE id=$1 AND is_active=true`, [req.params.id]);
  const r = rows[0];
  if (!r) return res.status(404).render('error', { title: '없는 자료', message: '자료를 찾지 못했어요.' });
  const set = await ownedSet(req.user.id);
  if (!owns(r, set, req.user) && !isAdmin(req)) {
    flash(req, '먼저 자료를 열어 주세요.');
    return res.redirect('/library');
  }
  res.render('lounge/resource', { title: r.title, active: 'library', r, url: L.safeUrl(r.url) });
});

/* ---------------- 후기 ---------------- */
router.get('/reviews', async (req, res) => {
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
  res.render('lounge/reviews', {
    title: '후기', active: 'reviews', products, reviews, results, all, pid, st: st[0],
    write: req.query.write === '1',
  });
});

router.post('/reviews', member, async (req, res) => {
  const body = String(req.body.body || '').trim().slice(0, 3000);
  if (body.length < 10) {
    flash(req, '후기는 10자 이상 적어 주세요.');
    return res.redirect('/reviews?write=1');
  }
  const rating = Math.min(5, Math.max(1, parseInt(req.body.rating, 10) || 5));
  const productId = parseInt(req.body.product_id, 10) || null;
  const industry = String(req.body.industry || '').trim().slice(0, 40) || null;
  const imageId = req.body.image ? await L.saveImage(req.user.id, req.body.image) : null;
  await db.query(
    `INSERT INTO lounge_reviews (user_id, product_id, rating, industry, body, image_id) VALUES ($1,$2,$3,$4,$5,$6)`,
    [req.user.id, productId, rating, industry, body, imageId]
  );
  flash(req, '후기를 보냈어요. 운영자가 확인한 뒤 올라가고, 그때 50P를 드려요.');
  res.redirect('/reviews');
});

/* ---------------- 스토어 ---------------- */
router.get('/store', async (req, res) => {
  const { rows: products } = await db.query(
    `SELECT p.*, (SELECT count(*) FROM lounge_reviews r WHERE r.product_id=p.id AND r.status='approved')::int AS reviews
       FROM lounge_products p WHERE p.is_active=true ORDER BY p.sort_order, p.id`
  );
  res.render('lounge/store', { title: '스토어', active: 'store', products });
});

router.post('/store/:id(\\d+)/points', member, async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM lounge_products WHERE id=$1 AND is_active=true`, [req.params.id]);
  const p = rows[0];
  if (!p || !p.point_price || !p.resource_id) return res.redirect('/store');
  const set = await ownedSet(req.user.id);
  if (set.has(p.resource_id)) {
    flash(req, '이미 가지고 있는 자료예요. 보관함에서 여세요.');
    return res.redirect('/my#box');
  }
  const ok = await L.spend(req.user.id, p.point_price, 'buy', p.id, p.title.slice(0, 120));
  if (!ok) {
    flash(req, `포인트가 모자라요. ${p.point_price.toLocaleString()}P가 필요해요.`);
    return res.redirect('/store');
  }
  await db.query(`INSERT INTO lounge_unlocks (user_id, resource_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.user.id, p.resource_id]);
  flash(req, `「${p.title}」을 포인트로 받았어요 🎉 보관함에 담겼어요.`);
  res.redirect(`/library/${p.resource_id}`);
});

/* ---------------- 챌린지 ---------------- */
function dayIndex(startDate) {
  // 오늘(한국 시간)이 시작일로부터 몇 번째 날인지. 시작 전이면 0 이하.
  const s = new Date(String(startDate instanceof Date ? startDate.toISOString() : startDate).slice(0, 10) + 'T00:00:00Z');
  const t = new Date(L.kstToday() + 'T00:00:00Z');
  return Math.floor((t - s) / 86400000) + 1;
}

router.get('/challenge', async (req, res) => {
  const { rows: cohorts } = await db.query(
    `SELECT * FROM lounge_cohorts ORDER BY start_date DESC, id DESC LIMIT 20`
  );
  const cur = cohorts.find((c) => c.status !== 'ended') || null;
  let mine = null, missions = [], subs = new Set(), board = [], pendingList = [], past = [];
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
          GROUP BY u.id ORDER BY done DESC, nick LIMIT 100`,
        [cur.id]
      )).rows;
    }
    if (isAdmin(req)) {
      pendingList = (await db.query(
        `SELECT m.*, COALESCE(u.nickname,u.name) AS nick FROM lounge_cohort_members m JOIN users u ON u.id=m.user_id
          WHERE m.cohort_id=$1 AND m.status='pending' ORDER BY m.created_at`,
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
  const { rows: product } = await db.query(
    `SELECT id, title, price_text, buy_url FROM lounge_products WHERE is_challenge AND is_active ORDER BY sort_order LIMIT 1`
  );
  const today = cur ? dayIndex(cur.start_date) : 0;
  res.render('lounge/challenge', {
    title: '챌린지', active: 'challenge', cur, mine, missions, subs, board, pendingList, past,
    today, product: product[0] || null,
    open: Number(req.query.m) || null,
  });
});

router.post('/challenge/apply', member, async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM lounge_cohorts WHERE id=$1 AND status <> 'ended'`, [req.body.cohort_id]);
  const c = rows[0];
  if (!c) return res.redirect('/challenge');
  const orderNo = String(req.body.order_no || '').trim().slice(0, 60);
  const contact = String(req.body.contact || '').trim().slice(0, 80);
  if (!orderNo || !contact) {
    flash(req, '주문번호와 연락처를 모두 적어 주세요.');
    return res.redirect('/challenge');
  }
  await db.query(
    `INSERT INTO lounge_cohort_members (cohort_id, user_id, order_no, contact) VALUES ($1,$2,$3,$4)
     ON CONFLICT (cohort_id, user_id) DO UPDATE SET order_no=EXCLUDED.order_no, contact=EXCLUDED.contact,
       status=CASE WHEN lounge_cohort_members.status='approved' THEN 'approved' ELSE 'pending' END`,
    [c.id, req.user.id, orderNo, contact]
  );
  flash(req, '참가 신청을 받았어요. 결제를 확인하면 바로 열어 드릴게요.');
  res.redirect('/challenge');
});

router.post('/challenge/submit', member, async (req, res) => {
  const { rows } = await db.query(
    `SELECT m.*, c.start_date, c.status AS cstatus FROM lounge_missions m JOIN lounge_cohorts c ON c.id=m.cohort_id WHERE m.id=$1`,
    [req.body.mission_id]
  );
  const m = rows[0];
  if (!m) return res.redirect('/challenge');
  const mem = await db.query(
    `SELECT status FROM lounge_cohort_members WHERE cohort_id=$1 AND user_id=$2`, [m.cohort_id, req.user.id]
  );
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
    return res.redirect(`/challenge?m=${m.id}#m${m.id}`);
  }
  await db.query(
    `INSERT INTO lounge_submissions (cohort_id, mission_id, user_id, body, link) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (mission_id, user_id) DO UPDATE SET body=EXCLUDED.body, link=EXCLUDED.link`,
    [m.cohort_id, m.id, req.user.id, body, link]
  );
  const got = await L.award(req.user.id, 'mission', { refId: m.id, memo: `Day ${m.day}` });
  flash(req, got ? `Day ${m.day} 미션 완료! +${got}P` : `Day ${m.day} 제출물을 고쳤어요.`);
  res.redirect(`/challenge#m${m.id}`);
});

/* ---------------- 마이페이지 ---------------- */
router.get('/my', member, async (req, res) => {
  const uid = req.user.id;
  const [ledger, box, myReviews, posts, u] = await Promise.all([
    db.query(`SELECT amount, reason, memo, created_at FROM lounge_points WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30`, [uid]),
    db.query(
      `SELECT r.id, r.title, r.kind, r.description FROM lounge_resources r
        WHERE r.is_active AND (r.is_welcome OR r.id IN (SELECT resource_id FROM lounge_unlocks WHERE user_id=$1))
        ORDER BY r.is_welcome DESC, r.sort_order, r.id`, [uid]),
    db.query(
      `SELECT r.id, r.status, r.rating, r.body, r.created_at, p.title AS product
         FROM lounge_reviews r LEFT JOIN lounge_products p ON p.id=r.product_id
        WHERE r.user_id=$1 ORDER BY r.created_at DESC LIMIT 10`, [uid]),
    db.query(`SELECT count(*)::int AS n FROM lounge_posts WHERE user_id=$1 AND is_hidden=false`, [uid]),
    db.query(`SELECT status, referred_by, created_at FROM users WHERE id=$1`, [uid]),
  ]);
  res.render('lounge/my', {
    title: '마이페이지', active: 'my',
    ledger: ledger.rows, box: box.rows, myReviews: myReviews.rows, postCount: posts.rows[0].n,
    acct: u.rows[0],
  });
});

/* ---------------- 1:1 상담 ---------------- */
router.get('/consult', (req, res) => {
  res.render('lounge/consult', { title: '1:1 상담', active: 'consult', sent: req.query.sent === '1', error: null, form: {} });
});

router.post('/consult', async (req, res) => {
  if (String(req.body.website || '').trim()) return res.redirect('/consult?sent=1');
  const TYPES = ['시작하고 싶어요', '매출을 올리고 싶어요', '강의·챌린지 문의', '결제·환불', '기타'];
  const form = {
    type: TYPES.includes(req.body.type) ? req.body.type : '기타',
    name: String(req.body.name || (req.user && (req.user.nickname || req.user.name)) || '').trim().slice(0, 100),
    phone: String(req.body.phone || '').trim().slice(0, 40),
    message: String(req.body.message || '').trim().slice(0, 3000),
  };
  const fail = (msg) => res.status(400).render('lounge/consult', { title: '1:1 상담', active: 'consult', sent: false, error: msg, form });
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
