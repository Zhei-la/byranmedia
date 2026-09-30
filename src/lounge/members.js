/* 운영자: 회원 관리 — 이 사람이 수강생인지, 전자책 구매자인지, 그냥 가입자인지 한눈에 */
const db = require('../db');
const E = require('./enroll');

// 회원 구분 (위에서부터 먼저 맞는 것)
const KINDS = {
  student:   { label: '🎓 수강생', cls: 'k-stu' },
  ebook:     { label: '📖 전자책', cls: 'k-ebook' },
  ended:     { label: '수강 종료', cls: 'k-ended' },
  member:    { label: '일반 회원', cls: 'k-mem' },
  noprofile: { label: '프로필 전', cls: 'k-none' },
  admin:     { label: '👑 운영자', cls: 'k-admin' },
  suspended: { label: '⛔ 이용 중지', cls: 'k-stop' },
};
const PRESET_TAGS = ['상담 중', '입금 대기', '수강 문의', 'VIP', '재구매', '환불 문의', '주의'];

const BASE = `
  WITH en AS (
    SELECT e.user_id,
           bool_or(${E.ACTIVE} AND COALESCE(p.ptype,'course')='course') AS stu,
           bool_or(${E.ACTIVE} AND p.ptype='ebook') AS ebook,
           string_agg(CASE WHEN ${E.ACTIVE} THEN e.product_title END, ', ') AS courses,
           count(*)::int AS n
      FROM lounge_enrollments e LEFT JOIN lounge_products p ON p.id=e.product_id
     WHERE e.status <> 'refunded'
     GROUP BY e.user_id
  ), lv AS (
    SELECT user_id, max(day) AS day FROM lounge_visits WHERE user_id IS NOT NULL GROUP BY user_id
  ), m AS (
    SELECT u.id, u.name, u.nickname, u.email, u.phone, u.provider, u.role, u.status, u.interest,
           u.memo, u.admin_tags, u.created_at, u.lounge_at, u.last_login_at, u.referred_by,
           GREATEST(u.last_login_at, lv.day::timestamptz) AS seen_at,
           en.courses, COALESCE(en.n, 0) AS enroll_n,
           CASE WHEN u.role='admin' THEN 'admin'
                WHEN u.status='suspended' THEN 'suspended'
                WHEN en.stu THEN 'student'
                WHEN en.ebook THEN 'ebook'
                WHEN en.n > 0 THEN 'ended'
                WHEN u.nickname IS NULL THEN 'noprofile'
                ELSE 'member' END AS kind,
           (SELECT count(*) FROM lounge_posts p WHERE p.user_id=u.id AND p.is_hidden=false)::int AS posts,
           (SELECT COALESCE(sum(amount),0) FROM lounge_point_log g WHERE g.user_id=u.id)::int AS points
      FROM users u LEFT JOIN en ON en.user_id=u.id LEFT JOIN lv ON lv.user_id=u.id
  )`;

function where(kind, s, params) {
  const w = [];
  if (kind && KINDS[kind]) { params.push(kind); w.push(`kind=$${params.length}`); }
  if (s) {
    params.push(`%${s}%`);
    const i = params.length;
    w.push(`(nickname ILIKE $${i} OR name ILIKE $${i} OR email ILIKE $${i} OR phone ILIKE $${i} OR memo ILIKE $${i} OR admin_tags ILIKE $${i} OR courses ILIKE $${i})`);
  }
  return w.length ? 'WHERE ' + w.join(' AND ') : '';
}

async function list({ kind, s, limit = 300 }) {
  const params = [];
  const w = where(kind, s, params);
  params.push(limit);
  const { rows } = await db.query(`${BASE} SELECT * FROM m ${w} ORDER BY created_at DESC LIMIT $${params.length}`, params);
  return rows;
}

async function counts() {
  const { rows } = await db.query(`${BASE} SELECT kind, count(*)::int AS n FROM m GROUP BY kind`);
  const out = { all: 0 };
  rows.forEach((r) => { out[r.kind] = r.n; out.all += r.n; });
  return out;
}

async function one(id) {
  const { rows } = await db.query(`${BASE} SELECT * FROM m WHERE id=$1`, [id]);
  return rows[0] || null;
}

/** 상세 화면에 필요한 것 전부 */
async function detail(id) {
  const m = await one(id);
  if (!m) return null;
  const q = (sql, p) => db.query(sql, p).then((r) => r.rows);
  const [enrolls, points, posts, opened, reviews, inquiries, referrer] = await Promise.all([
    E.list(id),
    q(`SELECT amount, reason, note, created_at FROM lounge_point_log WHERE user_id=$1 ORDER BY id DESC LIMIT 12`, [id]),
    q(`SELECT id, category, title, created_at, is_hidden FROM lounge_posts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10`, [id]),
    q(`SELECT r.id, r.title, x.created_at FROM lounge_unlocks x JOIN lounge_resources r ON r.id=x.resource_id WHERE x.user_id=$1 ORDER BY x.created_at DESC LIMIT 20`, [id]).catch(() => []),
    q(`SELECT id, rating, left(body, 80) AS body, status, created_at FROM lounge_reviews WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5`, [id]),
    q(`SELECT id, plan, left(message, 200) AS message, status, created_at FROM inquiries
        WHERE message LIKE $1 OR ($2::text IS NOT NULL AND phone=$2) ORDER BY created_at DESC LIMIT 10`,
      [`%라운지 회원 #${id}%`, m.phone || null]),
    m.referred_by ? q(`SELECT id, COALESCE(nickname, name) AS nick FROM users WHERE id=$1`, [m.referred_by]).then((r) => r[0] || null) : null,
  ]);
  return { m, enrolls, points, posts, opened, reviews, inquiries, referrer };
}

async function save(id, { memo, phone, tags }) {
  const clean = Array.from(new Set(
    [].concat(tags || []).join(',').split(',').map((t) => t.trim().slice(0, 20)).filter(Boolean)
  )).slice(0, 8).join(',');
  await db.query(`UPDATE users SET memo=$1, phone=$2, admin_tags=$3 WHERE id=$4`, [
    String(memo || '').trim().slice(0, 3000) || null,
    String(phone || '').trim().slice(0, 30) || null,
    clean || null,
    id,
  ]);
}

const csvCell = (v) => {
  const s = v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
async function csv({ kind, s }) {
  const rows = await list({ kind, s, limit: 5000 });
  const kst = (d) => (d ? new Date(d).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }) : '');
  const head = ['번호', '닉네임', '카카오 이름', '구분', '수강 중', '이메일', '전화', '가입일', '최근 방문', '관심', '글', '포인트', '태그', '메모'];
  const lines = [head.join(',')].concat(rows.map((r) => [
    r.id, r.nickname, r.name, (KINDS[r.kind] || {}).label, r.courses, r.email, r.phone,
    kst(r.created_at), kst(r.seen_at), r.interest, r.posts, r.points, r.admin_tags, r.memo,
  ].map(csvCell).join(',')));
  return '﻿' + lines.join('\r\n');
}

module.exports = { KINDS, PRESET_TAGS, list, counts, detail, save, csv };
