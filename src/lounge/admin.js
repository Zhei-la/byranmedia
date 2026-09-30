/* 바이란 라운지: 운영자 화면 */
const express = require('express');
const db = require('../db');
const L = require('./core');
const P = require('./points');
const E = require('./enroll');
const V = require('./visits');
const M = require('./members');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use('/admin/lounge', requireAdmin);

// async 오류를 오류 화면으로 넘긴다
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
for (const m of ['get', 'post']) {
  const orig = router[m].bind(router);
  router[m] = (p, ...h) => orig(p, ...h.map(wrap));
}

const TABS = ['stats', 'home', 'prompts', 'library', 'store', 'students', 'board', 'reviews', 'challenge', 'members'];
const go = (res, tab, msg, extra = '') =>
  res.redirect(`/admin/lounge?tab=${tab}${msg ? '&msg=' + encodeURIComponent(msg) : ''}${extra}`);
// 회원 상세 화면에서 보낸 폼은 그 화면으로 돌아간다
const retOk = (v) => (/^\/admin\/lounge\/members\/\d+$/.test(String(v || '')) ? String(v) : null);
function goRet(req, res, tab, msg, extra = '') {
  const r = retOk(req.body && req.body.ret);
  if (r) return res.redirect(`${r}?msg=${encodeURIComponent(msg)}`);
  return go(res, tab, msg, extra);
}
const int = (v) => (v === '' || v == null ? null : parseInt(v, 10));
const txt = (v, n = 500) => String(v == null ? '' : v).trim().slice(0, n);

