/* 바이란 라운지 공통 도구: 설정, 글자 다듬기, 사진 */
const fs = require('fs');
const path = require('path');
const db = require('../db');

/* ---------------- 스키마 자동 적용 ---------------- */
async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'schema-lounge.sql'), 'utf8');
  await db.query(sql);
  await seedOnce();
  await seedCourses();
  await seedPoints();
  await seedStudent();
  await seedEbook();
  await seedPlanV3();
  await seedEbookCode();
  await seedPlanV5();
}

/* 평생 피드백을 추천으로, 전자책은 10명마다 2,000원씩 올라 최대 22만원 (한 번만) */
async function seedPlanV5() {
  const { rows } = await db.query(`SELECT 1 FROM lounge_settings WHERE key='seeded_plan_v5'`);
  if (rows.length) return;
  await db.query(`UPDATE lounge_products SET badge='추천' WHERE title='사주 + 타로 · 평생 피드백'`);
  await db.query(`UPDATE lounge_products SET badge=NULL WHERE title='사주 + 타로 · 6개월 피드백' AND badge='추천'`);
  await db.query(
    `UPDATE lounge_products SET dyn_start=120000, dyn_step=2000, dyn_every=10, dyn_max=220000
      WHERE ptype='ebook' AND dyn_start IS NULL`
  );
  await db.query(`INSERT INTO lounge_settings (key, value) VALUES ('seeded_plan_v5', '1') ON CONFLICT (key) DO NOTHING`);
  console.log('[라운지] 평생 피드백 추천, 전자책 판매량 가격을 넣었습니다.');
}

/* 전자책에 만세력 코드 파일 포함 (한 번만, 이미 적혀 있으면 건너뜀) */
async function seedEbookCode() {
  const { rows } = await db.query(`SELECT 1 FROM lounge_settings WHERE key='seeded_ebook_code_v1'`);
  if (rows.length) return;
  await db.query(
    `UPDATE lounge_products SET perks = '만세력 코드 파일 제공 (사주 명식 계산)' || E'\n' || COALESCE(perks, '')
      WHERE ptype='ebook' AND COALESCE(perks, '') NOT LIKE '%만세력 코드%'`
  );
  await db.query(`INSERT INTO lounge_settings (key, value) VALUES ('seeded_ebook_code_v1', '1') ON CONFLICT (key) DO NOTHING`);
}

/* 상품 구성 정리 (한 번만)
 * 무료 프롬프트 → 무료 전자책 → 사주·타로 전자책 12만 → 6개월 1:1 피드백 110만 → 평생 1:1 피드백 140만
 * 사주 과정 3기는 숨김(관리자에서 다시 켤 수 있음), 수강 신청은 자료실 안으로 */
async function seedPlanV3() {
  const { rows } = await db.query(`SELECT 1 FROM lounge_settings WHERE key='seeded_plan_v3'`);
  if (rows.length) return;
  const FEEDBACK = [
    'AI로 사주·타로 보는 법과 상담 세팅',
    '파는 상품 만들기 · 단가 잡기',
    '홍보 방법 · 스레드로 고객 모으기',
    '스레드 콘텐츠 만들기 · 자동화 프로그램 사용법',
    '실제 운영하면서 1:1 피드백 · 질문과 수정',
    'AI를 쓸 줄 알면 AI 사주 자동화 시스템 만드는 법까지',
  ];
  await db.query(
    `UPDATE lounge_products SET price_text='120,000원', list_price=NULL,
            subtitle='혼자서 AI 사주·타로 부업을 시작할 수 있게, 실제 하는 방법을 정리한 전자책',
            perks=$1 WHERE title='사주·타로 전자책'`,
    [['AI로 사주 풀이하는 방법', '타로 상담에 AI 쓰는 방법', '상담 답변 · 리포트 만드는 방법', '상품 구성 · 기본 운영 방법', '바로 복사해 쓰는 프롬프트', '1:1 피드백 없이 혼자 보고 실행하는 분께'].join('\n')]
  );
  await db.query(
    `UPDATE lounge_products SET kind='1:1 피드백 6개월', badge='추천',
            subtitle='고객 모집부터 상담 운영까지, 실제로 부업을 굴려 보며 6개월 동안 1:1로 같이 가요',
            price_note='매월 5명만 모집', perks=$1 WHERE title='사주 + 타로 · 6개월 피드백'`,
    [FEEDBACK.join('\n')]
  );
  await db.query(
    `UPDATE lounge_products SET kind='1:1 피드백 평생', badge='VIP',
            subtitle='기간 걱정 없이 끝까지. 6개월 과정 전부에 평생 1:1 피드백',
            price_note='매월 5명만 모집', perks=$1 WHERE title='사주 + 타로 · 평생 피드백'`,
    [['6개월 과정에서 하는 것 전부', '1:1 피드백 기간 제한 없음', '바이란의 다른 부업 과정 우선 · 할인 참여'].join('\n')]
  );
  await db.query(`UPDATE lounge_products SET is_active=false WHERE title='사주 과정 · 3기'`);
  // 자료실 안에 수강·전자책 칸이 따로 생기므로 링크형 안내는 숨긴다
  await db.query(`UPDATE lounge_resources SET is_active=false WHERE url IN ('/course', '/course#ebook')`);
  await db.query(`INSERT INTO lounge_settings (key, value) VALUES ('seeded_plan_v3', '1') ON CONFLICT (key) DO NOTHING`);
  console.log('[라운지] 상품 구성(전자책 12만 · 110만 · 140만)을 정리했습니다.');
}

