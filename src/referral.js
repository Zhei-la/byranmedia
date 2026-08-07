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

/** 아직 코드가 없는 사람에게 코드를 만들어 준다. 이미 있으면 그대로 돌려준다. */
async function ensureCode(userId) {
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
      // 그사이 다른 요청이 코드를 넣었다면 그걸 쓴다
      const again = await db.query(`SELECT referral_code FROM users WHERE id = $1`, [userId]);
      if (again.rows[0] && again.rows[0].referral_code) return again.rows[0].referral_code;
    } catch (e) {
      if (e.code !== '23505') throw e; // 중복이면 다시 뽑는다
    }
  }
  return null;
}

/** 코드로 추천인을 찾는다. 없으면 null. */
async function findByCode(code) {
  const c = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.length < 4 || c.length > 12) return null;
  const { rows } = await db.query(
    `SELECT id, name FROM users WHERE referral_code = $1`,
    [c]
  );
  return rows[0] || null;
}

module.exports = { ensureCode, findByCode, makeCode };