router.get('/admin/lounge', async (req, res) => {
  const tab = TABS.includes(req.query.tab) ? req.query.tab : 'stats';
  const q = (sql, p) => db.query(sql, p).then((r) => r.rows);
  const data = { tab, msg: req.query.msg || null, L, S: await L.settings() };

  const [counts] = await q(
    `SELECT (SELECT count(*) FROM users WHERE nickname IS NOT NULL)::int AS members,
            (SELECT count(*) FROM users WHERE lounge_at > now() - interval '7 days')::int AS new7,
            (SELECT count(*) FROM lounge_prompts WHERE is_active)::int AS prompts,
            (SELECT count(*) FROM lounge_posts WHERE is_hidden=false)::int AS posts,
            (SELECT count(*) FROM lounge_reviews WHERE status='pending')::int AS pending_reviews,
            (SELECT count(*) FROM lounge_reports WHERE resolved=false)::int AS reports,
            (SELECT count(*) FROM lounge_cohort_members WHERE status='pending')::int AS pending_members`
  );
  data.counts = counts;
  data.brief = await V.todayBrief().catch(() => ({ v: 0, j: 0 }));
  if (tab === 'stats') {
    data.range = ['7d', 'all'].includes(req.query.r) ? req.query.r : 'today';
    data.stats = await V.stats(data.range, 14);
    data.SOURCES = V.SOURCES;
  }

  if (tab === 'board') {
    data.reports = await q(
      `SELECT r.*, COALESCE(u.nickname,u.name) AS reporter,
              CASE r.target_type
                WHEN 'post' THEN (SELECT title FROM lounge_posts WHERE id=r.target_id)
                WHEN 'comment' THEN (SELECT left(body,80) FROM lounge_comments WHERE id=r.target_id)
                WHEN 'chat' THEN (SELECT left(body,80) FROM lounge_chat WHERE id=r.target_id)
                WHEN 'result' THEN (SELECT headline FROM lounge_results WHERE id=r.target_id)
              END AS preview,
              CASE r.target_type WHEN 'comment' THEN (SELECT post_id FROM lounge_comments WHERE id=r.target_id) END AS post_id
         FROM lounge_reports r LEFT JOIN users u ON u.id=r.user_id
        WHERE r.resolved=false ORDER BY r.created_at DESC LIMIT 100`
    );
    data.posts = await q(
      `SELECT p.id, p.category, p.title, p.is_pinned, p.is_hidden, p.created_at, COALESCE(u.nickname,u.name) AS nick
         FROM lounge_posts p LEFT JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC LIMIT 60`
    );
    data.chat = await q(
      `SELECT c.id, c.body, c.is_hidden, c.created_at, COALESCE(u.nickname,u.name) AS nick
         FROM lounge_chat c JOIN users u ON u.id=c.user_id ORDER BY c.id DESC LIMIT 40`
    );
    data.results = await q(
      `SELECT r.id, r.headline, r.kind, r.image_id, r.is_hidden, COALESCE(u.nickname,u.name) AS nick
         FROM lounge_results r JOIN users u ON u.id=r.user_id ORDER BY r.id DESC LIMIT 30`
    );
  }
  if (tab === 'reviews') {
    data.reviews = await q(
      `SELECT r.*, COALESCE(r.author_name, u.nickname, u.name) AS nick, p.title AS product
         FROM lounge_reviews r LEFT JOIN users u ON u.id=r.user_id LEFT JOIN lounge_products p ON p.id=r.product_id
        ORDER BY (r.status='pending') DESC, r.created_at DESC LIMIT 150`
    );
    data.products = await q(`SELECT id, title FROM lounge_products ORDER BY sort_order, id`);
  }
  if (tab === 'library') {
    data.resources = await q(
      `SELECT r.*, (SELECT count(*) FROM lounge_unlocks x WHERE x.resource_id=r.id)::int AS opened
         FROM lounge_resources r ORDER BY r.is_active DESC, r.sort_order, r.id`
    );
    data.edit = req.query.edit ? data.resources.find((x) => x.id === Number(req.query.edit)) || null : null;
    data.products = await q(`SELECT id, title FROM lounge_products ORDER BY sort_order, id`);
  }
  if (tab === 'store') {
    data.products = await E.priced(await q(`SELECT * FROM lounge_products ORDER BY is_active DESC, sort_order, id`));
    data.resources = await q(`SELECT id, title FROM lounge_resources ORDER BY title`);
    data.edit = req.query.edit ? data.products.find((x) => x.id === Number(req.query.edit)) || null : null;
  }
  if (tab === 'challenge') {
    data.cohorts = await q(
      `SELECT c.*, (SELECT count(*) FROM lounge_cohort_members m WHERE m.cohort_id=c.id AND m.status='approved')::int AS approved,
              (SELECT count(*) FROM lounge_cohort_members m WHERE m.cohort_id=c.id AND m.status='pending')::int AS pending,
              (SELECT count(*) FROM lounge_missions m WHERE m.cohort_id=c.id)::int AS missions
         FROM lounge_cohorts c ORDER BY c.start_date DESC, c.id DESC`
    );
    const cid = Number(req.query.c) || (data.cohorts[0] && data.cohorts[0].id) || 0;
    data.cur = data.cohorts.find((c) => c.id === cid) || null;
    data.editCohort = req.query.editc ? data.cohorts.find((c) => c.id === Number(req.query.editc)) || null : null;
    if (data.cur) {
      data.members = await q(
        `SELECT m.*, COALESCE(u.nickname,u.name) AS nick, u.name AS realname,
                (SELECT count(*) FROM lounge_submissions s WHERE s.cohort_id=m.cohort_id AND s.user_id=m.user_id)::int AS done
           FROM lounge_cohort_members m JOIN users u ON u.id=m.user_id
          WHERE m.cohort_id=$1 ORDER BY (m.status='pending') DESC, m.created_at`,
        [data.cur.id]
      );
      data.missions = await q(`SELECT * FROM lounge_missions WHERE cohort_id=$1 ORDER BY day`, [data.cur.id]);
      data.subs = await q(
        `SELECT s.*, m.day, COALESCE(u.nickname,u.name) AS nick FROM lounge_submissions s
           JOIN lounge_missions m ON m.id=s.mission_id JOIN users u ON u.id=s.user_id
          WHERE s.cohort_id=$1 ORDER BY s.created_at DESC LIMIT 60`,
        [data.cur.id]
      );
    }
  }
  if (tab === 'prompts') {
    const pf = ['shared', 'fix'].includes(req.query.pf) ? req.query.pf : 'official';
    data.pf = pf;
    data.prompts = await q(
      `SELECT p.id, p.title, p.category, p.image_ids, p.is_active, p.views, p.copies, p.created_at, p.user_id, p.status, p.fix_note,
              COALESCE(u.nickname, u.name) AS author
         FROM lounge_prompts p LEFT JOIN users u ON u.id=p.user_id
        WHERE ${pf === 'official' ? 'p.user_id IS NULL' : pf === 'shared' ? 'p.user_id IS NOT NULL' : "p.status='fix'"}
        ORDER BY p.created_at DESC LIMIT 200`
    );
    data.pcount = (await q(
      `SELECT count(*) FILTER (WHERE user_id IS NULL)::int AS official, count(*) FILTER (WHERE user_id IS NOT NULL)::int AS shared,
              count(*) FILTER (WHERE status='fix')::int AS fix FROM lounge_prompts`
    ))[0];
    data.edit = req.query.edit ? (await q(`SELECT * FROM lounge_prompts WHERE id=$1`, [req.query.edit]))[0] || null : null;
  }
  if (tab === 'students') {
    const s = txt(req.query.s, 60);
    const uid = int(req.query.uid);
    data.s = s;
    data.uid = uid;
    data.products = await q(`SELECT id, title, months, price_text FROM lounge_products ORDER BY is_active DESC, sort_order, id`);
    // 지급할 회원 찾기: 검색어 또는 회원 번호로
    data.found = s || uid ? await q(
      `SELECT u.id, u.name, u.nickname, u.email, u.phone, u.provider, u.created_at,
              (SELECT string_agg(e.product_title, ', ') FROM lounge_enrollments e WHERE e.user_id=u.id AND ${E.ACTIVE}) AS now_courses,
              EXISTS (SELECT 1 FROM lounge_enrollments e JOIN lounge_products p ON p.id=e.product_id
                       WHERE e.user_id=u.id AND p.ptype='ebook' AND e.status<>'refunded') AS has_ebook
         FROM users u
        WHERE ${uid ? 'u.id=$1' : `(u.nickname ILIKE $1 OR u.name ILIKE $1 OR u.email ILIKE $1 OR u.phone ILIKE $1)`}
        ORDER BY u.created_at DESC LIMIT 20`,
      [uid || `%${s}%`]
    ) : [];
    // 수강 신청서 (라운지 회원이 쓴 건 회원 번호가 붙어 있다)
    data.apps = (await q(
      `SELECT i.id, i.name, i.phone, i.plan, i.message, i.status, i.created_at, i.business,
              substring(i.business from '라운지 회원 #([0-9]+)')::int AS uid
         FROM inquiries i WHERE i.plan LIKE '수강 신청%' ORDER BY i.created_at DESC LIMIT 30`
    )).map((a) => {
      const title = String(a.plan || '').replace(/^수강 신청 · /, '');
      const prod = data.products.find((p) => p.title === title);
      return { ...a, product_id: prod ? prod.id : null };
    });
    const appUids = [...new Set(data.apps.map((a) => a.uid).filter(Boolean))];
    const enrolledUids = appUids.length ? await q(`SELECT DISTINCT user_id, product_id FROM lounge_enrollments e WHERE user_id = ANY($1::int[]) AND ${E.ACTIVE}`, [appUids]) : [];
    data.enrolledSet = new Set(enrolledUids.map((r) => r.user_id + ':' + r.product_id)); // 신청한 그 상품을 이미 가졌는지
    const ebookUids = appUids.length ? await q(
      `SELECT DISTINCT e.user_id FROM lounge_enrollments e JOIN lounge_products p ON p.id=e.product_id
        WHERE e.user_id = ANY($1::int[]) AND p.ptype='ebook' AND e.status<>'refunded'`, [appUids]) : [];
    data.ebookSet = new Set(ebookUids.map((r) => r.user_id));
    const ebp = await q(`SELECT id, price_text FROM lounge_products WHERE ptype='ebook' ORDER BY is_active DESC, id LIMIT 1`);
    data.ebookCredit = ebp[0] ? await E.currentPrice(ebp[0].id) : 0;
    const st = ['active', 'ended', 'all'].includes(req.query.st) ? req.query.st : 'active';
    data.st = st;
    data.enrolls = await q(
      `SELECT e.*, e.starts_on::text AS starts_s, e.ends_on::text AS ends_s, (${E.ACTIVE}) AS is_active, (e.ends_on - ${E.TODAY})::int AS days_left,
              COALESCE(u.nickname, u.name) AS nick, u.name, u.phone
         FROM lounge_enrollments e JOIN users u ON u.id=e.user_id
        ${st === 'active' ? `WHERE ${E.ACTIVE}` : st === 'ended' ? `WHERE NOT (${E.ACTIVE})` : ''}
        ORDER BY e.created_at DESC LIMIT 300`
    );
    data.E = E;
  }
  if (tab === 'members') {
    data.s = txt(req.query.s, 40);
    data.kind = M.KINDS[req.query.k] ? req.query.k : '';
    data.KINDS = M.KINDS;
    data.kcount = await M.counts();
    data.members = await M.list({ kind: data.kind, s: data.s });
  }
  const nk = req.user.nickname || req.user.name;
  res.render('lounge/admin', { title: '라운지 관리', active: '', flash: null, me: { nick: nk }, nick: nk, P, pts: null, ...data });
});