/** "1,100,000원" → 1100000 */
function priceNum(t) {
  const n = parseInt(String(t || '').replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}
const won = (n) => Number(n || 0).toLocaleString('ko-KR') + '원';

/* 사주·타로 전자책 (15만원) — 무료 자료집과 강의 사이 단계 (한 번만) */
async function seedEbook() {
  const { rows } = await db.query(`SELECT 1 FROM lounge_settings WHERE key='seeded_ebook_v1'`);
  if (rows.length) return;
  const ex = await db.query(`SELECT 1 FROM lounge_products WHERE title='사주·타로 전자책'`);
  if (!ex.rows.length) {
    await db.query(
      `INSERT INTO lounge_products (title, subtitle, kind, badge, price_text, perks, sort_order, ptype, student_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'ebook',$8)`,
      [
        '사주·타로 전자책',
        '멘토 없이 혼자 할 수 있게, 사주·타로 하는 방법을 루트 하나하나 정리한 전자책',
        '전자책 · 혼자 하기', '혼자 하기', '150,000원',
        ['사주 · 타로 하는 방법을 처음부터 순서대로', '어디서 · 무엇으로 · 어떻게, 루트 하나하나 자세히', '바로 복사해 쓰는 프롬프트 모음', '멘토 없이 혼자 따라 할 수 있게 정리', '한 번 사면 계속 다시 보기'].join('\n'),
        40,
        '전자책은 계속 다시 볼 수 있어요. 버튼이 안 보이면 1:1 상담으로 말씀해 주세요.',
      ]
    );
  }
  const r = await db.query(`SELECT 1 FROM lounge_resources WHERE url='/course#ebook'`);
  if (!r.rows.length) {
    await db.query(
      `INSERT INTO lounge_resources (section, title, description, kind, url, access, sort_order)
       VALUES ('수강 안내', '사주·타로 전자책 안내', '무료 자료집보다 한 단계 자세하게 — 루트 하나하나와 프롬프트까지 (15만원)', 'link', '/course#ebook', 'member', 6)`
    );
  }
  await db.query(`INSERT INTO lounge_settings (key, value) VALUES ('seeded_ebook_v1', '1') ON CONFLICT (key) DO NOTHING`);
  console.log('[라운지] 사주·타로 전자책을 넣었습니다.');
}

/* 수강생 화면: 지금 과정(사주·타로)은 루월당으로 연결, 과정별 기간 (한 번만) */
async function seedStudent() {
  const { rows } = await db.query(`SELECT 1 FROM lounge_settings WHERE key='seeded_student_v1'`);
  if (rows.length) return;
  const LINK = '루월당 바로가기 | https://www.luwolsaju.com/home';
  const NOTE = '수강 자료와 도구는 루월당에서 이용해요. 로그인이 안 되거나 권한이 필요하면 1:1 상담으로 말씀해 주세요.';
  for (const [title, months] of [['사주 과정 · 3기', 12], ['사주 + 타로 · 6개월 피드백', 6], ['사주 + 타로 · 평생 피드백', null]]) {
    await db.query(
      `UPDATE lounge_products SET months=$2, student_links=COALESCE(student_links, $3), student_note=COALESCE(student_note, $4) WHERE title=$1`,
      [title, months, LINK, NOTE]
    );
  }
  await db.query(`INSERT INTO lounge_settings (key, value) VALUES ('seeded_student_v1', '1') ON CONFLICT (key) DO NOTHING`);
  console.log('[라운지] 수강생 연결(루월당)을 넣었습니다.');
}

/* 포인트 도입: 쿠팡파트너스는 가입만 하면, 사주·타로·스레드 자료집은 1,000P 로 연다 (한 번만) */
async function seedPoints() {
  const { rows } = await db.query(`SELECT 1 FROM lounge_settings WHERE key='seeded_points_v1'`);
  if (rows.length) return;
  await db.query(
    `UPDATE lounge_resources SET access='points', cost=1000, lock_note=NULL
      WHERE title IN ('온라인 사주 무료 자료집', '온라인 타로 무료 자료집', '스레드 글쓰기 무료 자료집')`
  );
  await db.query(`UPDATE lounge_resources SET access='member', cost=0 WHERE title='쿠팡파트너스 무료 자료집'`);
  await db.query(
    `UPDATE lounge_settings SET value=$1 WHERE key='welcome_note' AND value=$2`,
    [SETTING_DEFAULTS.welcome_note, '가입하면 무료 자료집을 바로 볼 수 있어요']
  );
  await db.query(`INSERT INTO lounge_settings (key, value) VALUES ('seeded_points_v1', '1') ON CONFLICT (key) DO NOTHING`);
  settingsCache = null;
  console.log('[라운지] 자료집 포인트 가격을 넣었습니다.');
}

/* 수강 과정 3종과 금액 (운영자가 이미 금액을 넣었으면 건드리지 않는다) */
async function seedCourses() {
  const { rows } = await db.query(`SELECT 1 FROM lounge_settings WHERE key='seeded_courses_v2'`);
  if (rows.length) return;
  const PLANS = [
    {
      old: '사주 과정', title: '사주 과정 · 3기', sort: 10, badge: '마지막 기수',
      subtitle: '사주를 몰라도 퇴근 후 시작하는 AI 사주 운영 과정 (루월당 3기)',
      kind: '1:1 멘토링 1년', price: '800,000원', list: '1,000,000원', note: '3기 라이브 특가 · 10명 한정',
      perks: ['전용 만세력 엔진 (명리학자 제작)', '운세별 사주 리포트 PDF 자동 제작', '내 이름으로 된 무료사주 웹사이트', '이메일 발송 · 추가 질문 응대', '전용 GPTs 7가지 이상', '일진첩 · 스레드 자동화', '상담 대처법 · 교육생 자료집', '1:1 멘토링 1년 (횟수 제한 없음)'],
    },
    {
      old: '사주 + 타로 과정', title: '사주 + 타로 · 6개월 피드백', sort: 20, badge: '추천',
      subtitle: '사주와 타로를 같이 운영하는 방법부터 세팅까지, 혼자 설 수 있을 때까지 6개월',
      kind: '1:1 피드백 6개월', price: '1,100,000원', list: '1,300,000원', note: '해당 월 5명 한정 할인가',
      perks: ['사주 과정 구성 전부 포함', '온라인 타로 운영법 · 타로 자료집', '계정 세팅 · 글 · 상담 흐름 피드백', '사주 + 타로 상품 구성과 단가 잡기', '1:1 피드백 6개월'],
    },
    {
      old: null, title: '사주 + 타로 · 평생 피드백', sort: 30, badge: 'VIP',
      subtitle: '기간 걱정 없이 끝까지 같이 가는 과정. 다음 부업도 먼저, 더 저렴하게',
      kind: '1:1 피드백 평생', price: '1,400,000원', list: '1,600,000원', note: '해당 월 5명 한정 할인가',
      perks: ['사주 + 타로 6개월 과정 구성 전부 포함', '1:1 피드백 평생 (말 그대로 평생)', '바이란의 다른 부업 과정 우선 · 할인 참여 혜택'],
    },
  ];
  for (const p of PLANS) {
    const vals = [p.title, p.subtitle, p.kind, p.badge, p.price, p.list, p.note, p.perks.join('\n'), p.sort];
    let done = false;
    if (p.old) {
      const r = await db.query(
        `UPDATE lounge_products SET title=$1, subtitle=$2, kind=$3, badge=$4, price_text=$5, list_price=$6, price_note=$7, perks=$8, sort_order=$9
          WHERE title=$10 AND price_text IS NULL`,
        [...vals, p.old]
      );
      done = r.rowCount > 0;
    }
    if (!done) {
      const ex = await db.query(`SELECT 1 FROM lounge_products WHERE title=$1`, [p.title]);
      if (!ex.rows.length) {
        await db.query(
          `INSERT INTO lounge_products (title, subtitle, kind, badge, price_text, list_price, price_note, perks, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          vals
        );
      }
    }
  }
  await db.query(`INSERT INTO lounge_settings (key, value) VALUES ('seeded_courses_v2', '1') ON CONFLICT (key) DO NOTHING`);
  console.log('[라운지] 수강 과정 금액을 넣었습니다.');
}

/* 처음 한 번만 기본 자료·과정을 넣는다. 지워도 다시 생기지 않는다. */
async function seedOnce() {
  const { rows } = await db.query(`SELECT 1 FROM lounge_settings WHERE key='seeded_v1'`);
  if (rows.length) return;
  const res = [
    ['수강 안내', '수강 신청 안내', '사주 과정 / 사주 + 타로 과정 — 금액과 신청 방법', 'link', '/course', 'member', null, 5],
    ['사주·타로', '온라인 사주 무료 자료집', '스레드로 무료 사주를 봐주고 유료 상담까지 이어지는 흐름', 'link', 'https://app.notion.com/p/3a8716819fd8805ea568eb7d1e0aac3a', 'member', null, 10],
    ['사주·타로', '온라인 타로 무료 자료집', '78장 몰라도 시작하는 타로 부업 — 기초, 글쓰기, 단가, 14일 실행표', 'link', 'https://app.notion.com/p/3e9716819fd8817aa7cbee9cbfd1a1db', 'code', '무료 라이브에서 받아가세요', 11],
    ['쿠팡파트너스', '쿠팡파트너스 무료 자료집', '가입부터 첫 정산, 공정위 문구, 스레드에 올리는 순서까지', 'link', 'https://app.notion.com/p/3e9716819fd881ef97f7f71a526059c2', 'member', null, 20],
    ['스레드 글쓰기', '스레드 글쓰기 무료 자료집', '첫 줄 쓰는 법, 글 구조 4개, 조회수 진단, 7일 실행표', 'link', 'https://app.notion.com/p/3e9716819fd8817f817effe8cf8fb3ec', 'member', null, 30],
  ];
  for (const r of res) {
    await db.query(
      `INSERT INTO lounge_resources (section, title, description, kind, url, access, lock_note, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      r
    );
  }
  await db.query(
    `INSERT INTO lounge_products (title, subtitle, kind, sort_order) VALUES
      ('사주 과정', '사주 자료집 + 계정 세팅·글 피드백·상담 흐름까지 같이 잡아드려요', '1:1 피드백', 10),
      ('사주 + 타로 과정', '사주와 타로를 같이 운영하는 과정 — 타로 자료집과 피드백 포함', '1:1 피드백', 20)`
  );
  await db.query(`INSERT INTO lounge_settings (key, value) VALUES ('seeded_v1', '1') ON CONFLICT (key) DO NOTHING`);
  console.log('[라운지] 기본 자료와 과정을 넣었습니다.');
}

/* ---------------- 설정 ---------------- */
const SETTING_DEFAULTS = {
  consult_url: 'http://pf.kakao.com/_TCcBX',   // 1:1 상담 (카카오 채널)
  live_room_url: '',                            // 전체 카톡방 (오픈채팅)
  live_room_code: '',                           // 오픈채팅 참여코드
  hero_title: '혼자 하면 멈추고,\n같이 하면 쌓입니다',
  hero_sub: 'AI로 블로그·스레드·부업을 시작한 사람들이\n같이 묻고, 같이 크는 곳',
  review_link: '',                              // 외부 후기 모음 (카페 등)
  welcome_note: '가입하면 쿠팡파트너스 자료집은 바로, 다른 자료집은 포인트로 열려요',
  live_code: '',                                // 무료 라이브에서 알려주는 자료 코드
  live_note: '무료 라이브에 참여하시면 코드를 알려드려요',
  prompt_public: '0',                           // 1이면 로그인 없이도 프롬프트 복사 가능
  course_note: '',                              // 수강 신청 페이지 위쪽 안내
  cash_note: '현금(계좌이체)으로 결제하시면 10만원을 더 할인해 드려요',
  agency_kakao: 'https://open.kakao.com/me/byran_Marketing', // 대행 문의 카톡
  pt_post: '10',                                // 글 1개 포인트
  pt_post_daily: '5',                           // 글 포인트 하루 최대 개수
  pt_review: '50',                              // 후기 1개 포인트
  pt_review_daily: '1',                         // 후기 포인트 하루 최대 개수
};

let settingsCache = null;
let settingsAt = 0;
async function settings() {
  if (settingsCache && Date.now() - settingsAt < 30000) return settingsCache;
  const s = { ...SETTING_DEFAULTS };
  try {
    const { rows } = await db.query(`SELECT key, value FROM lounge_settings`);
    for (const r of rows) if (r.key in s) s[r.key] = r.value || '';
  } catch (e) {}
  settingsCache = s;
  settingsAt = Date.now();
  return s;
}
async function saveSettings(obj) {
  for (const k of Object.keys(SETTING_DEFAULTS)) {
    if (!(k in obj)) continue;
    await db.query(
      `INSERT INTO lounge_settings (key, value) VALUES ($1,$2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [k, String(obj[k] || '').trim()]
    );
  }
  settingsCache = null;
}

/* ---------------- 글자 다듬기 ---------------- */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
/** 이스케이프한 뒤 링크만 살린다 */
function linkify(s) {
  return esc(s).replace(
    /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g,
    '<a href="$1" target="_blank" rel="noopener nofollow">$1</a>'
  );
}
function ago(d) {
  const t = new Date(d).getTime();
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}일 전`;
  const k = new Date(t + 9 * 3600 * 1000);
  return `${k.getUTCMonth() + 1}.${k.getUTCDate()}`;
}
function safeUrl(u) {
  const s = String(u || '').trim();
  return /^https?:\/\//i.test(s) ? s : '';
}
/** 바깥 주소(http) 또는 사이트 안 주소(/course 등) */
function safeLink(u) {
  const s = String(u || '').trim();
  if (/^\/[^/\\]/.test(s)) return s;
  return safeUrl(s);
}
function ymd(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function kstToday() {
  return ymd(new Date(Date.now() + 9 * 3600 * 1000));
}

/* ---------------- 사진 ---------------- */
const IMG_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
/** 브라우저에서 줄여 보낸 data URL 을 저장하고 id 를 돌려준다 */
async function saveImage(userId, dataUrl) {
  const m = IMG_RE.exec(String(dataUrl || ''));
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 2.5 * 1024 * 1024) return null;
  const { rows } = await db.query(
    `INSERT INTO lounge_images (user_id, mime, data) VALUES ($1,$2,$3) RETURNING id`,
    [userId, m[1], buf]
  );
  return rows[0].id;
}

/* ---------------- 닉네임 ---------------- */
const NICK_RE = /^[가-힣a-zA-Z0-9_ ]{2,10}$/;
const NICK_BAN = ['관리자', '운영자', '바이란', 'admin', '어드민', '제일라', '이안', '씨발', '시발', '병신', '섹스'];
// 운영자(관리자)는 막아 둔 이름(이안·바이란 등)도 쓸 수 있다 — 남이 운영자 행세하는 것만 막는 장치
function checkNick(n, opts = {}) {
  const s = String(n || '').trim().replace(/\s+/g, ' ');
  if (!NICK_RE.test(s)) return { ok: false, msg: '닉네임은 2~10자, 한글·영문·숫자만 쓸 수 있어요.' };
  const low = s.toLowerCase().replace(/\s/g, '');
  if (!opts.admin && NICK_BAN.some((w) => low.includes(w))) return { ok: false, msg: '쓸 수 없는 단어가 들어 있어요.' };
  return { ok: true, value: s };
}

const INTERESTS = ['블로그 부업', '스레드·SNS', 'AI 활용', '사주·타로', '쿠팡파트너스', 'AI 이미지', '1인 창업', '기타'];

const CATEGORIES = {
  notice: { label: '공지' },
  hello:  { label: '가입인사' },
  proof:  { label: '오늘의 인증' },
  free:   { label: '자유' },
  qna:    { label: '질문' },
  secret: { label: '1:1 문의' },
};

const RESULT_KINDS = {
  income:   { label: '수익', icon: '💰' },
  inquiry:  { label: '문의', icon: '📩' },
  follower: { label: '팔로워', icon: '📈' },
  view:     { label: '조회수', icon: '👀' },
};

// 자료실 칸 (관리자 화면에서 고를 수 있는 기본값. 직접 입력도 된다)
const SECTIONS = ['수강 안내', '사주·타로', '쿠팡파트너스', '스레드 글쓰기', 'AI 이미지', '무료 자료'];

const PROMPT_CATS = ['인물/화보', '셀카/일상', '뷰티/클로즈업', '캐릭터/코스프레', '음식/제품', '일러스트', '기타'];

module.exports = {
  migrate, safeLink, settings, saveSettings, SETTING_DEFAULTS, esc, linkify, ago, safeUrl, saveImage,
  checkNick, INTERESTS, CATEGORIES, RESULT_KINDS, SECTIONS, PROMPT_CATS, kstToday, priceNum, won,
};
