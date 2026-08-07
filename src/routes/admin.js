const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { ensureCode } = require('../referral');

const router = express.Router();

// /admin 으로 시작하는 요청에만 권한 검사를 건다.
// router.use(requireAdmin) 처럼 전역으로 걸면 이 라우터를 스쳐 지나가는
// 다른 모든 경로(404 포함)까지 로그인 화면으로 밀려난다.
router.use('/admin', requireAdmin);

/* ---------------- 회원 관리 ---------------- */
router.get('/admin', async (req, res) => {
  const tab = ['tools', 'notices', 'inquiries'].includes(req.query.tab) ? req.query.tab : 'users';
  const filter = req.query.filter || 'all';

  try {
    let where = '';
    const params = [];
    if (filter === 'pending') where = `WHERE u.status = 'pending'`;
    else if (filter === 'active') where = `WHERE u.status = 'active'`;
    else if (filter === 'suspended') where = `WHERE u.status = 'suspended'`;

    let users = [];
    try {
      const r = await db.query(
        `SELECT u.id, u.email, u.name, u.phone, u.role, u.status, u.memo, u.provider,
                u.last_login_at, u.created_at, u.referral_code,
                rf.name AS referrer_name, rf.referral_code AS referrer_code,
                (SELECT count(*)::int FROM users c WHERE c.referred_by = u.id) AS invited
           FROM users u LEFT JOIN users rf ON rf.id = u.referred_by ${where}
          ORDER BY (u.status='pending') DESC, u.created_at DESC
          LIMIT 300`,
        params
      );
      users = r.rows;
    } catch (e) {
      // 추천 컬럼이 아직 없는 경우에도 목록은 보여야 한다
      if (e.code !== '42703') throw e;
      const r = await db.query(
        `SELECT u.id, u.email, u.name, u.phone, u.role, u.status, u.memo, u.provider,
                u.last_login_at, u.created_at,
                NULL::text AS referral_code, NULL::text AS referrer_name,
                NULL::text AS referrer_code, 0 AS invited
           FROM users u ${where}
          ORDER BY (u.status='pending') DESC, u.created_at DESC
          LIMIT 300`,
        params
      );
      users = r.rows;
      console.warn('[관리] 추천 컬럼이 없습니다. npm run setup 을 한 번 실행해 주세요.');
    }

    const { rows: stat } = await db.query(
      `SELECT
         count(*) FILTER (WHERE status='pending')   ::int AS pending,
         count(*) FILTER (WHERE status='active')    ::int AS active,
         count(*) FILTER (WHERE status='suspended') ::int AS suspended,
         count(*)::int AS total
       FROM users`
    );

    const { rows: tools } = await db.query(
      `SELECT * FROM tools ORDER BY sort_order, title`
    );

    let notices = [];
    try {
      const r = await db.query(`SELECT * FROM notices ORDER BY is_pinned DESC, created_at DESC LIMIT 50`);
      notices = r.rows;
    } catch (e) { /* 테이블이 아직 없을 수 있다 */ }

    let inquiries = [];
    let newInq = 0;
    try {
      const r = await db.query(`SELECT * FROM inquiries ORDER BY created_at DESC LIMIT 200`);
      inquiries = r.rows;
      newInq = inquiries.filter((x) => x.status === 'new').length;
    } catch (e) { /* 테이블이 아직 없을 수 있다 */ }

    const { rows: recent } = await db.query(
      `SELECT l.tool_slug, l.created_at, u.name
         FROM access_logs l JOIN users u ON u.id = l.user_id
        ORDER BY l.created_at DESC LIMIT 20`
    );

    res.render('admin', {
      title: '관리',
      tab, filter, users, tools, recent, notices, inquiries, newInq,
      stat: stat[0],
      notice: req.query.done || null,
    });
  } catch (e) {
    console.error('[admin]', e.message);
    res.status(500).render('error', { title: '불러오기 실패', message: e.message });
  }
});

/* 회원 상태 변경 */
router.post('/admin/users/:id/status', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const status = String(req.body.status || '');
  if (!['pending', 'active', 'suspended'].includes(status)) return res.redirect('/admin');
  if (id === req.user.id && status !== 'active') {
    return res.redirect('/admin?done=' + encodeURIComponent('본인 계정은 정지할 수 없습니다'));
  }
  await db.query(`UPDATE users SET status = $1 WHERE id = $2`, [status, id]);
  const msg =
    status === 'active' ? '승인했습니다'
    : status === 'pending' ? '승인을 취소했습니다. 다시 승인하면 바로 복구됩니다'
    : '이용을 중지했습니다';
  res.redirect('/admin?done=' + encodeURIComponent(msg));
});

