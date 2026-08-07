const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* ---------------- 로그인 ---------------- */
router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/hub');
  res.render('login', { title: '로그인', error: req.query.e || null });
});

router.get('/login/email', (req, res) => {
  if (req.user) return res.redirect('/hub');
  res.render('login-email', {
    title: '이메일 로그인',
    error: null,
    next: req.query.next || '',
    email: '',
  });
});

router.post('/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const nextUrl = String(req.body.next || '');
  const ip = req.ip;

  const fail = (msg) =>
    res.status(401).render('login-email', {
      title: '이메일 로그인', error: msg, next: nextUrl, email,
    });

  if (!email || !password) return fail('이메일과 비밀번호를 모두 입력해 주세요.');

  try {
    // 최근 10분간 같은 이메일로 실패가 7회를 넘으면 잠시 막는다
    const { rows: att } = await db.query(
      `SELECT count(*)::int AS n FROM login_attempts
        WHERE email = $1 AND ok = false AND created_at > now() - interval '10 minutes'`,
      [email]
    );
    if (att[0].n >= 7) {
      return fail('로그인 시도가 많습니다. 10분 뒤에 다시 시도해 주세요.');
    }

    const { rows } = await db.query(
      `SELECT id, password_hash, status FROM users WHERE email = $1`,
      [email]
    );

    const record = async (ok) =>
      db.query(`INSERT INTO login_attempts (email, ip, ok) VALUES ($1,$2,$3)`, [email, ip, ok]);

    if (rows.length === 0) {
      await record(false);
      return fail('이메일 또는 비밀번호가 맞지 않습니다.');
    }

    const ok = await bcrypt.compare(password, rows[0].password_hash);
    await record(ok);
    if (!ok) return fail('이메일 또는 비밀번호가 맞지 않습니다.');

    req.session.regenerate((err) => {
      if (err) return fail('로그인 처리 중 문제가 생겼습니다. 다시 시도해 주세요.');
      req.session.userId = rows[0].id;
      db.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [rows[0].id]).catch(() => {});
      const safe = nextUrl.startsWith('/') && !nextUrl.startsWith('//') ? nextUrl : '/hub';
      res.redirect(safe);
    });
  } catch (e) {
    console.error('[login]', e.message);
    fail('서버에 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.');
  }
});

/* ---------------- 회원가입 ---------------- */
router.get('/signup', (req, res) => {
  if (req.user) return res.redirect('/hub');
  // 등록은 카카오 로그인 한 번으로 끝난다
  res.redirect('/login');
});

router.post('/signup', async (req, res) => {
  const form = {
    email: String(req.body.email || '').trim().toLowerCase(),
    name: String(req.body.name || '').trim(),
    phone: String(req.body.phone || '').trim(),
    course: String(req.body.course || '').trim(),
  };
  const password = String(req.body.password || '');
  const password2 = String(req.body.password2 || '');

  const fail = (msg) =>
    res.status(400).render('signup', { title: '수강생 등록', error: msg, form });

  if (!EMAIL_RE.test(form.email)) return fail('이메일 형식을 확인해 주세요.');
  if (!form.name) return fail('이름을 입력해 주세요.');
  if (password.length < 8) return fail('비밀번호는 8자 이상으로 만들어 주세요.');
  if (password !== password2) return fail('비밀번호 확인이 일치하지 않습니다.');

  try {
    const dup = await db.query(`SELECT 1 FROM users WHERE email = $1`, [form.email]);
    if (dup.rows.length) return fail('이미 등록된 이메일입니다. 로그인해 주세요.');

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await db.query(
      `INSERT INTO users (email, password_hash, name, phone, course, status)
       VALUES ($1,$2,$3,$4,$5,'pending') RETURNING id`,
      [form.email, hash, form.name, form.phone || null, form.course || null]
    );
    req.session.regenerate(() => {
      req.session.userId = rows[0].id;
      res.redirect('/pending');
    });
  } catch (e) {
    console.error('[signup]', e.message);
    fail('등록 처리 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.');
  }
});

/* ---------------- 승인 대기 안내 ---------------- */
router.get('/pending', (req, res) => {
  if (!req.user) return res.redirect('/login');
  if (req.user.status === 'active' && !req.user.expired) return res.redirect('/hub');
  res.render('pending', { title: '승인 대기', contact: process.env.CONTACT_INFO || '' });
});

/* ---------------- 로그아웃 ---------------- */
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('zhlab.sid');
    res.redirect('/login');
  });
});

module.exports = router;