/* ---------------- 수강권 ---------------- */
const ymdOk = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
router.post('/admin/lounge/enrollments/grant', async (req, res) => {
  const userId = int(req.body.user_id);
  const productId = int(req.body.product_id);
  if (!userId || !productId) return go(res, 'students', '회원과 과정을 골라 주세요.');
  const u = await db.query(`SELECT id, COALESCE(nickname, name) AS nick FROM users WHERE id=$1`, [userId]);
  if (!u.rows[0]) return go(res, 'students', '회원을 찾지 못했어요.');
  const period = req.body.period;
  const endsOn = period === 'lifetime' ? '' : period === 'custom' ? ymdOk(req.body.ends_on) || '' : undefined;
  if (period === 'custom' && !ymdOk(req.body.ends_on)) return goRet(req, res, 'students', '끝나는 날을 넣어 주세요.', `&uid=${userId}`);
  const amount = parseInt(String(req.body.amount || '').replace(/[^0-9]/g, ''), 10) || null;
  const { enrollment } = await E.grant({
    userId, productId, source: ['cash', 'card', 'admin'].includes(req.body.source) ? req.body.source : 'cash',
    amount, startsOn: ymdOk(req.body.starts_on), endsOn, memo: txt(req.body.memo, 300) || null, grantedBy: req.user.id,
  });
  if (req.body.inquiry_id) await db.query(`UPDATE inquiries SET status='done' WHERE id=$1`, [int(req.body.inquiry_id)]).catch(() => {});
  goRet(req, res, 'students', `${u.rows[0].nick}님에게 「${enrollment.product_title}」 수강권을 지급했어요.`);
});
router.post('/admin/lounge/enrollments/:id/save', async (req, res) => {
  await E.update(int(req.params.id), {
    status: req.body.status, startsOn: ymdOk(req.body.starts_on), endsOn: ymdOk(req.body.ends_on), memo: txt(req.body.memo, 300),
  });
  goRet(req, res, 'students', '수강권을 고쳤어요.', req.body.st ? `&st=${encodeURIComponent(req.body.st)}` : '');
});
router.post('/admin/lounge/enrollments/:id/delete', async (req, res) => {
  await E.remove(int(req.params.id));
  goRet(req, res, 'students', '수강권을 지웠어요.', req.body.st ? `&st=${encodeURIComponent(req.body.st)}` : '');
});

