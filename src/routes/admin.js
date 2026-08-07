const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// /admin 으로 시작하는 요청에만 권한 검사를 건다.
// router.use(requireAdmin) 처럼 전역으로 걸면 이 라우터를 스쳐 지나가는
// 다른 모든 경로(404 포함)까지 로그인 화면으로 밀려난다.
router.use('/admin', requireAdmin);

/* ---------------- 회원 관리 ---------------- */
router.get('/admin', async (req, res) => {
  const tab = ['tools', 'notices'].includes(req.query.tab) ? req.query.tab : 'users';
  const filter = req.query.filter || 'all';

  try {
    let where = '';
    const params = [];
    if (filter === 'pending') where = `WHERE status = 'pending'`;
    else if (filter === 'active') where = `WHERE status = 'active'`;
    else if (filter === 'suspended') where = `WHERE status = 'suspended'`;
    else if (filter === 'expired') where = `WHERE expires_at IS NOT NULL AND expires_at < CURRENT_DATE`;

    const { rows: users } = await db.query(
      `SELECT id, email, name, phone, course, role, status, expires_at, memo,
              last_login_at, created_at,
              (expires_at IS NOT NULL AND expires_at < CURRENT_DATE) AS expired
         FROM users ${where}
        ORDER BY (status='pending') DESC, created_at DESC
        LIMIT 300`,
      params
    );

    const { rows: stat } = await db.query(
      `SELECT
         count(*) FILTER (WHERE status='pending')   ::int AS pending,
         count(*) FILTER (WHERE status='active')    ::int AS active,
         count(*) FILTER (WHERE status='suspended') ::int AS suspended,
         count(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at < CURRENT_DATE) ::int AS expired
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

    const { rows: recent } = await db.query(
      `SELECT l.tool_slug, l.created_at, u.name
         FROM access_logs l JOIN users u ON u.id = l.user_id
        ORDER BY l.created_at DESC LIMIT 20`
    );

    res.render('admin', {
      title: '관리',
      tab, filter, users, tools, recent, notices,
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
  res.redirect('/admin?done=' + encodeURIComponent('상태를 바꿨습니다'));
});

/* 회원 정보 수정 (만료일, 과정, 메모, 권한) */
router.post('/admin/users/:id/update', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const expires = req.body.expires_at ? req.body.expires_at : null;
  const course = String(req.body.course || '').trim() || null;
  const memo = String(req.body.memo || '').trim() || null;
  let role = String(req.body.role || 'member');
  if (!['member', 'admin'].includes(role)) role = 'member';

  if (id === req.user.id && role !== 'admin') {
    return res.redirect('/admin?done=' + encodeURIComponent('본인 관리자 권한은 해제할 수 없습니다'));
  }

  await db.query(
    `UPDATE users SET expires_at = $1, course = $2, memo = $3, role = $4 WHERE id = $5`,
    [expires, course, memo, role, id]
  );
  res.redirect('/admin?done=' + encodeURIComponent('회원 정보를 저장했습니다'));
});

/* 수강 기간 연장 (개월 단위) */
router.post('/admin/users/:id/extend', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const months = Math.max(1, Math.min(36, parseInt(req.body.months, 10) || 1));
  await db.query(
    `UPDATE users
        SET expires_at = GREATEST(COALESCE(expires_at, CURRENT_DATE), CURRENT_DATE)
                         + ($1 || ' months')::interval,
            status = 'active'
      WHERE id = $2`,
    [String(months), id]
  );
  res.redirect('/admin?done=' + encodeURIComponent(months + '개월 연장했습니다'));
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

  if (!title) {
    return res.redirect('/admin?tab=notices&done=' + encodeURIComponent('제목을 입력해 주세요'));
  }
  try {
    if (id) {
      await db.query(
        `UPDATE notices SET title=$1, body=$2, is_pinned=$3, is_active=$4 WHERE id=$5`,
        [title, body, is_pinned, is_active, id]
      );
    } else {
      await db.query(
        `INSERT INTO notices (title, body, is_pinned, is_active) VALUES ($1,$2,$3,$4)`,
        [title, body, is_pinned, is_active]
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

module.exports = router;
