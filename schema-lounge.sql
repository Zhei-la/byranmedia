-- 바이란 라운지 (커뮤니티) 스키마
-- 서버가 켜질 때마다 자동으로 실행된다. 여러 번 실행해도 안전하다.

-- 라운지에서 쓰는 이름과 관심 분야
ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname  VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS interest  VARCHAR(40);
ALTER TABLE users ADD COLUMN IF NOT EXISTS lounge_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_nickname ON users (lower(nickname)) WHERE nickname IS NOT NULL;

-- 운영 설정 (카톡 링크, 문구 등)
CREATE TABLE IF NOT EXISTS lounge_settings (
  key   VARCHAR(60) PRIMARY KEY,
  value TEXT
);

-- 올린 사진 (Railway 에는 파일을 저장할 디스크가 없어서 DB 에 넣는다)
CREATE TABLE IF NOT EXISTS lounge_images (
  id         SERIAL PRIMARY KEY,
  user_id    INT REFERENCES users(id) ON DELETE CASCADE,
  mime       VARCHAR(30) NOT NULL,
  data       BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 게시판
CREATE TABLE IF NOT EXISTS lounge_posts (
  id         SERIAL PRIMARY KEY,
  user_id    INT REFERENCES users(id) ON DELETE CASCADE,
  category   VARCHAR(12) NOT NULL DEFAULT 'free',  -- notice | hello | proof | free | qna | secret
  title      VARCHAR(120) NOT NULL,
  body       TEXT,
  image_id   INT REFERENCES lounge_images(id) ON DELETE SET NULL,
  is_pinned  BOOLEAN NOT NULL DEFAULT false,
  is_hidden  BOOLEAN NOT NULL DEFAULT false,
  views      INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_posts_list ON lounge_posts (is_hidden, is_pinned DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_cat  ON lounge_posts (category, created_at DESC);

CREATE TABLE IF NOT EXISTS lounge_comments (
  id         SERIAL PRIMARY KEY,
  post_id    INT NOT NULL REFERENCES lounge_posts(id) ON DELETE CASCADE,
  user_id    INT REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  is_hidden  BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON lounge_comments (post_id, created_at);

CREATE TABLE IF NOT EXISTS lounge_likes (
  post_id    INT NOT NULL REFERENCES lounge_posts(id) ON DELETE CASCADE,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS lounge_reports (
  id          SERIAL PRIMARY KEY,
  target_type VARCHAR(12) NOT NULL,  -- post | comment | chat | result
  target_id   INT NOT NULL,
  user_id     INT REFERENCES users(id) ON DELETE SET NULL,
  reason      VARCHAR(40),
  resolved    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 실시간 채팅
CREATE TABLE IF NOT EXISTS lounge_chat (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INT REFERENCES users(id) ON DELETE CASCADE,
  body       VARCHAR(300) NOT NULL,
  is_hidden  BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat ON lounge_chat (id DESC);

-- 성과 인증샷
CREATE TABLE IF NOT EXISTS lounge_results (
  id         SERIAL PRIMARY KEY,
  user_id    INT REFERENCES users(id) ON DELETE CASCADE,
  image_id   INT REFERENCES lounge_images(id) ON DELETE SET NULL,
  kind       VARCHAR(12) NOT NULL DEFAULT 'income',  -- income | inquiry | follower | view
  headline   VARCHAR(24) NOT NULL,
  channel    VARCHAR(20),
  is_hidden  BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 자료실
CREATE TABLE IF NOT EXISTS lounge_resources (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(120) NOT NULL,
  description VARCHAR(300),
  kind        VARCHAR(12) NOT NULL DEFAULT 'pdf',   -- pdf | video | link | text
  url         TEXT,
  body        TEXT,
  cost        INT NOT NULL DEFAULT 0,
  is_welcome  BOOLEAN NOT NULL DEFAULT false,
  sort_order  INT NOT NULL DEFAULT 100,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lounge_unlocks (
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource_id INT NOT NULL REFERENCES lounge_resources(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, resource_id)
);

-- 스토어 상품 (결제는 외부 링크로 넘긴다)
CREATE TABLE IF NOT EXISTS lounge_products (
  id           SERIAL PRIMARY KEY,
  title        VARCHAR(120) NOT NULL,
  subtitle     VARCHAR(200),
  kind         VARCHAR(40),          -- 예: 전자책 · 혼자 공부
  badge        VARCHAR(12),          -- 예: BEST
  price_text   VARCHAR(40),          -- 예: 99,000원 / 문의
  point_price  INT,                  -- 포인트로도 살 수 있으면
  resource_id  INT REFERENCES lounge_resources(id) ON DELETE SET NULL,
  buy_url      TEXT,
  cta_label    VARCHAR(20),
  is_challenge BOOLEAN NOT NULL DEFAULT false,
  sort_order   INT NOT NULL DEFAULT 100,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 후기
CREATE TABLE IF NOT EXISTS lounge_reviews (
  id          SERIAL PRIMARY KEY,
  user_id     INT REFERENCES users(id) ON DELETE SET NULL,
  author_name VARCHAR(40),
  product_id  INT REFERENCES lounge_products(id) ON DELETE SET NULL,
  rating      INT NOT NULL DEFAULT 5,
  industry    VARCHAR(40),
  body        TEXT NOT NULL,
  image_id    INT REFERENCES lounge_images(id) ON DELETE SET NULL,
  status      VARCHAR(12) NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_reviews ON lounge_reviews (status, created_at DESC);

-- 기수제 챌린지
CREATE TABLE IF NOT EXISTS lounge_cohorts (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(20) NOT NULL,          -- 예: 1기
  title      VARCHAR(120) NOT NULL,
  intro      TEXT,
  start_date DATE NOT NULL,
  days       INT NOT NULL DEFAULT 14,
  kakao_url  TEXT,
  status     VARCHAR(12) NOT NULL DEFAULT 'recruiting', -- recruiting | running | ended
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lounge_cohort_members (
  cohort_id  INT NOT NULL REFERENCES lounge_cohorts(id) ON DELETE CASCADE,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     VARCHAR(12) NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  order_no   VARCHAR(60),
  contact    VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cohort_id, user_id)
);

CREATE TABLE IF NOT EXISTS lounge_missions (
  id        SERIAL PRIMARY KEY,
  cohort_id INT NOT NULL REFERENCES lounge_cohorts(id) ON DELETE CASCADE,
  day       INT NOT NULL,
  title     VARCHAR(120) NOT NULL,
  body      TEXT,
  UNIQUE (cohort_id, day)
);

CREATE TABLE IF NOT EXISTS lounge_submissions (
  id         SERIAL PRIMARY KEY,
  cohort_id  INT NOT NULL REFERENCES lounge_cohorts(id) ON DELETE CASCADE,
  mission_id INT NOT NULL REFERENCES lounge_missions(id) ON DELETE CASCADE,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT,
  link       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mission_id, user_id)
);

-- 자료실 칸 나누기 + 라이브 코드로 여는 자료
ALTER TABLE lounge_resources ADD COLUMN IF NOT EXISTS section VARCHAR(30) NOT NULL DEFAULT '무료 자료';
ALTER TABLE lounge_resources ADD COLUMN IF NOT EXISTS access  VARCHAR(10) NOT NULL DEFAULT 'member'; -- member | code
ALTER TABLE lounge_resources ADD COLUMN IF NOT EXISTS lock_note VARCHAR(120);

-- 프롬프트 갤러리
CREATE TABLE IF NOT EXISTS lounge_prompts (
  id         SERIAL PRIMARY KEY,
  title      VARCHAR(120) NOT NULL,
  category   VARCHAR(30) NOT NULL DEFAULT '인물/화보',
  prompt     TEXT NOT NULL,
  negative   TEXT,
  model      VARCHAR(40),
  note       VARCHAR(300),
  image_ids  INT[] NOT NULL DEFAULT '{}',
  views      INT NOT NULL DEFAULT 0,
  copies     INT NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prompts ON lounge_prompts (is_active, created_at DESC);

CREATE TABLE IF NOT EXISTS lounge_prompt_likes (
  prompt_id  INT NOT NULL REFERENCES lounge_prompts(id) ON DELETE CASCADE,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (prompt_id, user_id)
);

-- 수강 과정: 정가·할인 안내·포함 내용
ALTER TABLE lounge_products ADD COLUMN IF NOT EXISTS list_price VARCHAR(40);   -- 정가 (줄 그어 보여줌)
ALTER TABLE lounge_products ADD COLUMN IF NOT EXISTS price_note VARCHAR(120);  -- 예: 해당 월 5명 한정
ALTER TABLE lounge_products ADD COLUMN IF NOT EXISTS perks TEXT;               -- 포함 내용 (한 줄에 하나)
