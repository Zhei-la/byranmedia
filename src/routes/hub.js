const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { requireActive } = require('../middleware/auth');

const router = express.Router();
const TOOLS_DIR = path.join(__dirname, '..', '..', 'protected', 'tools');
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,78}$/;

/* ---------------- 도구 허브 ---------------- */
router.get('/hub', requireActive, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT slug, title, description, category, emoji, admin_only
         FROM tools
        WHERE is_active = true
          AND (admin_only = false OR $1 = 'admin')
        ORDER BY sort_order, title`,
      [req.user.role]
    );

    const groups = {};
    for (const t of rows) {
      (groups[t.category] = groups[t.category] || []).push(t);
    }

    // 최근에 연 도구 (중복 제거, 최대 4개)
    let recentTools = [];
    try {
      const { rows: r } = await db.query(
        `SELECT DISTINCT ON (l.tool_slug) l.tool_slug, t.title, t.emoji, l.created_at
           FROM access_logs l
           JOIN tools t ON t.slug = l.tool_slug
          WHERE l.user_id = $1 AND t.is_active = true
            AND (t.admin_only = false OR $2 = 'admin')
          ORDER BY l.tool_slug, l.created_at DESC`,
        [req.user.id, req.user.role]
      );
      recentTools = r
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 4)
        .map((x) => ({ slug: x.tool_slug, title: x.title, emoji: x.emoji }));
    } catch (e) {
      /* 기록이 없어도 홈은 열려야 한다 */
    }

    // 공지
    let notices = [];
    try {
      const { rows: n } = await db.query(
        `SELECT id, title, body, is_pinned, created_at
           FROM notices WHERE is_active = true
          ORDER BY is_pinned DESC, created_at DESC LIMIT 5`
      );
      notices = n.map((x) => ({
        ...x,
        dateText: new Date(x.created_at).toLocaleDateString('ko-KR', {
          month: 'numeric',
          day: 'numeric',
        }),
      }));
    } catch (e) {
      /* notices 테이블이 아직 없을 수 있다 */
    }

    // 수강 기간
    let daysLeft = null;
    let expiresText = '';
    if (req.user.expires_at) {
      const end = new Date(req.user.expires_at);
      const now = new Date(new Date().toDateString());
      daysLeft = Math.ceil((end - now) / 86400000);
      expiresText = end.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    }

    const today = new Date().toLocaleDateString('ko-KR', {
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    });

    res.render('hub', {
      title: '도구',
      groups,
      count: rows.length,
      recentTools,
      notices,
      daysLeft,
      expiresText,
      today,
    });
  } catch (e) {
    console.error('[hub]', e.message);
    res.status(500).render('error', {
      title: '불러오기 실패',
      message: '도구 목록을 가져오지 못했습니다. 새로고침해 주세요.',
    });
  }
});

/* ---------------- 도구 실행 ----------------
   protected/ 폴더는 정적 서빙 대상이 아니므로
   반드시 이 라우트를 통과해야만 파일에 닿는다.        */
router.get('/t/:slug', requireActive, async (req, res) => {
  const slug = String(req.params.slug || '');
  if (!SLUG_RE.test(slug)) return res.status(404).render('error', notFound());

  try {
    const { rows } = await db.query(
      `SELECT slug, title, admin_only, is_active FROM tools WHERE slug = $1`,
      [slug]
    );
    if (!rows.length || !rows[0].is_active) {
      return res.status(404).render('error', notFound());
    }
    if (rows[0].admin_only && req.user.role !== 'admin') {
      return res.status(403).render('error', {
        title: '접근 권한 없음',
        message: '관리자만 사용할 수 있는 도구입니다.',
      });
    }

    res.render('tool', { title: rows[0].title, slug, toolTitle: rows[0].title });

    db.query(`INSERT INTO access_logs (user_id, tool_slug) VALUES ($1,$2)`, [
      req.user.id,
      slug,
    ]).catch(() => {});
  } catch (e) {
    console.error('[tool]', e.message);
    res.status(500).render('error', {
      title: '불러오기 실패',
      message: '도구를 여는 중 문제가 생겼습니다.',
    });
  }
});

/* 도구의 실제 화면 (iframe 안에서 열림) */
router.get('/t/:slug/view', requireActive, async (req, res) => {
  const slug = String(req.params.slug || '');
  if (!SLUG_RE.test(slug)) return res.status(404).send('없는 도구입니다.');

  try {
    const { rows } = await db.query(
      `SELECT admin_only, is_active FROM tools WHERE slug = $1`,
      [slug]
    );
    if (!rows.length || !rows[0].is_active) return res.status(404).send('없는 도구입니다.');
    if (rows[0].admin_only && req.user.role !== 'admin') return res.status(403).send('권한이 없습니다.');

    const file = path.join(TOOLS_DIR, slug, 'index.html');
    if (!file.startsWith(TOOLS_DIR) || !fs.existsSync(file)) {
      return res
        .status(404)
        .send('<p style="font-family:sans-serif;padding:30px">이 도구의 파일이 아직 올라가지 않았습니다.<br>protected/tools/' + slug + '/index.html 을 추가해 주세요.</p>');
    }
    res.sendFile(file);
  } catch (e) {
    console.error('[tool view]', e.message);
    res.status(500).send('불러오기에 실패했습니다.');
  }
});

/* 도구가 쓰는 부가 파일 (이미지, 폰트 등) */
router.get('/t/:slug/asset/:file', requireActive, (req, res) => {
  const { slug, file } = req.params;
  if (!SLUG_RE.test(slug) || /[/\\]|\.\./.test(file)) return res.status(404).end();
  const target = path.join(TOOLS_DIR, slug, file);
  if (!target.startsWith(TOOLS_DIR) || !fs.existsSync(target)) return res.status(404).end();
  res.sendFile(target);
});

function notFound() {
  return { title: '없는 도구', message: '주소를 다시 확인해 주세요.' };
}

module.exports = router;
