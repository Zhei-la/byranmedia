const db = require('./db');

// 0/O, 1/I/L 처럼 헷갈리는 글자는 뺀다. 전화로 불러주기 쉽도록.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function makeCode(len = 6) {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

/** 컬럼이 아직 없는 데이터베이스인지 */
const MISSING_COLUMN = '42703';
let warned = false;
function warnOnce() {
  if (warned) return;
  warned = true;
  console.warn('[추천] referral 컬럼이 없습니다. npm run setup 을 한 번 실행해 주세요.');
}

/** 아직 코드가 없는 사람에게 코드를 만들어 준다. 이미 있으면 그대로 돌려준다.
 *  컬럼이 없는 데이터베이스에서는 null 을 돌려주고 로그인은 그대로 진행시킨다. */
async function ensureCode(userId) {
  try {
    const { rows } = await db.query(`SELECT referral_code FROM users WHERE id = $1`, [userId]);
    if (!rows.length) return null;
    if (rows[0].referral_code) return rows[0].referral_code;

    for (let i = 0; i < 8; i++) {
      const code = makeCode();
      try {
        const r = await db.query(
          `UPDATE users SET referral_code = $1 WHERE id = $2 AND referral_code IS NULL
           RETURNING referral_code`,
          [code, userId]
        );
        if (r.rows.length) return r.rows[0].referral_code;
        const again = await db.query(`SELECT referral_code FROM users WHERE id = $1`, [userId]);
        if (again.rows[0] && again.rows[0].referral_code) return again.rows[0].referral_code;
      } catch (e) {
        if (e.code === MISSING_COLUMN) { warnOnce(); return null; }
        if (e.code !== '23505') throw e; // 중복이면 다시 뽑는다
      }
    }
    return null;
  } catch (e) {
    if (e.code === MISSING_COLUMN) { warnOnce(); return null; }
    throw e;
  }
}

/** 코드로 추천인을 찾는다. 없으면 null. */
async function findByCode(code) {
  const c = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.length < 4 || c.length > 12) return null;
  try {
    const { rows } = await db.query(
      `SELECT id, name FROM users WHERE referral_code = $1`,
      [c]
    );
    return rows[0] || null;
  } catch (e) {
    if (e.code === MISSING_COLUMN) { warnOnce(); return null; }
    throw e;
  }
}

module.exports = { ensureCode, findByCode, makeCode };
