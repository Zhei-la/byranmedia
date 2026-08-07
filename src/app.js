require('dotenv').config();

const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const helmet = require('helmet');
const path = require('path');

const db = require('./db');
const { loadUser } = require('./middleware/auth');

const app = express();
const PROD = process.env.NODE_ENV === 'production';

if (!process.env.SESSION_SECRET) {
  console.error('[치명] SESSION_SECRET 환경변수가 없습니다.');
  process.exit(1);
}

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(
  helmet({
    contentSecurityPolicy: false, // 도구 HTML이 인라인 스타일/스크립트를 쓰므로 끔
    crossOriginEmbedderPolicy: false,
  })
);
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: PROD ? '7d' : 0 }));

app.use(
  session({
    store: new pgSession({ pool: db.pool, tableName: 'session', createTableIfMissing: true }),
    name: 'zhlab.sid',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: PROD,
      maxAge: 1000 * 60 * 60 * 24 * 14, // 2주
    },
  })
);

app.use(loadUser);
app.use((req, res, next) => {
  res.locals.siteName = process.env.SITE_NAME || '바이란미디어';
  res.locals.title = '';
  next();
});

/* 라우트 */
app.use(require('./routes/auth'));
app.use(require('./routes/hub'));
app.use(require('./routes/admin'));

app.get('/', async (req, res) => {
  if (req.user) return res.redirect('/hub');
  let tools = [];
  try {
    const { rows } = await db.query(
      `SELECT title, emoji, category FROM tools
        WHERE is_active = true AND admin_only = false
        ORDER BY sort_order, title LIMIT 12`
    );
    tools = rows;
  } catch (e) {
    /* 도구를 못 불러와도 로그인 화면은 떠야 한다 */
  }
  res.render('landing', { title: '', tools });
});

app.get('/health', (req, res) => res.json({ ok: true }));

/* 404 */
app.use((req, res) => {
  res.status(404).render('error', {
    title: '없는 페이지',
    message: '주소를 다시 확인해 주세요.',
  });
});

/* 오류 */
app.use((err, req, res, next) => {
  console.error('[오류]', err);
  res.status(500).render('error', {
    title: '문제가 생겼습니다',
    message: PROD ? '잠시 후 다시 시도해 주세요.' : err.message,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`바이란미디어 허브가 ${PORT} 포트에서 실행 중입니다.`);
});