/* ---------------- 포인트 직접 조정 ---------------- */
router.post('/admin/lounge/members/:id/points', async (req, res) => {
  const amount = parseInt(req.body.amount, 10);
  const uid = parseInt(req.params.id, 10);
  if (!uid || !amount || Math.abs(amount) > 1000000) return goRet(req, res, 'members', '더하거나 뺄 포인트를 숫자로 넣어 주세요. (빼려면 -100 처럼)');
  await P.adjust(uid, amount, txt(req.body.note, 100) || '운영자 조정');
  goRet(req, res, 'members', `${amount > 0 ? '+' : ''}${amount}P 반영했어요.`, req.body.s ? '&s=' + encodeURIComponent(txt(req.body.s, 40)) : '');
});

/* ---------------- 회원 관리 ---------------- */
router.get('/admin/lounge/members.csv', async (req, res) => {
  const body = await M.csv({ kind: M.KINDS[req.query.k] ? req.query.k : '', s: txt(req.query.s, 40) });
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="members-${day}.csv"`);
  res.send(body);
});
router.get('/admin/lounge/members/:id(\\d+)', async (req, res) => {
  const d = await M.detail(int(req.params.id));
  if (!d) return go(res, 'members', '없는 회원이에요.');
  const products = (await db.query(`SELECT id, title, months FROM lounge_products ORDER BY sort_order, id`)).rows;
  res.render('lounge/admin-member', {
    title: `${d.m.nickname || d.m.name} · 회원 관리`, active: '', L, S: await L.settings(), P, E, pts: null,
    flash: null, me: { nick: req.user.nickname || req.user.name }, nick: req.user.nickname || req.user.name,
    msg: req.query.msg || null, ...d, products, KINDS: M.KINDS, PRESET_TAGS: M.PRESET_TAGS,
    today: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }),
  });
});
router.post('/admin/lounge/members/:id(\\d+)/student', async (req, res) => {
  const id = int(req.params.id);
  const on = req.body.on === '1';
  await M.setStudent(id, on);
  const r = String(req.body.ret || '');
  const to = retOk(r) || (/^\/admin\/lounge\?tab=members(&k=[a-z]+)?$/.test(r) ? r : `/admin/lounge/members/${id}`);
  res.redirect(`${to}${to.includes('?') ? '&' : '?'}msg=${encodeURIComponent(on ? '수강생으로 표시했어요.' : '수강생 표시를 풀었어요. (수강권이 있으면 계속 수강생으로 보여요)')}`);
});
router.post('/admin/lounge/members/:id(\\d+)/admin', async (req, res) => {
  const id = int(req.params.id);
  const on = req.body.on === '1';
  if (!on && id === req.user.id) return res.redirect(`/admin/lounge/members/${id}?msg=${encodeURIComponent('내 운영자 권한은 여기서 뺄 수 없어요.')}`);
  await M.setAdmin(id, on);
  res.redirect(`/admin/lounge/members/${id}?msg=${encodeURIComponent(on ? '운영자 권한을 줬어요. 관리 화면을 쓸 수 있어요.' : '운영자 권한을 뺐어요.')}`);
});
router.post('/admin/lounge/members/:id(\\d+)/ban', async (req, res) => {
  const id = int(req.params.id);
  if (id === req.user.id) return res.redirect(`/admin/lounge/members/${id}?msg=${encodeURIComponent('나 자신은 제재할 수 없어요.')}`);
  const kind = req.body.kind === 'write' ? 'write' : 'chat';
  const days = Math.max(0, Math.min(36500, parseInt(req.body.days, 10) || 0));
  await M.ban(id, kind, days, req.body.note);
  const what = kind === 'write' ? '글·댓글' : '채팅';
  const msg = days ? `${what} 금지를 걸었어요 (${days >= 36500 ? '영구' : days + '일'}).` : `${what} 금지를 풀었어요.`;
  res.redirect(`/admin/lounge/members/${id}?msg=${encodeURIComponent(msg)}#ban`);
});
router.post('/admin/lounge/members/:id(\\d+)/kick', async (req, res) => {
  const id = int(req.params.id);
  if (id === req.user.id) return res.redirect(`/admin/lounge/members/${id}?msg=${encodeURIComponent('나 자신은 강퇴할 수 없어요.')}`);
  const on = req.body.on === '1';
  await M.kick(id, on, req.body.note);
  res.redirect(`/admin/lounge/members/${id}?msg=${encodeURIComponent(on ? '강퇴(이용 정지)했어요. 이제 로그인해도 라운지를 쓸 수 없어요.' : '강퇴를 풀었어요.')}#ban`);
});
router.post('/admin/lounge/members/:id(\\d+)/save', async (req, res) => {
  const id = int(req.params.id);
  await M.save(id, { memo: req.body.memo, phone: req.body.phone, tags: [].concat(req.body.tag || [], req.body.tag_new || []) });
  res.redirect(`/admin/lounge/members/${id}?msg=${encodeURIComponent('메모·태그를 저장했어요.')}`);
});

