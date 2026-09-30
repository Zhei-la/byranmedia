const db = require('../db');

/** 매 요청마다 세션의 사용자 정보를 DB에서 새로 읽는다.
 *  관리자가 정지시키면 즉시 반영되도록 하기 위함. */
async function loadUser(req, res, next) {
  res.locals.user = null;
  res.locals.path = req.path;
  if (!req.session || !req.session.userId) return next();

  try {
    const { rows } = await db.query(
      `SELECT id, email, name, role, status, memo, provider, nickname, interest, country
         FROM users WHERE id = $1`,
      [req.session.userId]
    );
    if (rows.length === 0) {
      req.session.destroy(() => {});
      return next();
    }
    const u = rows[0];
    req.user = u;
    res.locals.user = u;
  } catch (e) {
    console.error('[loadUser]', e.message);
  }
  next();
}

/** 로그인 필수 */
function requireLogin(req, res, next) {
  if (!req.user) {
    const back = encodeURIComponent(req.originalUrl);
    return res.redirect(`/login?next=${back}`);
  }
  next();
}

/** 승인 완료 + 기간 유효한 회원만 */
function requireActive(req, res, next) {
  if (!req.user) return res.redirect('/login');
  if (req.user.status === 'pending') return res.redirect('/pending');
  if (req.user.status === 'suspended') return res.redirect('/pending');
  next();
}

/** 관리자 전용 */
function requireAdmin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  if (req.user.role !== 'admin') {
    return res.status(403).render('error', {
      title: '접근 권한 없음',
      message: '관리자만 볼 수 있는 화면입니다.',
    });
  }
  next();
}

module.exports = { loadUser, requireLogin, requireActive, requireAdmin };
