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
ALTER TABLE lounge_resources ADD COLUMN IF NOT EXISTS access  VARCHAR(10) NOT NULL DEFAULT 'member'; -- member | code | points (cost 포인트로 열기)
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

-- 포인트: 글·후기로 모으고, 자료집을 열 때 쓴다 (쌓인 기록의 합이 잔액)
CREATE TABLE IF NOT EXISTS lounge_point_log (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount     INT NOT NULL,                 -- 적립은 +, 사용·회수는 -
  reason     VARCHAR(20) NOT NULL,         -- post | post_back | review | review_back | buy | admin
  ref_id     INT,                          -- 글·후기·자료 번호
  note       VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_point_user ON lounge_point_log (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_point_ref ON lounge_point_log (reason, ref_id)
  WHERE ref_id IS NOT NULL AND reason IN ('post', 'post_back', 'review', 'review_back');
CREATE UNIQUE INDEX IF NOT EXISTS uq_point_buy ON lounge_point_log (user_id, ref_id) WHERE reason = 'buy';

-- 수강권: 결제(카드 자동) 또는 운영자 지급(현금 등)으로 생기고, 마이페이지에 "수강 중"으로 보인다
ALTER TABLE lounge_products ADD COLUMN IF NOT EXISTS months INT;           -- 수강 기간(개월). 비우면 평생
ALTER TABLE lounge_products ADD COLUMN IF NOT EXISTS student_links TEXT;   -- 수강생에게 보여줄 링크: "이름 | 주소" 한 줄에 하나
ALTER TABLE lounge_products ADD COLUMN IF NOT EXISTS student_note TEXT;    -- 수강생 안내 문구

CREATE TABLE IF NOT EXISTS lounge_enrollments (
  id            SERIAL PRIMARY KEY,
  user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id    INT REFERENCES lounge_products(id) ON DELETE SET NULL,
  product_title VARCHAR(120) NOT NULL,              -- 과정이 지워져도 이름은 남긴다
  source        VARCHAR(10) NOT NULL DEFAULT 'admin', -- card | cash | admin
  amount        INT,
  order_id      VARCHAR(80),                         -- 카드 결제 주문번호 (같은 결제로 두 번 지급 안 되게)
  status        VARCHAR(10) NOT NULL DEFAULT 'active', -- active | ended | refunded
  starts_on     DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Seoul')::date),
  ends_on       DATE,                                -- 비우면 평생
  memo          VARCHAR(300),
  granted_by    INT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_enroll_user ON lounge_enrollments (user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_enroll_order ON lounge_enrollments (order_id) WHERE order_id IS NOT NULL;

-- 수강생 전용 자료: access='course' 이고, product_ids 에 든 과정 수강생만 (비우면 수강생 누구나)
ALTER TABLE lounge_resources ADD COLUMN IF NOT EXISTS product_ids INT[] NOT NULL DEFAULT '{}';

-- 상품 종류: course(강의·1:1 과정) | ebook(전자책)
ALTER TABLE lounge_products ADD COLUMN IF NOT EXISTS ptype VARCHAR(10) NOT NULL DEFAULT 'course';

-- 판매량에 따라 오르는 가격 (전자책): 시작가에서 every 명 팔릴 때마다 step 원씩, 최대 max 원까지
ALTER TABLE lounge_products ADD COLUMN IF NOT EXISTS dyn_start INT;
ALTER TABLE lounge_products ADD COLUMN IF NOT EXISTS dyn_step  INT;
ALTER TABLE lounge_products ADD COLUMN IF NOT EXISTS dyn_every INT;
ALTER TABLE lounge_products ADD COLUMN IF NOT EXISTS dyn_max   INT;

-- 방문 기록: 하루에 브라우저(쿠키) 하나당 한 줄. views 는 그날 본 화면 수
CREATE TABLE IF NOT EXISTS lounge_visits (
  day        DATE        NOT NULL,
  vid        VARCHAR(40) NOT NULL,
  user_id    INT,
  views      INT         NOT NULL DEFAULT 1,
  first_path VARCHAR(200),
  ref_host   VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (day, vid)
);
CREATE INDEX IF NOT EXISTS idx_visits_day ON lounge_visits (day);

-- 프롬프트 요청 글에 운영자가 올린 프롬프트를 연결
ALTER TABLE lounge_posts ADD COLUMN IF NOT EXISTS prompt_id INT REFERENCES lounge_prompts(id) ON DELETE SET NULL;

-- 로그인 없이 남긴 프롬프트 요청: 이름(선택)과 도배 방지용 IP
ALTER TABLE lounge_posts ADD COLUMN IF NOT EXISTS guest_name VARCHAR(20);
ALTER TABLE lounge_posts ADD COLUMN IF NOT EXISTS guest_ip   VARCHAR(64);

-- 운영자가 직접 '수강생'으로 표시 (결제·등록 확인용)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_student BOOLEAN NOT NULL DEFAULT false;
-- 방문자 IP (운영자 통계는 IP당 1명)
ALTER TABLE lounge_visits ADD COLUMN IF NOT EXISTS ip VARCHAR(64);

-- 운영자가 붙이는 회원 태그 (쉼표로 구분: 상담 중, 입금 대기 …) — 메모는 users.memo
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_tags VARCHAR(200);

-- 회원이 공유한 프롬프트 (user_id 가 있으면 회원 공유, 없으면 바이란 공식)
ALTER TABLE lounge_prompts ADD COLUMN IF NOT EXISTS user_id  INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE lounge_prompts ADD COLUMN IF NOT EXISTS status   VARCHAR(12) NOT NULL DEFAULT 'live'; -- live | fix(운영자 수정 요청)
ALTER TABLE lounge_prompts ADD COLUMN IF NOT EXISTS fix_note VARCHAR(500);
ALTER TABLE lounge_prompts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_prompts_user ON lounge_prompts (user_id, created_at DESC);

-- 방문 '횟수': 같은 사람이 30분 넘게 쉬었다가 다시 오면 1번 더 (views 는 본 화면 수)
ALTER TABLE lounge_visits ADD COLUMN IF NOT EXISTS visits  INT NOT NULL DEFAULT 1;
ALTER TABLE lounge_visits ADD COLUMN IF NOT EXISTS last_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_visits_ip ON lounge_visits (day, ip);

-- 회원 국가 (ISO 두 글자, ZZ = 기타)
ALTER TABLE users ADD COLUMN IF NOT EXISTS country VARCHAR(2);

-- 프로필 사진
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_id INT;

-- 프롬프트 하트 (회원은 회원 1명당, 비회원은 기기 1대당 1번)
CREATE TABLE IF NOT EXISTS lounge_prompt_hearts (
  prompt_id  INT NOT NULL REFERENCES lounge_prompts(id) ON DELETE CASCADE,
  who        VARCHAR(60) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (prompt_id, who)
);
-- 프롬프트를 복사해 간 기기 (기기 1대당 1번만 셈)
CREATE TABLE IF NOT EXISTS lounge_prompt_copies (
  prompt_id  INT NOT NULL REFERENCES lounge_prompts(id) ON DELETE CASCADE,
  who        VARCHAR(60) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (prompt_id, who)
);
-- 정렬용 숫자 (하트·복사해 간 기기·즐겨찾기)
ALTER TABLE lounge_prompts ADD COLUMN IF NOT EXISTS hearts  INT NOT NULL DEFAULT 0;
ALTER TABLE lounge_prompts ADD COLUMN IF NOT EXISTS copiers INT NOT NULL DEFAULT 0;
ALTER TABLE lounge_prompts ADD COLUMN IF NOT EXISTS favs    INT NOT NULL DEFAULT 0;
UPDATE lounge_prompts p SET favs = (SELECT count(*) FROM lounge_prompt_likes k WHERE k.prompt_id = p.id)
 WHERE favs <> (SELECT count(*) FROM lounge_prompt_likes k WHERE k.prompt_id = p.id);

-- 어느 플랫폼에서 들어왔나 (스레드·인스타·카톡… 앱 안 브라우저 표시 + 들어온 주소 + ?from= 링크)
ALTER TABLE lounge_visits ADD COLUMN IF NOT EXISTS source VARCHAR(20);
UPDATE lounge_visits SET source = CASE
    WHEN ref_host ~ 'threads\.(net|com)$' THEN 'threads'
    WHEN ref_host ~ 'instagram\.com$' THEN 'instagram'
    WHEN ref_host ~ '(facebook\.com|fb\.me)$' THEN 'facebook'
    WHEN ref_host ~ 'kakao' THEN 'kakaotalk'
    WHEN ref_host ~ 'naver\.' THEN 'naver'
    WHEN ref_host ~ '^google\.|\.google\.' THEN 'google'
    WHEN ref_host ~ '(youtube\.com|youtu\.be)$' THEN 'youtube'
    WHEN ref_host IS NULL THEN 'direct'
    ELSE 'other' END
 WHERE source IS NULL;
-- 가입한 사람이 처음 어디서 왔는지
ALTER TABLE users ADD COLUMN IF NOT EXISTS source VARCHAR(20);
-- 제재: 채팅 금지 · 글/댓글 금지 · 이용 정지(강퇴)
ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_ban_until  TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS write_ban_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_note        VARCHAR(300);
ALTER TABLE users ADD COLUMN IF NOT EXISTS prev_status     VARCHAR(20);

-- 운영자 기기: 운영자로 로그인한 적 있는 기기(방문 쿠키). 관리 통계에서만 빼고, 홈 '오늘 방문'에는 포함
CREATE TABLE IF NOT EXISTS lounge_owner_devices (
  vid        VARCHAR(40) PRIMARY KEY,
  user_id    INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 사람 확인: 화면을 연 뒤 실제로 만지거나(스크롤·터치) 잠시 머문 브라우저만 true (봇·크롤러 걸러내기)
DROP VIEW IF EXISTS lounge_visits_x;
ALTER TABLE lounge_visits ADD COLUMN IF NOT EXISTS human BOOLEAN NOT NULL DEFAULT false;
-- 이 기능 전 기록: 로그인했거나 2화면 이상 본 기기만 사람으로 (쿠키 없는 봇은 늘 1화면)
UPDATE lounge_visits SET human = true WHERE NOT human AND day <= DATE '2026-09-30' AND (user_id IS NOT NULL OR views > 1);
-- 관리 통계용: 사람 확인된 + 운영자 기기를 뺀 방문 기록 (이 파일 맨 아래에 두기)
CREATE VIEW lounge_visits_x AS
  SELECT v.* FROM lounge_visits v WHERE v.human AND NOT EXISTS (SELECT 1 FROM lounge_owner_devices o WHERE o.vid = v.vid);
