/* 바이란 라운지 수강권
 * - 카드 결제: 결제 확인(웹훅) 코드에서 paid() 를 부르면 바로 수강권이 생긴다
 * - 현금 결제 등: 운영자가 관리 화면 [수강생] 탭에서 grant() 로 직접 지급
 * "수강 중" = status 가 active 이고, 끝나는 날이 없거나(평생) 아직 안 지났을 때
 */
const db = require('../db');

const TODAY = `((now() AT TIME ZONE 'Asia/Seoul')::date)`;
const ACTIVE = `e.status='active' AND (e.ends_on IS NULL OR e.ends_on >= ${TODAY})`;
const SOURCES = { card: '카드 결제', cash: '현금 결제', admin: '운영자 지급' };
const STATUSES = { active: '수강 중', ended: '종료', refunded: '환불' };

/** "이름 | 주소" 줄들을 [{label, url}] 로 */
function parseLinks(text) {
  return String(text || '').split('\n').map((line) => {
    const i = line.indexOf('|');
    const label = (i >= 0 ? line.slice(0, i) : '바로가기').trim();
    const url = (i >= 0 ? line.slice(i + 1) : line).trim();
    return /^https?:\/\//i.test(url) || /^\/[^/\\]/.test(url) ? { label: label || '바로가기', url } : null;
  }).filter(Boolean);
}

/** 회원의 수강권 목록 (수강 중인 것 먼저) */
async function list(uid) {
  const { rows } = await db.query(
    `SELECT e.*, e.starts_on::text AS starts_s, e.ends_on::text AS ends_s, (${ACTIVE}) AS is_active, (e.ends_on - ${TODAY})::int AS days_left,
            p.student_links, p.student_note, p.kind
       FROM lounge_enrollments e LEFT JOIN lounge_products p ON p.id=e.product_id
      WHERE e.user_id=$1 ORDER BY (${ACTIVE}) DESC, e.created_at DESC`,
    [uid]
  );
  return rows.map((r) => ({ ...r, links: parseLinks(r.student_links) }));
}

/** 수강 중인 과정 번호들 */
async function activeProductIds(uid) {
  const { rows } = await db.query(`SELECT DISTINCT e.product_id FROM lounge_enrollments e WHERE e.user_id=$1 AND ${ACTIVE}`, [uid]);
  return rows.map((r) => r.product_id).filter(Boolean);
}

async function isStudent(uid) {
  const { rows } = await db.query(`SELECT 1 FROM lounge_enrollments e WHERE e.user_id=$1 AND ${ACTIVE} LIMIT 1`, [uid]);
  return rows.length > 0;
}

/**
 * 수강권 지급
 * opts: { userId, productId, source, amount, orderId, startsOn('YYYY-MM-DD'), endsOn('YYYY-MM-DD' | '' = 평생 | undefined = 과정 기간대로), memo, grantedBy }
 * 같은 order_id 로 이미 지급됐으면 그걸 돌려준다 (결제 웹훅이 두 번 와도 한 번만)
 */
async function grant(o) {
  if (o.orderId) {
    const ex = await db.query(`SELECT * FROM lounge_enrollments WHERE order_id=$1`, [o.orderId]);
    if (ex.rows[0]) return { enrollment: ex.rows[0], created: false };
  }
  const { rows: pr } = await db.query(`SELECT id, title, months FROM lounge_products WHERE id=$1`, [o.productId]);
  const p = pr[0];
  if (!p) throw new Error('과정을 찾지 못했어요.');
  const starts = /^\d{4}-\d{2}-\d{2}$/.test(o.startsOn || '') ? o.startsOn : null;
  let ends = null;
  let endsExpr = 'NULL';
  const params = [o.userId, p.id, p.title, SOURCES[o.source] ? o.source : 'admin', o.amount || null, o.orderId || null, o.memo || null, o.grantedBy || null, starts];
  if (o.endsOn === undefined) {
    // 과정에 정한 기간대로 (시작일 + N개월 - 1일)
    if (p.months) { params.push(p.months); endsExpr = `(COALESCE($9::date, ${TODAY}) + make_interval(months => $10::int) - interval '1 day')::date`; }
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(o.endsOn)) {
    ends = o.endsOn; params.push(ends); endsExpr = '$10::date';
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO lounge_enrollments (user_id, product_id, product_title, source, amount, order_id, memo, granted_by, starts_on, ends_on)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9::date, ${TODAY}), ${endsExpr}) RETURNING *`,
      params
    );
    return { enrollment: rows[0], created: true };
  } catch (e) {
    if (e.code === '23505' && o.orderId) {
      const ex = await db.query(`SELECT * FROM lounge_enrollments WHERE order_id=$1`, [o.orderId]);
      return { enrollment: ex.rows[0], created: false };
    }
    throw e;
  }
}

/**
 * 카드 결제가 확인됐을 때 부르는 곳 (결제 시스템을 붙이면 결제 승인/웹훅 코드에서 호출)
 * 예: await enroll.paid({ userId, productId, orderId: payment.orderId, amount: payment.totalAmount })
 */
function paid({ userId, productId, orderId, amount }) {
  return grant({ userId, productId, orderId, amount, source: 'card', memo: '카드 결제 자동 지급' });
}

async function update(id, f) {
  await db.query(
    `UPDATE lounge_enrollments SET status=$1, starts_on=COALESCE($2::date, starts_on), ends_on=$3::date, memo=$4 WHERE id=$5`,
    [STATUSES[f.status] ? f.status : 'active', f.startsOn || null, f.endsOn || null, f.memo || null, id]
  );
}

async function remove(id) {
  await db.query(`DELETE FROM lounge_enrollments WHERE id=$1`, [id]);
}

module.exports = { ACTIVE, TODAY, SOURCES, STATUSES, parseLinks, list, activeProductIds, isStudent, grant, paid, update, remove };