/* ---------------- 설정 ---------------- */
router.post('/admin/lounge/settings', async (req, res) => {
  await L.saveSettings(req.body);
  go(res, 'home', '설정을 저장했어요.');
});

/* ---------------- 게시판 · 신고 ---------------- */
router.post('/admin/lounge/posts/:id/toggle', async (req, res) => {
  const f = req.body.field === 'pin' ? 'is_pinned' : 'is_hidden';
  const { rows } = await db.query(`UPDATE lounge_posts SET ${f} = NOT ${f} WHERE id=$1 RETURNING is_hidden`, [req.params.id]);
  if (rows[0] && f === 'is_hidden') {
    if (rows[0].is_hidden) await P.revoke('post', Number(req.params.id));
    else await P.restore('post', Number(req.params.id));
  }
  go(res, 'board', f === 'is_hidden' && rows[0] ? (rows[0].is_hidden ? '숨겼어요. 이 글로 받은 포인트도 회수했어요.' : '다시 보이게 했어요. 포인트도 돌려줬어요.') : '바꿨어요.');
});
router.post('/admin/lounge/chat/:id/toggle', async (req, res) => {
  await db.query(`UPDATE lounge_chat SET is_hidden = NOT is_hidden WHERE id=$1`, [req.params.id]);
  go(res, 'board', '바꿨어요.');
});
router.post('/admin/lounge/results/:id/toggle', async (req, res) => {
  await db.query(`UPDATE lounge_results SET is_hidden = NOT is_hidden WHERE id=$1`, [req.params.id]);
  go(res, 'board', '바꿨어요.');
});
router.post('/admin/lounge/reports/:id', async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM lounge_reports WHERE id=$1`, [req.params.id]);
  const r = rows[0];
  if (r && req.body.action === 'hide') {
    const table = { post: 'lounge_posts', comment: 'lounge_comments', chat: 'lounge_chat', result: 'lounge_results' }[r.target_type];
    if (table) await db.query(`UPDATE ${table} SET is_hidden=true WHERE id=$1`, [r.target_id]);
    if (r.target_type === 'post') await P.revoke('post', r.target_id);
  }
  if (r) await db.query(`UPDATE lounge_reports SET resolved=true WHERE target_type=$1 AND target_id=$2`, [r.target_type, r.target_id]);
  go(res, 'board', req.body.action === 'hide' ? '숨기고 처리했어요.' : '그대로 두고 처리했어요.');
});

/* ---------------- 후기 ---------------- */
router.post('/admin/lounge/reviews/:id/status', async (req, res) => {
  const status = ['approved', 'rejected', 'pending'].includes(req.body.status) ? req.body.status : 'pending';
  const { rows } = await db.query(
    `UPDATE lounge_reviews SET status=$1::varchar, approved_at = CASE WHEN $1::varchar='approved' THEN COALESCE(approved_at, now()) ELSE approved_at END
      WHERE id=$2 RETURNING user_id`,
    [status, req.params.id]
  );
  if (rows[0]) {
    if (status === 'rejected') await P.revoke('review', Number(req.params.id));
    else await P.restore('review', Number(req.params.id));
  }
  go(res, 'reviews', rows[0] ? (status === 'approved' ? '승인했어요. 후기 페이지에 올라갔어요.' : '바꿨어요.') : '후기를 찾지 못했어요.');
});
router.post('/admin/lounge/reviews/new', async (req, res) => {
  const body = txt(req.body.body, 3000);
  const author = txt(req.body.author_name, 40);
  if (!body || !author) return go(res, 'reviews', '이름과 내용을 모두 넣어 주세요.');
  await db.query(
    `INSERT INTO lounge_reviews (author_name, product_id, rating, industry, body, status, approved_at)
     VALUES ($1,$2,$3,$4,$5,'approved', now())`,
    [author, int(req.body.product_id), Math.min(5, Math.max(1, int(req.body.rating) || 5)), txt(req.body.industry, 40) || null, body]
  );
  go(res, 'reviews', '후기를 올렸어요.');
});
router.post('/admin/lounge/reviews/:id/delete', async (req, res) => {
  await db.query(`DELETE FROM lounge_reviews WHERE id=$1`, [req.params.id]);
  await P.revoke('review', Number(req.params.id));
  go(res, 'reviews', '지웠어요.');
});

/* ---------------- 자료실 ---------------- */
router.post('/admin/lounge/resources/save', async (req, res) => {
  const id = int(req.body.id);
  const f = {
    title: txt(req.body.title, 120),
    description: txt(req.body.description, 300) || null,
    kind: ['pdf', 'video', 'link', 'text'].includes(req.body.kind) ? req.body.kind : 'link',
    url: L.safeLink(req.body.url) || null,
    body: txt(req.body.body, 20000) || null,
    section: txt(req.body.section_custom, 30) || txt(req.body.section, 30) || '무료 자료',
    access: ['code', 'points', 'course'].includes(req.body.access) ? req.body.access : 'member',
    product_ids: [].concat(req.body.product_ids || []).map((v) => parseInt(v, 10)).filter((n) => n > 0),
    cost: Math.max(0, int(req.body.cost) || 0),
    lock_note: txt(req.body.lock_note, 120) || null,
    sort_order: int(req.body.sort_order) || 100,
    is_active: req.body.is_active !== '0',
  };
  if (!f.title) return go(res, 'library', '제목을 넣어 주세요.');
  if (!f.url && !f.body) return go(res, 'library', '링크나 본문 중 하나는 넣어 주세요.');
  if (f.access === 'points' && !f.cost) return go(res, 'library', '포인트로 여는 자료는 필요한 포인트를 넣어 주세요.');
  const vals = [f.title, f.description, f.kind, f.url, f.body, f.section, f.access, f.lock_note, f.sort_order, f.is_active, f.cost, f.product_ids];
  if (id) {
    await db.query(
      `UPDATE lounge_resources SET title=$1, description=$2, kind=$3, url=$4, body=$5, section=$6, access=$7, lock_note=$8, sort_order=$9, is_active=$10, cost=$11, product_ids=$12 WHERE id=$13`,
      [...vals, id]
    );
  } else {
    await db.query(
      `INSERT INTO lounge_resources (title, description, kind, url, body, section, access, lock_note, sort_order, is_active, cost, product_ids) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      vals
    );
  }
  go(res, 'library', '자료를 저장했어요.');
});
router.post('/admin/lounge/resources/:id/delete', async (req, res) => {
  await db.query(`DELETE FROM lounge_resources WHERE id=$1`, [req.params.id]);
  go(res, 'library', '지웠어요.');
});

