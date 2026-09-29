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
function checkNick(n) {
  const s = String(n || '').trim().replace(/\s+/g, ' ');
  if (!NICK_RE.test(s)) return { ok: false, msg: '닉네임은 2~10자, 한글·영문·숫자만 쓸 수 있어요.' };
  const low = s.toLowerCase().replace(/\s/g, '');
  if (NICK_BAN.some((w) => low.includes(w))) return { ok: false, msg: '쓸 수 없는 단어가 들어 있어요.' };
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
  checkNick, INTERESTS, CATEGORIES, RESULT_KINDS, SECTIONS, PROMPT_CATS, kstToday,
};
