const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireActive } = require('../middleware/auth');

const router = express.Router();

/** 사장님께 보낼 주소에 들어갈 임의의 문자열 */
function makeToken() {
  return crypto.randomBytes(9).toString('base64url'); // 12자
}

/* 사장님이 채우는 항목. 순서와 이름을 한곳에서 관리한다. */
const FIELDS = [
  { g: '기본 정보', k: 'name', label: '정확한 상호명', req: true },
  { g: '기본 정보', k: 'addr', label: '주소 (건물명·층까지)' },
  { g: '기본 정보', k: 'tel', label: '전화번호' },
  { g: '기본 정보', k: 'hours', label: '영업시간', ph: '예: 10:00~19:00' },
  { g: '기본 정보', k: 'off', label: '쉬는 날 · 브레이크타임', ph: '예: 매주 월요일 / 15:00~16:00' },
  { g: '기본 정보', k: 'park', label: '주차', ph: '예: 가능 5대 / 불가' },
  { g: '기본 정보', k: 'book', label: '예약 방법', ph: '예: 전화 예약 / 네이버 예약' },

  { g: '대표 메뉴 · 서비스', k: 'menu', label: '가장 알리고 싶은 것 세 가지', big: true,
    ph: '한 줄에 하나씩 적어주세요\n예) 솥뚜껑 닭도리탕 — 직접 잡아온 닭 사용' },
  { g: '대표 메뉴 · 서비스', k: 'price', label: '가격을 글에 적어도 될까요?',
    ph: '예: 적어도 됩니다 / 대표 메뉴만 / 문의로 표기해주세요' },

  { g: '다른 곳과 다른 점', k: 'diff', label: '딱 하나만 꼽으면 무엇인가요?', big: true,
    hint: '이 항목이 글의 중심이 됩니다. 비어 있으면 어느 가게에나 해당되는 밋밋한 글이 나옵니다.' },
  { g: '다른 곳과 다른 점', k: 'why', label: '그렇게 하시는 이유가 있나요?', big: true },

  { g: '손님', k: 'target', label: '주로 오시는 손님', ph: '나이대, 어떤 상황에 오시는지' },
  { g: '손님', k: 'faq', label: '가장 많이 물어보시는 것 세 가지', big: true, ph: '한 줄에 하나씩' },
  { g: '손님', k: 'misread', label: '손님들이 오해하고 오시는 게 있나요?', big: true },

  { g: '실제로 있었던 일', k: 'story', label: '최근 기억에 남는 손님이나 일', big: true,
    hint: '글에서 가장 잘 읽히는 부분입니다. 지어낼 수 없는 내용이라 여쭙습니다.' },
  { g: '실제로 있었던 일', k: 'start', label: '이 일을 시작하신 계기', big: true },
  { g: '실제로 있었던 일', k: 'recent', label: '요즘 신경 쓰고 계신 것', big: true,
    ph: '재료, 시설, 새 메뉴 등' },

  { g: '사진', k: 'photo', label: '보내주실 수 있는 사진', big: true,
    ph: '예: 가게 외부, 내부, 메뉴 사진 있습니다 / 사진이 없어 촬영이 필요합니다' },
  { g: '사진', k: 'face', label: '얼굴 노출', ph: '예: 사장님 가능, 직원 불가' },

  { g: '하지 말아야 할 것', k: 'ban', label: '절대 쓰면 안 되는 표현', big: true,
    ph: '예: 예전 상호, 특정 경쟁사 언급' },
  { g: '하지 말아야 할 것', k: 'secret', label: '노출하면 안 되는 정보', big: true,
    ph: '예: 내부 가격표, 거래처' },

  { g: '마지막으로', k: 'goal', label: '블로그로 무엇을 얻고 싶으신가요?',
    ph: '예: 전화 문의 / 예약 / 가게 인지도' },
  { g: '마지막으로', k: 'search', label: '손님이 우리를 검색한다면 어떤 말로 찾을까요?', big: true,
    ph: '생각나는 대로 세 개' },
  { g: '마지막으로', k: 'etc', label: '더 하고 싶으신 말씀', big: true },
];

/* ---------------- 수강생: 요청서 목록 ---------------- */
router.get('/brief', requireActive, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, token, client_name, status, created_at, submitted_at
         FROM briefs WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [req.user.id]
    );
    res.render('brief-list', { title: '정보 요청서', briefs: rows, notice: req.query.done || null });
  } catch (e) {
    console.error('[요청서 목록]', e.message);
    res.status(500).render('error', {
      title: '불러오기 실패',
      message: '요청서를 불러오지 못했습니다. npm run setup 을 실행했는지 확인해 주세요.',
    });
  }
});

/* 새 요청서 만들기 */
router.post('/brief/new', requireActive, async (req, res) => {
  const name = String(req.body.client_name || '').trim().slice(0, 120) || null;
  try {
    for (let i = 0; i < 6; i++) {
      const token = makeToken();
      try {
        const { rows } = await db.query(
          `INSERT INTO briefs (token, owner_id, client_name) VALUES ($1,$2,$3) RETURNING id`,
          [token, req.user.id, name]
        );
        return res.redirect('/brief/' + rows[0].id);
      } catch (e) {
        if (e.code !== '23505') throw e; // 토큰이 겹치면 다시 뽑는다
      }
    }
    res.redirect('/brief?done=' + encodeURIComponent('주소를 만들지 못했습니다. 다시 시도해 주세요'));
  } catch (e) {
    console.error('[요청서 생성]', e.message);
    res.redirect('/brief?done=' + encodeURIComponent('생성 실패: ' + e.message));
  }
});