/* ---------------- 스토어 ---------------- */
router.post('/admin/lounge/products/save', async (req, res) => {
  const id = int(req.body.id);
  const f = [
    txt(req.body.title, 120), txt(req.body.subtitle, 200) || null, txt(req.body.kind, 40) || null,
    txt(req.body.badge, 12) || null, txt(req.body.price_text, 40) || null,
    int(req.body.point_price) || null, int(req.body.resource_id) || null,
    L.safeUrl(req.body.buy_url) || null, txt(req.body.cta_label, 20) || null,
    req.body.is_challenge === '1', int(req.body.sort_order) || 100, req.body.is_active !== '0',
    txt(req.body.list_price, 40) || null, txt(req.body.price_note, 120) || null, txt(req.body.perks, 3000) || null,
    int(req.body.months) || null, txt(req.body.student_links, 2000) || null, txt(req.body.student_note, 500) || null,
    req.body.ptype === 'ebook' ? 'ebook' : 'course',
    int(req.body.dyn_start) || null, int(req.body.dyn_step) || null, int(req.body.dyn_every) || null, int(req.body.dyn_max) || null,
  ];
  if (!f[0]) return go(res, 'store', '상품 이름을 넣어 주세요.');
  if (id) {
    await db.query(
      `UPDATE lounge_products SET title=$1, subtitle=$2, kind=$3, badge=$4, price_text=$5, point_price=$6, resource_id=$7,
              buy_url=$8, cta_label=$9, is_challenge=$10, sort_order=$11, is_active=$12,
              list_price=$13, price_note=$14, perks=$15, months=$16, student_links=$17, student_note=$18, ptype=$19, dyn_start=$20, dyn_step=$21, dyn_every=$22, dyn_max=$23 WHERE id=$24`,
      [...f, id]
    );
  } else {
    await db.query(
      `INSERT INTO lounge_products (title, subtitle, kind, badge, price_text, point_price, resource_id, buy_url, cta_label, is_challenge, sort_order, is_active, list_price, price_note, perks, months, student_links, student_note, ptype, dyn_start, dyn_step, dyn_every, dyn_max)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      f
    );
  }
  go(res, 'store', '상품을 저장했어요.');
});
router.post('/admin/lounge/products/:id/delete', async (req, res) => {
  await db.query(`DELETE FROM lounge_products WHERE id=$1`, [req.params.id]);
  go(res, 'store', '지웠어요.');
});

/* ---------------- 챌린지 ---------------- */
router.post('/admin/lounge/cohorts/save', async (req, res) => {
  const id = int(req.body.id);
  const f = [
    txt(req.body.name, 20), txt(req.body.title, 120), txt(req.body.intro, 3000) || null,
    txt(req.body.start_date, 10), Math.min(60, Math.max(1, int(req.body.days) || 14)),
    L.safeUrl(req.body.kakao_url) || null,
    ['recruiting', 'running', 'ended'].includes(req.body.status) ? req.body.status : 'recruiting',
  ];
  if (!f[0] || !f[1] || !/^\d{4}-\d{2}-\d{2}$/.test(f[3])) return go(res, 'challenge', '기수 이름, 제목, 시작일을 넣어 주세요.');
  let cid = id;
  if (id) {
    await db.query(
      `UPDATE lounge_cohorts SET name=$1, title=$2, intro=$3, start_date=$4, days=$5, kakao_url=$6, status=$7 WHERE id=$8`,
      [...f, id]
    );
  } else {
    const { rows } = await db.query(
      `INSERT INTO lounge_cohorts (name, title, intro, start_date, days, kakao_url, status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      f
    );
    cid = rows[0].id;
  }
  go(res, 'challenge', '기수를 저장했어요.', `&c=${cid}`);
});
router.post('/admin/lounge/cohorts/:id/delete', async (req, res) => {
  await db.query(`DELETE FROM lounge_cohorts WHERE id=$1`, [req.params.id]);
  go(res, 'challenge', '기수를 지웠어요.');
});
router.post('/admin/lounge/cohorts/:id/members/:uid', async (req, res) => {
  const act = req.body.action;
  if (act === 'remove') {
    await db.query(`DELETE FROM lounge_cohort_members WHERE cohort_id=$1 AND user_id=$2`, [req.params.id, req.params.uid]);
  } else {
    const st = act === 'approve' ? 'approved' : 'rejected';
    await db.query(`UPDATE lounge_cohort_members SET status=$1 WHERE cohort_id=$2 AND user_id=$3`, [st, req.params.id, req.params.uid]);
  }
  go(res, 'challenge', '처리했어요.', `&c=${req.params.id}`);
});
router.post('/admin/lounge/cohorts/:id/add', async (req, res) => {
  // 닉네임으로 직접 참가자 추가 (카톡으로 결제 확인한 경우 등)
  const { rows } = await db.query(`SELECT id FROM users WHERE lower(nickname)=lower($1)`, [txt(req.body.nickname, 20)]);
  if (!rows[0]) return go(res, 'challenge', '그 닉네임의 회원을 찾지 못했어요.', `&c=${req.params.id}`);
  await db.query(
    `INSERT INTO lounge_cohort_members (cohort_id, user_id, status, order_no) VALUES ($1,$2,'approved','운영자 추가')
     ON CONFLICT (cohort_id, user_id) DO UPDATE SET status='approved'`,
    [req.params.id, rows[0].id]
  );
  go(res, 'challenge', '참가자로 넣었어요.', `&c=${req.params.id}`);
});
router.post('/admin/lounge/missions/save', async (req, res) => {
  const cid = int(req.body.cohort_id);
  const day = int(req.body.day);
  const title = txt(req.body.title, 120);
  if (!cid || !day || !title) return go(res, 'challenge', '날짜와 미션 제목을 넣어 주세요.', `&c=${cid}`);
  await db.query(
    `INSERT INTO lounge_missions (cohort_id, day, title, body) VALUES ($1,$2,$3,$4)
     ON CONFLICT (cohort_id, day) DO UPDATE SET title=EXCLUDED.title, body=EXCLUDED.body`,
    [cid, day, title, txt(req.body.body, 5000) || null]
  );
  go(res, 'challenge', `Day ${day} 미션을 저장했어요.`, `&c=${cid}`);
});
router.post('/admin/lounge/missions/:id/delete', async (req, res) => {
  const { rows } = await db.query(`DELETE FROM lounge_missions WHERE id=$1 RETURNING cohort_id`, [req.params.id]);
  go(res, 'challenge', '미션을 지웠어요.', rows[0] ? `&c=${rows[0].cohort_id}` : '');
});
router.post('/admin/lounge/cohorts/:id/template', async (req, res) => {
  const cid = int(req.params.id);
  const { rows } = await db.query(`SELECT days FROM lounge_cohorts WHERE id=$1`, [cid]);
  if (!rows[0]) return go(res, 'challenge', '기수를 찾지 못했어요.');
  const list = MISSION_TEMPLATE.slice(0, rows[0].days);
  for (let i = 0; i < list.length; i++) {
    await db.query(
      `INSERT INTO lounge_missions (cohort_id, day, title, body) VALUES ($1,$2,$3,$4) ON CONFLICT (cohort_id, day) DO NOTHING`,
      [cid, i + 1, list[i][0], list[i][1]]
    );
  }
  go(res, 'challenge', `기본 미션 ${list.length}개를 넣었어요. (이미 있는 날은 건드리지 않았어요)`, `&c=${cid}`);
});

/* ---------------- 프롬프트 갤러리 ---------------- */
router.post('/admin/lounge/prompts/save', async (req, res) => {
  const id = int(req.body.id);
  const title = txt(req.body.title, 120);
  const prompt = txt(req.body.prompt, 12000);
  if (!title || !prompt) {
    if (req.body.back === '/prompts') { req.session.flash = '제목과 프롬프트를 넣어 주세요.'; return res.redirect('/prompts#compose'); }
    return go(res, 'prompts', '제목과 프롬프트를 넣어 주세요.', id ? `&edit=${id}` : '');
  }
  // 기존 사진 중 남길 것 + 새로 올린 사진
  let keep = [].concat(req.body.keep || []).map((x) => parseInt(x, 10)).filter(Boolean);
  const uploads = [].concat(req.body.images || []).filter(Boolean).slice(0, 8);
  for (const d of uploads) {
    const imgId = await L.saveImage(req.user.id, d);
    if (imgId) keep.push(imgId);
  }
  keep = keep.slice(0, 8);
  const f = [
    title, L.PROMPT_CATS.includes(req.body.category) ? req.body.category : '기타', prompt,
    txt(req.body.negative, 4000) || null, txt(req.body.model, 40) || null, txt(req.body.note, 300) || null,
    keep, req.body.is_active !== '0',
  ];
  // 갤러리 화면에서 바로 올린 경우 그 화면으로 돌아간다
  const backTo = String(req.body.back || '');
  const toGallery = backTo === '/prompts';
  if (id) {
    await db.query(
      `UPDATE lounge_prompts SET title=$1, category=$2, prompt=$3, negative=$4, model=$5, note=$6, image_ids=$7, is_active=$8 WHERE id=$9`,
      [...f, id]
    );
    if (toGallery) { req.session.flash = '프롬프트를 고쳤어요.'; return res.redirect(`/prompts/${id}`); }
    return go(res, 'prompts', '프롬프트를 고쳤어요.');
  }
  const { rows: ins } = await db.query(
    `INSERT INTO lounge_prompts (title, category, prompt, negative, model, note, image_ids, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    f
  );
  if (toGallery) { req.session.flash = '프롬프트를 올렸어요! 🎉'; return res.redirect('/prompts'); }
  go(res, 'prompts', '프롬프트를 올렸어요.');
});
router.post('/admin/lounge/prompts/:id/toggle', async (req, res) => {
  await db.query(`UPDATE lounge_prompts SET is_active = NOT is_active WHERE id=$1`, [req.params.id]);
  go(res, 'prompts', '바꿨어요.');
});
router.post('/admin/lounge/prompts/:id/delete', async (req, res) => {
  await db.query(`DELETE FROM lounge_prompts WHERE id=$1`, [req.params.id]);
  go(res, 'prompts', '지웠어요.');
});

/* ---------------- 기본 미션 (AI 블로그 14일) ---------------- */
const MISSION_TEMPLATE = [
  ['내 블로그 방향 한 줄로 정하기', '누구에게, 어떤 글을, 왜 쓰는지 한 줄로 적어 주세요.\n예) "울산 사는 30대 직장인에게, 퇴근 후 할 수 있는 부업 이야기를"'],
  ['프로필·블로그 이름 다듬기', '블로그 이름, 소개글, 프로필 사진을 방향에 맞게 바꾸고 캡처나 링크를 올려 주세요.'],
  ['글감 10개 뽑기', 'AI에게 내 방향을 알려주고 글감 20개를 받은 뒤, 내가 진짜 쓸 수 있는 10개만 골라 적어 주세요.'],
  ['첫 글 쓰기', '글감 하나로 첫 글을 올리고 링크를 제출해 주세요. 완벽하지 않아도 됩니다.'],
  ['제목 3가지로 바꿔보기', '어제 글의 제목을 3가지 버전으로 다시 써 보고, 가장 마음에 드는 걸 골라 이유를 적어 주세요.'],
  ['AI 초안 → 내 말투로 고치기', 'AI 초안을 받은 뒤 내 경험 한 줄, 내 말투로 고친 문장 세 군데를 표시해서 올려 주세요.'],
  ['두 번째 글 올리기', '첫 주 마무리! 두 번째 글 링크를 올려 주세요.'],
  ['한 주 돌아보기', '이번 주에 막힌 점 하나, 잘된 점 하나를 적어 주세요. 다른 분들 글에 댓글도 3개 남겨 보세요.'],
  ['사진·이미지 넣는 법 익히기', '직접 찍은 사진이나 만든 이미지를 넣어 글 하나를 올려 주세요.'],
  ['검색되는 키워드 찾기', '내 주제로 사람들이 실제 검색하는 말을 5개 찾아 적어 주세요.'],
  ['키워드 넣어 글쓰기', '어제 찾은 키워드 하나로 글을 올려 주세요.'],
  ['금지 표현 점검하기', '올린 글에서 과장·단정 표현(최고, 무조건, 100% 등)을 찾아 고쳐 보세요. 고친 전후를 적어 주세요.'],
  ['세 번째 글 올리기', '지금까지 배운 걸 다 넣어 세 번째 글을 올려 주세요.'],
  ['2주 회고 + 다음 목표', '2주 동안 바뀐 점, 앞으로 한 달 목표를 적어 주세요. 완주 축하해요!'],
];

module.exports = router;