/* 메모 저장 — 누가 누구인지 적어두는 칸 */
router.post('/admin/users/:id/memo', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const memo = String(req.body.memo || '').trim().slice(0, 2000) || null;
  await db.query(`UPDATE users SET memo = $1 WHERE id = $2`, [memo, id]);
  res.redirect('/admin?done=' + encodeURIComponent('메모를 저장했습니다'));
});

/* 비밀번호 초기화 */
router.post('/admin/users/:id/reset', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const temp = String(req.body.temp_password || '');
  if (temp.length < 8) {
    return res.redirect('/admin?done=' + encodeURIComponent('임시 비밀번호는 8자 이상이어야 합니다'));
  }
  const hash = await bcrypt.hash(temp, 12);
  await db.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, id]);
  res.redirect('/admin?done=' + encodeURIComponent('비밀번호를 바꿨습니다. 본인에게 전달해 주세요'));
});

/* 회원 삭제 */
router.post('/admin/users/:id/delete', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) {
    return res.redirect('/admin?done=' + encodeURIComponent('본인 계정은 삭제할 수 없습니다'));
  }
  await db.query(`DELETE FROM users WHERE id = $1`, [id]);
  res.redirect('/admin?done=' + encodeURIComponent('회원을 삭제했습니다'));
});

/* ---------------- 도구 관리 ---------------- */
router.post('/admin/tools/save', async (req, res) => {
  const id = req.body.id ? parseInt(req.body.id, 10) : null;
  const slug = String(req.body.slug || '').trim().toLowerCase();
  const title = String(req.body.title || '').trim();
  const description = String(req.body.description || '').trim() || null;
  const category = String(req.body.category || '기타').trim();
  const emoji = String(req.body.emoji || '🧰').trim().slice(0, 8);
  const sort_order = parseInt(req.body.sort_order, 10) || 100;
  const is_active = req.body.is_active === 'on';
  const admin_only = req.body.admin_only === 'on';

  if (!/^[a-z0-9][a-z0-9-]{0,78}$/.test(slug) || !title) {
    return res.redirect('/admin?tab=tools&done=' + encodeURIComponent('주소용 이름은 영문 소문자·숫자·하이픈만 쓸 수 있습니다'));
  }

  try {
    if (id) {
      await db.query(
        `UPDATE tools SET slug=$1,title=$2,description=$3,category=$4,emoji=$5,
                          sort_order=$6,is_active=$7,admin_only=$8 WHERE id=$9`,
        [slug, title, description, category, emoji, sort_order, is_active, admin_only, id]
      );
    } else {
      await db.query(
        `INSERT INTO tools (slug,title,description,category,emoji,sort_order,is_active,admin_only)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [slug, title, description, category, emoji, sort_order, is_active, admin_only]
      );
    }
    res.redirect('/admin?tab=tools&done=' + encodeURIComponent('도구를 저장했습니다'));
  } catch (e) {
    res.redirect('/admin?tab=tools&done=' + encodeURIComponent('저장 실패: ' + e.message));
  }
});

router.post('/admin/tools/:id/delete', async (req, res) => {
  await db.query(`DELETE FROM tools WHERE id = $1`, [parseInt(req.params.id, 10)]);
  res.redirect('/admin?tab=tools&done=' + encodeURIComponent('도구를 삭제했습니다'));
});

/* ---------------- 공지 관리 ---------------- */
router.post('/admin/notices/save', async (req, res) => {
  const id = req.body.id ? parseInt(req.body.id, 10) : null;
  const title = String(req.body.title || '').trim();
  const body = String(req.body.body || '').trim() || null;
  const is_pinned = req.body.is_pinned === 'on';
  const is_active = req.body.is_active === 'on';
  const is_public = req.body.is_public === 'on';

  if (!title) {
    return res.redirect('/admin?tab=notices&done=' + encodeURIComponent('제목을 입력해 주세요'));
  }
  try {
    if (id) {
      await db.query(
        `UPDATE notices SET title=$1, body=$2, is_pinned=$3, is_active=$4, is_public=$5 WHERE id=$6`,
        [title, body, is_pinned, is_active, is_public, id]
      );
    } else {
      await db.query(
        `INSERT INTO notices (title, body, is_pinned, is_active, is_public) VALUES ($1,$2,$3,$4,$5)`,
        [title, body, is_pinned, is_active, is_public]
      );
    }
    res.redirect('/admin?tab=notices&done=' + encodeURIComponent('공지를 저장했습니다'));
  } catch (e) {
    res.redirect('/admin?tab=notices&done=' + encodeURIComponent('저장 실패: ' + e.message));
  }
});

router.post('/admin/notices/:id/delete', async (req, res) => {
  await db.query(`DELETE FROM notices WHERE id = $1`, [parseInt(req.params.id, 10)]);
  res.redirect('/admin?tab=notices&done=' + encodeURIComponent('공지를 삭제했습니다'));
});

/* 관리자 지정 / 해제 */
router.post('/admin/users/:id/role', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const role = req.body.role === 'admin' ? 'admin' : 'member';

  if (id === req.user.id && role !== 'admin') {
    return res.redirect('/admin?done=' + encodeURIComponent('본인 관리자 권한은 해제할 수 없습니다'));
  }

  // 마지막 남은 관리자를 내리면 아무도 승인할 수 없게 된다
  if (role !== 'admin') {
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM users WHERE role='admin'`);
    if (rows[0].n <= 1) {
      return res.redirect('/admin?done=' + encodeURIComponent('관리자가 한 명뿐이라 해제할 수 없습니다'));
    }
  }

  // 관리자로 올릴 때는 승인 상태와 기간도 함께 풀어준다
  if (role === 'admin') {
    await db.query(`UPDATE users SET role='admin', status='active' WHERE id=$1`, [id]);
    return res.redirect('/admin?done=' + encodeURIComponent('관리자로 지정했습니다'));
  }
  await db.query(`UPDATE users SET role='member' WHERE id=$1`, [id]);
  res.redirect('/admin?done=' + encodeURIComponent('관리자 권한을 해제했습니다'));
});

/* ---------------- 회원 상세: 추천 실적 ---------------- */
router.get('/admin/users/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.redirect('/admin');

  try {
    const { rows } = await db.query(
      `SELECT u.*, rf.name AS referrer_name, rf.referral_code AS referrer_code, rf.id AS referrer_id
         FROM users u LEFT JOIN users rf ON rf.id = u.referred_by
        WHERE u.id = $1`,
      [id]
    );
    if (!rows.length) {
      return res.status(404).render('error', {
        title: '없는 회원',
        message: '이미 삭제된 계정일 수 있습니다.',
      });
    }
    const target = rows[0];
    await ensureCode(target.id);

    // 이 사람을 통해 들어온 사람들
    const { rows: invited } = await db.query(
      `SELECT id, name, email, status, provider, created_at
         FROM users WHERE referred_by = $1
        ORDER BY created_at DESC`,
      [id]
    );

    // 그 사람들이 또 데려온 수까지 (2단계)
    let secondCount = 0;
    if (invited.length) {
      const r = await db.query(
        `SELECT count(*)::int AS n FROM users
          WHERE referred_by = ANY($1::int[])`,
        [invited.map((x) => x.id)]
      );
      secondCount = r.rows[0].n;
    }

    const fresh = await db.query(`SELECT referral_code FROM users WHERE id = $1`, [id]);

    res.render('admin-user', {
      title: target.name,
      target: { ...target, referral_code: fresh.rows[0].referral_code },
      invited,
      secondCount,
      notice: req.query.done || null,
    });
  } catch (e) {
    console.error('[회원 상세]', e.message);
    res.status(500).render('error', {
      title: '불러오기 실패',
      message: '추천 정보를 불러오지 못했습니다. npm run setup 을 실행했는지 확인해 주세요.',
    });
  }
});

/* ---------------- 문의 관리 ---------------- */
router.post('/admin/inquiries/:id/status', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const status = String(req.body.status || '');
  if (!['new', 'contacted', 'done', 'spam'].includes(status)) {
    return res.redirect('/admin?tab=inquiries');
  }
  await db.query(`UPDATE inquiries SET status = $1 WHERE id = $2`, [status, id]);
  res.redirect('/admin?tab=inquiries&done=' + encodeURIComponent('상태를 바꿨습니다'));
});

router.post('/admin/inquiries/:id/memo', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const memo = String(req.body.memo || '').trim() || null;
  await db.query(`UPDATE inquiries SET memo = $1 WHERE id = $2`, [memo, id]);
  res.redirect('/admin?tab=inquiries&done=' + encodeURIComponent('메모를 저장했습니다'));
});

router.post('/admin/inquiries/:id/delete', async (req, res) => {
  await db.query(`DELETE FROM inquiries WHERE id = $1`, [parseInt(req.params.id, 10)]);
  res.redirect('/admin?tab=inquiries&done=' + encodeURIComponent('문의를 삭제했습니다'));
});

module.exports = router;
