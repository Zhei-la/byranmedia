require('dotenv').config();

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./db');

async function main() {
  console.log('1. 테이블을 만듭니다...');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  await db.query(sql);
  console.log('   완료');

  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  const name = process.env.ADMIN_NAME || '관리자';

  if (!email || password.length < 8) {
    console.log('\n[건너뜀] 관리자 계정을 만들려면 ADMIN_EMAIL 과 8자 이상의 ADMIN_PASSWORD 를 설정하세요.');
  } else {
    const { rows } = await db.query(`SELECT id FROM users WHERE email = $1`, [email]);
    const hash = await bcrypt.hash(password, 12);
    if (rows.length) {
      await db.query(
        `UPDATE users SET password_hash=$1, role='admin', status='active', expires_at=NULL WHERE id=$2`,
        [hash, rows[0].id]
      );
      console.log(`2. 관리자 계정을 갱신했습니다: ${email}`);
    } else {
      await db.query(
        `INSERT INTO users (email,password_hash,name,role,status) VALUES ($1,$2,$3,'admin','active')`,
        [email, hash, name]
      );
      console.log(`2. 관리자 계정을 만들었습니다: ${email}`);
    }
  }

  console.log('3. 기본 도구를 등록합니다...');
  const tools = [
    ['blog-prompt-builder', '원고 프롬프트 빌더', '고객사 정보를 채우면 업종 법규까지 반영된 GPT 프롬프트가 만들어집니다.', '블로그 대행', '📝', 10],
    ['saju', '루월당 사주', '사주 리포트 발행 플랫폼으로 이동합니다.', '사주', '🔮', 20],
  ];
  for (const [slug, title, description, category, emoji, sort_order] of tools) {
    await db.query(
      `INSERT INTO tools (slug,title,description,category,emoji,sort_order)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (slug) DO NOTHING`,
      [slug, title, description, category, emoji, sort_order]
    );
  }
  console.log('   완료');

  console.log('\n준비가 끝났습니다. 사이트에 접속해 로그인해 보세요.');
  process.exit(0);
}

main().catch((e) => {
  console.error('설정 중 문제가 생겼습니다:', e.message);
  process.exit(1);
});
