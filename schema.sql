-- 바이란미디어 허브 스키마
-- Railway PostgreSQL 에 그대로 실행하면 됩니다.

-- 세션 저장 테이블 (connect-pg-simple 규격)
CREATE TABLE IF NOT EXISTS session (
  sid    varchar NOT NULL COLLATE "default",
  sess   json NOT NULL,
  expire timestamp(6) NOT NULL,
  CONSTRAINT session_pkey PRIMARY KEY (sid)
);
CREATE INDEX IF NOT EXISTS idx_session_expire ON session (expire);

-- 회원
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(100) NOT NULL,
  phone         VARCHAR(30),
  course        VARCHAR(100),                       -- 수강 과정명
  role          VARCHAR(20)  NOT NULL DEFAULT 'member',  -- member | admin
  status        VARCHAR(20)  NOT NULL DEFAULT 'pending', -- pending | active | suspended
  expires_at    DATE,                               -- 수강 만료일 (NULL = 무기한)
  memo          TEXT,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_status ON users (status);

-- 도구 목록
CREATE TABLE IF NOT EXISTS tools (
  id          SERIAL PRIMARY KEY,
  slug        VARCHAR(80) UNIQUE NOT NULL,   -- protected/tools/{slug}/index.html
  title       VARCHAR(120) NOT NULL,
  description TEXT,
  category    VARCHAR(60)  NOT NULL DEFAULT '기타',
  emoji       VARCHAR(10)  NOT NULL DEFAULT '🧰',
  sort_order  INT          NOT NULL DEFAULT 100,
  is_active   BOOLEAN      NOT NULL DEFAULT true,
  admin_only  BOOLEAN      NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- 사용 기록
CREATE TABLE IF NOT EXISTS access_logs (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INT REFERENCES users(id) ON DELETE CASCADE,
  tool_slug  VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_logs_user ON access_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_tool ON access_logs (tool_slug, created_at DESC);

-- 로그인 시도 (무차별 대입 차단용)
CREATE TABLE IF NOT EXISTS login_attempts (
  id         BIGSERIAL PRIMARY KEY,
  email      VARCHAR(255),
  ip         VARCHAR(64),
  ok         BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attempts ON login_attempts (email, created_at DESC);

-- 공지사항
CREATE TABLE IF NOT EXISTS notices (
  id         SERIAL PRIMARY KEY,
  title      VARCHAR(200) NOT NULL,
  body       TEXT,
  is_pinned  BOOLEAN NOT NULL DEFAULT false,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notices ON notices (is_active, is_pinned DESC, created_at DESC);

-- 공지를 외부에도 노출할지
ALTER TABLE notices ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;

-- 문의 접수함
CREATE TABLE IF NOT EXISTS inquiries (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  phone      VARCHAR(40),
  email      VARCHAR(255),
  business   VARCHAR(200),
  plan       VARCHAR(60),
  message    TEXT,
  status     VARCHAR(20) NOT NULL DEFAULT 'new',  -- new | contacted | done | spam
  memo       TEXT,
  ip         VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inq ON inquiries (status, created_at DESC);

-- 카카오 로그인 지원
-- 카카오로 가입한 사람은 비밀번호가 없고, 이메일 제공에 동의하지 않을 수도 있다.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS kakao_id  VARCHAR(64) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS provider  VARCHAR(20) NOT NULL DEFAULT 'local';
CREATE INDEX IF NOT EXISTS idx_users_kakao ON users (kakao_id);