/* 받은 내용 보기 */
router.get('/brief/:id', requireActive, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.redirect('/brief');
  try {
    const { rows } = await db.query(
      `SELECT * FROM briefs WHERE id = $1 AND owner_id = $2`,
      [id, req.user.id]
    );
    if (!rows.length) return res.redirect('/brief');
    const b = rows[0];
    const link = `${res.locals.baseUrl}/f/${b.token}`;

    // 카카오톡에 그대로 붙여넣을 인사말
    const msg =
      `안녕하세요 사장님 블로그 원고 준비하면서 가게 정보를 여쭤보려 합니다\n\n` +
      `아래 주소로 들어가셔서 아시는 것만 적어주시면 됩니다\n` +
      `없는 내용을 지어내지 않으려고 확인드리는 거라 빈칸이 있어도 괜찮습니다\n\n` +
      `${link}\n\n` +
      `폰에서 바로 작성하실 수 있고 중간에 나가셨다가 다시 들어오셔도 됩니다\n` +
      `사진도 보내주시면 글이 훨씬 살아납니다 감사합니다`;

    // 원고 프롬프트에 붙여넣을 형태
    let prompt = '';
    if (b.status === 'done' && b.data) {
      const L = ['# 확인된 업체 정보', '아래에 적힌 것만 사실로 취급한다. 여기 없는 내용은 절대 쓰지 않는다.', ''];
      let lastG = '';
      for (const f of FIELDS) {
        const v = b.data[f.k];
        if (!v) continue;
        if (f.g !== lastG) { lastG = f.g; L.push(`## ${f.g}`); }
        if (v.includes('\n')) {
          L.push(`- ${f.label}:`);
          v.split('\n').filter((x) => x.trim()).forEach((x) => L.push(`  · ${x.trim()}`));
        } else {
          L.push(`- ${f.label}: ${v}`);
        }
      }
      const missing = FIELDS.filter((f) => !b.data[f.k]).map((f) => f.label);
      L.push('', '# 사실 규칙');
      L.push('- 위에 없는 정보는 추측해서 쓰지 않는다.');
      L.push('- 필요한데 없으면 본문에 넣지 말고 [확인 필요]에 질문으로 남긴다.');
      L.push('- 특히 가격, 수상, 경력, 후기, 통계는 위에 없으면 절대 쓰지 않는다.');
      if (missing.length) {
        L.push('', '# 답을 받지 못한 항목 (글에 쓰지 말 것)');
        L.push(missing.join(' / '));
      }
      prompt = L.join('\n');
    }

    res.render('brief-view', {
      title: b.client_name || '정보 요청서',
      brief: b,
      fields: FIELDS,
      link, msg, prompt,
    });
  } catch (e) {
    console.error('[요청서 보기]', e.message);
    res.redirect('/brief');
  }
});

router.post('/brief/:id/delete', requireActive, async (req, res) => {
  await db.query(`DELETE FROM briefs WHERE id = $1 AND owner_id = $2`, [
    parseInt(req.params.id, 10), req.user.id,
  ]);
  res.redirect('/brief?done=' + encodeURIComponent('삭제했습니다'));
});

/* ---------------- 사장님: 공개 작성 화면 ---------------- */
router.get('/f/:token', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT b.*, u.name AS owner_name FROM briefs b
         JOIN users u ON u.id = b.owner_id WHERE b.token = $1`,
      [String(req.params.token)]
    );
    if (!rows.length) {
      return res.status(404).render('brief-gone', { title: '없는 주소' });
    }
    res.render('brief-form', {
      title: '업체 정보 작성',
      brief: rows[0],
      fields: FIELDS,
      data: rows[0].data || {},
      sent: req.query.sent === '1',
      error: null,
    });
  } catch (e) {
    console.error('[공개 폼]', e.message);
    res.status(500).render('brief-gone', { title: '열 수 없습니다' });
  }
});

router.post('/f/:token', async (req, res) => {
  const token = String(req.params.token);
  try {
    const { rows } = await db.query(`SELECT id FROM briefs WHERE token = $1`, [token]);
    if (!rows.length) return res.status(404).render('brief-gone', { title: '없는 주소' });

    const data = {};
    for (const f of FIELDS) {
      const v = String(req.body[f.k] || '').trim().slice(0, 3000);
      if (v) data[f.k] = v;
    }
    if (!data.name) {
      const b = await db.query(
        `SELECT b.*, u.name AS owner_name FROM briefs b JOIN users u ON u.id=b.owner_id WHERE b.token=$1`,
        [token]
      );
      return res.status(400).render('brief-form', {
        title: '업체 정보 작성',
        brief: b.rows[0],
        fields: FIELDS,
        data: { ...(b.rows[0].data || {}), ...req.body },
        sent: false,
        error: '상호명은 꼭 적어주세요.',
      });
    }

    await db.query(
      `UPDATE briefs SET data = $1, status = 'done', submitted_at = now(),
              client_name = COALESCE(client_name, $2)
        WHERE token = $3`,
      [JSON.stringify(data), data.name, token]
    );
    res.redirect(`/f/${token}?sent=1`);
  } catch (e) {
    console.error('[공개 폼 제출]', e.message);
    res.status(500).render('brief-gone', { title: '저장하지 못했습니다' });
  }
});

module.exports = router;
module.exports.FIELDS = FIELDS;
