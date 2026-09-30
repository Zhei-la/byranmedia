/* 운영자: 회원 관리 — 이 사람이 수강생인지, 전자책 구매자인지, 그냥 가입자인지 한눈에 */
const bcrypt = require('bcryptjs');
const db = require('../db');
const E = require('./enroll');

// 회원 구분 (위에서부터 먼저 맞는 것)
// 가입하면 모두 '일반'. 수강생은 운영자가 직접 표시하거나 수강권(피드백 과정)을 주면 자동으로.
const KINDS = {
  student:   { label: '🎓 수강생', cls: 'k-stu' },
  member:    { label: '일반', cls: 'k-mem' },
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
    SELECT user_id, max(COALESCE(last_at, created_at)) AS at, count(DISTINCT day)::int AS vdays, COALESCE(sum(visits),0)::int AS vcount
      FROM lounge_visits WHERE user_id IS NOT NULL GROUP BY user_id
  ), m AS (
    SELECT u.id, u.name, u.nickname, u.email, u.phone, u.provider, u.role, u.status, u.interest,
           u.memo, u.admin_tags, u.country, u.created_at, u.chat_ban_until, u.write_ban_until, u.ban_note,
           (u.chat_ban_until > now()) AS chat_banned, (u.write_ban_until > now()) AS write_banned, u.lounge_at, u.last_login_at, u.referred_by, u.is_student,
           COALESCE(en.ebook, false) AS has_ebook, COALESCE(en.stu, false) AS has_course,
           GREATEST(u.last_seen_at, u.last_login_at, lv.at) AS seen_at, COALESCE(lv.vdays, 0) AS vdays, COALESCE(lv.vcount, 0) AS vcount,
           en.courses, COALESCE(en.n, 0) AS enroll_n,
           CASE WHEN u.role='admin' THEN 'admin'
                WHEN u.status='suspended' THEN 'suspended'
                WHEN u.is_student OR en.stu THEN 'student'
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

/** 제재: kind 'chat' | 'write', days 0 = 풀기, 36500 = 영구 */
async function ban(id, kind, days, note) {
  const col = kind === 'write' ? 'write_ban_until' : 'chat_ban_until';
  await db.query(
    `UPDATE users SET ${col} = CASE WHEN $2::int > 0 THEN now() + ($2::int || ' days')::interval ELSE NULL END,
            ban_note = COALESCE(NULLIF($3, ''), ban_note) WHERE id=$1`,
    [id, days, String(note || '').trim().slice(0, 300)]
  );
}
/** 강퇴(이용 정지) / 풀기 — 풀면 이전 상태로 */
async function kick(id, on, note) {
  if (on) {
    await db.query(
      `UPDATE users SET prev_status = CASE WHEN status <> 'suspended' THEN status ELSE prev_status END, status='suspended',
              ban_note = COALESCE(NULLIF($2, ''), ban_note) WHERE id=$1 AND role <> 'admin'`,
      [id, String(note || '').trim().slice(0, 300)]
    );
  } else {
    await db.query(`UPDATE users SET status = COALESCE(prev_status, 'pending'), prev_status = NULL WHERE id=$1 AND status='suspended'`, [id]);
  }
}

async function setStudent(id, on) {
  await db.query(`UPDATE users SET is_student=$1 WHERE id=$2`, [!!on, id]);
}
async function setAdmin(id, on) {
  await db.query(on ? `UPDATE users SET role='admin', status='active' WHERE id=$1` : `UPDATE users SET role='member' WHERE id=$1`, [id]);
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
  const L = require('./core');
  const head = ['번호', '닉네임', '카카오 이름', '나라', '구분', '수강 중', '이메일', '전화', '가입일', '최근 방문', '관심', '글', '포인트', '태그', '메모'];
  const lines = [head.join(',')].concat(rows.map((r) => [
    r.id, r.nickname, r.name, (L.COUNTRY[r.country] || {}).ko || '', (KINDS[r.kind] || {}).label, r.courses, r.email, r.phone,
    kst(r.created_at), kst(r.seen_at), r.interest, r.posts, r.points, r.admin_tags, r.memo,
  ].map(csvCell).join(',')));
  return '﻿' + lines.join('\r\n');
}

/** 운영자가 이메일 계정을 직접 만든다 (카카오 없이 이메일+비밀번호로 로그인). 실패하면 이유 문장을 throw */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NICK_RE = /^[\p{L}\p{M}\p{N}_ ]{2,10}$/u;
async function create({ email, password, nickname, kind, memo }) {
  email = String(email || '').trim().toLowerCase();
  password = String(password || '');
  nickname = String(nickname || '').trim();
  if (!EMAIL_RE.test(email) || email.length > 255) throw new Error('이메일 주소를 확인해 주세요.');
  if (password.length < 8) throw new Error('비밀번호는 8자 이상으로 정해 주세요.');
  if (nickname && !NICK_RE.test(nickname)) throw new Error('닉네임은 한글·영문·숫자 2~10자로 적어 주세요.');
  const { rows: dup } = await db.query(`SELECT id FROM users WHERE email=$1`, [email]);
  if (dup.length) throw new Error('이미 이 이메일로 가입된 회원이 있어요.');
  if (nickname) {
    const { rows: dn } = await db.query(`SELECT 1 FROM users WHERE lower(nickname)=lower($1)`, [nickname]);
    if (dn.length) throw new Error('이미 쓰는 닉네임이에요.');
  }
  const hash = await bcrypt.hash(password, 12);
  const { rows } = await db.query(
    `INSERT INTO users (email, password_hash, name, nickname, provider, role, status, is_student, memo, country)
     VALUES ($1,$2,$3,$4,'local',$5,'active',$6,$7,$8) RETURNING id`,
    [email, hash, (nickname || email.split('@')[0]).slice(0, 100), nickname || null,
     'admin', false, String(memo || '').trim().slice(0, 3000) || null, nickname ? 'KR' : null]
  );
  return rows[0].id;
}
/** 비밀번호 새로 정하기 (이메일 로그인용) */
async function setPassword(id, password) {
  password = String(password || '');
  if (password.length < 8) throw new Error('비밀번호는 8자 이상으로 정해 주세요.');
  await db.query(`UPDATE users SET password_hash=$1 WHERE id=$2`, [await bcrypt.hash(password, 12), id]);
}

module.exports = { create, setPassword, KINDS, PRESET_TAGS, list, counts, detail, save, setStudent, setAdmin, ban, kick, csv };
