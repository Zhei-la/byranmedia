const express = require('express');
const db = require('../db');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* ---------------- 소개 페이지 ----------------
   '/' 는 이제 바이란 라운지(커뮤니티) 홈이다.
   예전 소개 페이지는 '/about' 과 '/home' 에서 그대로 볼 수 있다. */
router.get(['/about', '/home'], async (req, res) => {

  let notices = [];
  try {
    const { rows } = await db.query(
      `SELECT title, body, created_at FROM notices
        WHERE is_active = true AND is_public = true
        ORDER BY is_pinned DESC, created_at DESC LIMIT 4`
    );
    notices = rows.map((n) => ({
      ...n,
      dateText: new Date(n.created_at).toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
    }));
  } catch (e) {
    /* 공지가 없어도 첫 화면은 떠야 한다 */
  }

  res.render('landing', {
    title: '', notices,
    ogT: '바이란미디어 · AI로 시작하는 1인 창업',
    ogD: '강의를 파는 게 아니라 도구를 드립니다. 블로그 대행에 쓰는 도구와 계약서까지 그대로.',
  });
});

/* ---------------- 문의 접수 ---------------- */
router.post('/inquiry', async (req, res) => {
  // 사람에게는 보이지 않는 칸. 채워져 있으면 자동 프로그램으로 본다.
  if (String(req.body.website || '').trim()) {
    return res.redirect('/about?sent=1#contact');
  }

  const form = {
    name: String(req.body.name || '').trim(),
    phone: String(req.body.phone || '').trim(),
    email: String(req.body.email || '').trim(),
    business: String(req.body.business || '').trim(),
    plan: String(req.body.plan || '').trim(),
    message: String(req.body.message || '').trim(),
  };

  const back = async (msg) => {
    let notices = [];
    try {
      const { rows } = await db.query(
        `SELECT title, body, created_at FROM notices
          WHERE is_active = true AND is_public = true
          ORDER BY is_pinned DESC, created_at DESC LIMIT 4`
      );
      notices = rows.map((n) => ({
        ...n,
        dateText: new Date(n.created_at).toLocaleDateString('ko-KR', {
          year: 'numeric', month: 'long', day: 'numeric',
        }),
      }));
    } catch (e) {}
    res.status(400).render('landing', { title: '', notices, sent: false, error: msg, form });
  };

  if (!form.name) return back('이름을 입력해 주세요.');
  if (!form.phone && !form.email) return back('연락처나 이메일 중 하나는 알려 주세요.');
  if (form.email && !EMAIL_RE.test(form.email)) return back('이메일 형식을 확인해 주세요.');
  if (form.message.length > 3000) return back('문의 내용이 너무 깁니다. 3000자 안으로 줄여 주세요.');

  try {
    // 같은 IP에서 10분 안에 5건을 넘기면 받지 않는다
    const { rows: cnt } = await db.query(
      `SELECT count(*)::int AS n FROM inquiries
        WHERE ip = $1 AND created_at > now() - interval '10 minutes'`,
      [req.ip]
    );
    if (cnt[0].n >= 5) {
      return back('문의가 여러 건 접수됐습니다. 잠시 후 다시 시도해 주세요.');
    }

    await db.query(
      `INSERT INTO inquiries (name, phone, email, business, plan, message, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [form.name, form.phone || null, form.email || null, form.business || null,
       form.plan || null, form.message || null, req.ip]
    );
    res.redirect('/about?sent=1#contact');
  } catch (e) {
    console.error('[inquiry]', e.message);
    back('접수 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.');
  }
});

module.exports = router;
