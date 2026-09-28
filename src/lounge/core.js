/* 바이란 라운지 공통 도구: 포인트, 등급, 설정, 글자 다듬기 */
const fs = require('fs');
const path = require('path');
const db = require('../db');

/* ---------------- 스키마 자동 적용 ---------------- */
async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'schema-lounge.sql'), 'utf8');
  await db.query(sql);
}

/* ---------------- 포인트 규칙 ---------------- */
const RULES = {
  attend:  { amount: 10, label: '출석체크' },
  proof:   { amount: 20, label: '오늘의 인증글' },
  hello:   { amount: 30, label: '가입 인사' },
  comment: { amount: 2,  label: '댓글', dailyMax: 5 },
  result:  { amount: 20, label: '성과 인증샷' },
  review:  { amount: 50, label: '후기 승인' },
  mission: { amount: 20, label: '챌린지 미션' },
};

const REASON_LABEL = {
  attend: '출석체크', proof: '인증글', hello: '가입 인사', comment: '댓글',
  result: '성과 인증샷', review: '후기 승인', mission: '챌린지 미션',
  unlock: '자료 열기', buy: '포인트 구매', admin: '운영자 지급',
};

/** 보상 지급. 이미 받은 보상이면 0을 돌려준다. */
async function award(userId, reason, { refId = null, memo = null, amount = null } = {}) {
  const rule = RULES[reason];
  const amt = amount != null ? amount : rule ? rule.amount : 0;
  if (!amt) return 0;

  if (rule && rule.dailyMax) {
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM lounge_points
        WHERE user_id=$1 AND reason=$2 AND day=(now() AT TIME ZONE 'Asia/Seoul')::date`,
      [userId, reason]
    );
    if (rows[0].n >= rule.dailyMax) return 0;
  }

  try {
    await db.query(
      `INSERT INTO lounge_points (user_id, amount, reason, ref_id, memo) VALUES ($1,$2,$3,$4,$5)`,
      [userId, amt, reason, refId, memo]
    );
    return amt;
  } catch (e) {
    if (e.code === '23505') return 0; // 이미 받음
    throw e;
  }
}

/** 포인트 사용. 잔액이 모자라면 false */
async function spend(userId, amount, reason, refId, memo) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    // 같은 사람이 동시에 두 번 누르는 경우를 막는다
    await client.query('SELECT pg_advisory_xact_lock($1)', [userId]);
    const { rows } = await client.query(
      `SELECT COALESCE(sum(amount),0)::int AS bal FROM lounge_points WHERE user_id=$1`,
      [userId]
    );
    if (rows[0].bal < amount) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query(
      `INSERT INTO lounge_points (user_id, amount, reason, ref_id, memo) VALUES ($1,$2,$3,$4,$5)`,
      [userId, -amount, reason, refId, memo]
    );
    await client.query('COMMIT');
    return true;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e.code === '23505') return false;
    throw e;
  } finally {
    client.release();
  }
}

/* ---------------- 등급 ---------------- */
// 이름은 '바이라인(기사 끝 기자 이름)'에서 따왔다
const TIERS = [
  { key: 'sprout', name: '새싹', icon: '🌱', min: 0 },
  { key: 'writer', name: '기자', icon: '✏️', min: 500 },
  { key: 'editor', name: '에디터', icon: '📰', min: 2000 },
  { key: 'byline', name: '바이라이너', icon: '🏅', min: 5000 },
];

function tierOf(earned) {
  let t = TIERS[0];
  for (const x of TIERS) if (earned >= x.min) t = x;
  const idx = TIERS.indexOf(t);
  const next = TIERS[idx + 1] || null;
  return {
    ...t,
    next,
    toNext: next ? next.min - earned : 0,
    pct: next ? Math.min(100, Math.round(((earned - t.min) / (next.min - t.min)) * 100)) : 100,
  };
}

/** 한 사람의 포인트 요약 */
async function summary(userId) {
  const { rows } = await db.query(
    `SELECT COALESCE(sum(amount),0)::int AS balance,
            COALESCE(sum(amount) FILTER (WHERE amount > 0),0)::int AS earned,
            bool_or(reason='attend' AND day=(now() AT TIME ZONE 'Asia/Seoul')::date) AS attended_today,
            bool_or(reason='proof'  AND day=(now() AT TIME ZONE 'Asia/Seoul')::date) AS proofed_today,
            count(*) FILTER (WHERE reason='mission')::int AS missions,
            count(DISTINCT day) FILTER (WHERE reason='attend')::int AS attend_days
       FROM lounge_points WHERE user_id=$1`,
    [userId]
  );
  const s = rows[0];
  s.attended_today = !!s.attended_today;
  s.proofed_today = !!s.proofed_today;
  s.streak = await streak(userId);
  s.tier = tierOf(s.earned);
  return s;
}

/** 연속 출석 일수 (오늘 안 했으면 어제까지 기준) */
async function streak(userId) {
  const { rows } = await db.query(
    `SELECT day FROM lounge_points WHERE user_id=$1 AND reason='attend'
      ORDER BY day DESC LIMIT 400`,
    [userId]
  );
  if (!rows.length) return 0;
  const today = kstToday();
  const toKey = (d) => (d instanceof Date ? ymd(d) : String(d).slice(0, 10));
  const days = new Set(rows.map((r) => toKey(r.day)));
  let cur = new Date(today + 'T00:00:00Z');
  if (!days.has(ymd(cur))) cur.setUTCDate(cur.getUTCDate() - 1);
  let n = 0;
  while (days.has(ymd(cur))) {
    n++;
    cur.setUTCDate(cur.getUTCDate() - 1);
  }
  return n;
}

function ymd(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function kstToday() {
  return ymd(new Date(Date.now() + 9 * 3600 * 1000));
}

/* ---------------- 랭킹 ---------------- */
async function rankings() {
  const q = (sql) => db.query(sql).then((r) => r.rows).catch(() => []);
  const nameCol = `COALESCE(u.nickname, u.name)`;
  const [today, month, attend] = await Promise.all([
    q(`SELECT ${nameCol} AS nick, sum(p.amount)::int AS n,
              (SELECT COALESCE(sum(amount) FILTER (WHERE amount>0),0) FROM lounge_points x WHERE x.user_id=u.id)::int AS earned
         FROM lounge_points p JOIN users u ON u.id=p.user_id
        WHERE p.amount > 0 AND p.reason <> 'admin' AND p.day=(now() AT TIME ZONE 'Asia/Seoul')::date
        GROUP BY u.id ORDER BY n DESC, min(p.created_at) LIMIT 5`),
    q(`SELECT ${nameCol} AS nick, sum(p.amount)::int AS n,
              (SELECT COALESCE(sum(amount) FILTER (WHERE amount>0),0) FROM lounge_points x WHERE x.user_id=u.id)::int AS earned
         FROM lounge_points p JOIN users u ON u.id=p.user_id
        WHERE p.amount > 0 AND p.reason <> 'admin'
          AND date_trunc('month', p.day) = date_trunc('month', (now() AT TIME ZONE 'Asia/Seoul')::date)
        GROUP BY u.id ORDER BY n DESC, min(p.created_at) LIMIT 5`),
    q(`SELECT ${nameCol} AS nick, count(*)::int AS n,
              (SELECT COALESCE(sum(amount) FILTER (WHERE amount>0),0) FROM lounge_points x WHERE x.user_id=u.id)::int AS earned
         FROM lounge_points p JOIN users u ON u.id=p.user_id
        WHERE p.reason='attend'
          AND date_trunc('month', p.day) = date_trunc('month', (now() AT TIME ZONE 'Asia/Seoul')::date)
        GROUP BY u.id ORDER BY n DESC, min(p.created_at) LIMIT 5`),
  ]);
  const deco = (arr) => arr.map((r) => ({ ...r, tier: tierOf(r.earned) }));
  return { today: deco(today), month: deco(month), attend: deco(attend) };
}

/* ---------------- 설정 ---------------- */
const SETTING_DEFAULTS = {
  consult_url: 'http://pf.kakao.com/_TCcBX',   // 1:1 상담 (카카오 채널)
  live_room_url: '',                            // 전체 카톡방 (오픈채팅)
  live_room_code: '',                           // 오픈채팅 참여코드
  hero_title: '혼자 하면 멈추고,\n같이 하면 쌓입니다',
  hero_sub: 'AI로 블로그·스레드·부업을 시작한 사람들이\n매일 한 줄씩 기록하며 같이 크는 곳',
  review_link: '',                              // 외부 후기 모음 (카페 등)
  welcome_note: '가입하면 무료 자료가 보관함에 바로 들어가요',
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

/* ---------------- 사진 ---------------- */
const IMG_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
/** 브라우저에서 줄여 보낸 data URL 을 저장하고 id 를 돌려준다 */
async function saveImage(userId, dataUrl) {
  const m = IMG_RE.exec(String(dataUrl || ''));
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 1.6 * 1024 * 1024) return null;
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

const INTERESTS = ['블로그 부업', '스레드·SNS', 'AI 활용', '사주·콘텐츠', '1인 창업', '가게 홍보', '기타'];

const CATEGORIES = {
  notice: { label: '공지', write: 'admin' },
  hello:  { label: '가입인사', write: 'all' },
  proof:  { label: '오늘의 인증', write: 'all' },
  free:   { label: '자유', write: 'all' },
  qna:    { label: '질문', write: 'all' },
  secret: { label: '1:1 문의', write: 'all' },
};

const RESULT_KINDS = {
  income:   { label: '수익', icon: '💰' },
  inquiry:  { label: '문의', icon: '📩' },
  follower: { label: '팔로워', icon: '📈' },
  view:     { label: '조회수', icon: '👀' },
};

module.exports = {
  migrate, RULES, REASON_LABEL, award, spend, TIERS, tierOf, summary, streak, rankings,
  settings, saveSettings, SETTING_DEFAULTS, esc, linkify, ago, safeUrl, saveImage,
  checkNick, INTERESTS, CATEGORIES, RESULT_KINDS, kstToday,
};
