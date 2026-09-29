/* 바이란 라운지 포인트
 * - 글 쓰면 +10P (하루 5개까지), 후기 쓰면 +50P (하루 1개까지) — 관리자 설정에서 바꿀 수 있다
 * - 모은 포인트로 자료집을 연다. 쓰고 나면 다시 모으면 된다.
 * - 글을 지우거나 숨기면, 후기가 반려되거나 지워지면 받은 포인트를 회수한다.
 * 잔액은 lounge_point_log 의 합이다.
 */
const db = require('../db');
const L = require('./core');

// 한국 시간 오늘 0시
const KST_DAY = `(date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')`;
const LOCK = 7701; // 회원별로 포인트 계산이 겹치지 않게 잠그는 번호

const num = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : d;
};

async function rules() {
  const S = await L.settings();
  return {
    post: num(S.pt_post, 10),
    postDaily: num(S.pt_post_daily, 5),
    review: num(S.pt_review, 50),
    reviewDaily: num(S.pt_review_daily, 1),
    postMin: 20, // 이 글자 수보다 짧은 글은 포인트 없음 (도배 방지)
  };
}

/** 한 회원을 잠그고 fn(client) 를 한 트랜잭션으로 */
async function withUser(uid, fn) {
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock($1, $2)', [LOCK, uid]);
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

async function balance(uid, c = db) {
  const { rows } = await c.query(`SELECT COALESCE(sum(amount), 0)::int AS n FROM lounge_point_log WHERE user_id=$1`, [uid]);
  return rows[0].n;
}

/** 오늘 포인트 받은 글·후기 수 */
async function today(uid) {
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE reason='post')::int AS posts,
            count(*) FILTER (WHERE reason='review')::int AS reviews
       FROM lounge_point_log WHERE user_id=$1 AND created_at >= ${KST_DAY}`,
    [uid]
  );
  return rows[0];
}

/** 화면에 보여줄 요약: 잔액, 오늘 받은 수, 규칙 */
async function summary(uid) {
  const [bal, t, r] = await Promise.all([balance(uid), today(uid), rules()]);
  return { balance: bal, today: t, rules: r };
}

/**
 * 글·후기 적립. 하루 한도를 넘었으면 0 을 돌려준다.
 * kind: 'post' | 'review'
 */
async function earn(uid, kind, refId) {
  const r = await rules();
  const amount = kind === 'review' ? r.review : r.post;
  const cap = kind === 'review' ? r.reviewDaily : r.postDaily;
  if (!amount || !cap) return 0;
  return withUser(uid, async (c) => {
    const { rows } = await c.query(
      `SELECT count(*)::int AS n FROM lounge_point_log WHERE user_id=$1 AND reason=$2 AND created_at >= ${KST_DAY}`,
      [uid, kind]
    );
    if (rows[0].n >= cap) return 0;
    const ins = await c.query(
      `INSERT INTO lounge_point_log (user_id, amount, reason, ref_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [uid, amount, kind, refId]
    );
    return ins.rowCount ? amount : 0;
  });
}

/** 글·후기가 내려가면 받은 포인트를 회수 (한 번만) */
async function revoke(kind, refId) {
  const { rows } = await db.query(`SELECT user_id, amount FROM lounge_point_log WHERE reason=$1 AND ref_id=$2`, [kind, refId]);
  if (!rows[0]) return 0;
  const r = await db.query(
    `INSERT INTO lounge_point_log (user_id, amount, reason, ref_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    [rows[0].user_id, -rows[0].amount, kind + '_back', refId]
  );
  return r.rowCount ? rows[0].amount : 0;
}

/** 다시 보이게 되면 회수한 포인트를 돌려준다 */
async function restore(kind, refId) {
  await db.query(`DELETE FROM lounge_point_log WHERE reason=$1 AND ref_id=$2`, [kind + '_back', refId]);
}

/**
 * 포인트로 자료 열기.
 * 돌려주는 값: { ok: true, left } | { ok: false, why: 'owned' | 'short', need }
 */
async function buy(uid, resource) {
  const cost = Math.max(0, resource.cost || 0);
  return withUser(uid, async (c) => {
    const own = await c.query(`SELECT 1 FROM lounge_unlocks WHERE user_id=$1 AND resource_id=$2`, [uid, resource.id]);
    if (own.rows.length) return { ok: false, why: 'owned' };
    const bal = await balance(uid, c);
    if (bal < cost) return { ok: false, why: 'short', need: cost - bal };
    if (cost) {
      await c.query(
        `INSERT INTO lounge_point_log (user_id, amount, reason, ref_id, note) VALUES ($1,$2,'buy',$3,$4)`,
        [uid, -cost, resource.id, String(resource.title || '').slice(0, 120)]
      );
    }
    await c.query(`INSERT INTO lounge_unlocks (user_id, resource_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [uid, resource.id]);
    return { ok: true, left: bal - cost };
  });
}

/** 운영자가 직접 더하거나 빼기 */
async function adjust(uid, amount, note) {
  await db.query(
    `INSERT INTO lounge_point_log (user_id, amount, reason, note) VALUES ($1,$2,'admin',$3)`,
    [uid, amount, String(note || '운영자 조정').slice(0, 120)]
  );
}

const LABEL = {
  post: '글 작성', post_back: '글 삭제로 회수', review: '후기 작성', review_back: '후기 반려·삭제로 회수',
  buy: '자료 열기', admin: '운영자',
};

async function history(uid, limit = 15) {
  const { rows } = await db.query(
    `SELECT amount, reason, ref_id, note, created_at FROM lounge_point_log WHERE user_id=$1 ORDER BY id DESC LIMIT $2`,
    [uid, limit]
  );
  return rows.map((h) => ({ ...h, label: h.note && h.reason !== 'post' && h.reason !== 'review' ? `${LABEL[h.reason] || h.reason} · ${h.note}` : LABEL[h.reason] || h.reason }));
}

const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');

module.exports = { rules, balance, today, summary, earn, revoke, restore, buy, adjust, history, fmt };
