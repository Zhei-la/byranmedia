const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('[치명] DATABASE_URL 환경변수가 없습니다. Railway 변수 설정을 확인하세요.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('[DB 풀 오류]', err.message);
});

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
};
