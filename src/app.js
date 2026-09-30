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

// 배포할 때마다 값이 달라져서, 브라우저가 예전 CSS를 계속 쓰는 일을 막는다
const ASSET_VER = Date.now().toString(36);

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
// 사진은 브라우저에서 줄여서 글자(data URL)로 보내므로 넉넉하게 받는다
// 대표 주소로 모으기: www → byranmedia.com, (CANONICAL_HOST 를 켜면) 레일웨이 주소 → 대표 주소
app.use((req, res, next) => {
  const host = String(req.get('host') || '').toLowerCase();
  const canon = String(process.env.CANONICAL_HOST || '').toLowerCase().trim();
  if (host === 'www.byranmedia.com') return res.redirect(301, `https://byranmedia.com${req.originalUrl}`);
  if (canon && host.endsWith('.up.railway.app') && req.method === 'GET') return res.redirect(301, `https://${canon}${req.originalUrl}`);
  next();
});
app.use(express.urlencoded({ extended: false, limit: '12mb' }));
app.use(express.json({ limit: '100kb' }));
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
app.use(require('./lounge/visits').track); // 오늘 방문자 세기 (운영자 화면에 표시)
app.use((req, res, next) => {
  res.locals.siteName = process.env.SITE_NAME || '바이란미디어';
  res.locals.title = '';
  res.locals.kakaoOn = kakao.kakaoReady();
  res.locals.assetVer = ASSET_VER;
  res.locals.baseUrl = (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  next();
});

/* 라우트 */
const kakao = require('./routes/kakao');
app.use(kakao);
app.use(require('./lounge/routes'));   // 바이란 라운지 (커뮤니티)
app.use(require('./lounge/admin'));
app.use(require('./routes/public'));
app.use(require('./routes/auth'));
app.use(require('./routes/hub'));
app.use(require('./routes/brief'));
app.use(require('./routes/admin'));

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

// 라운지 테이블은 켜질 때마다 자동으로 맞춘다 (npm run setup 을 따로 안 해도 된다)
require('./lounge/core')
  .migrate()
  .then(() => console.log('[라운지] 테이블 준비 완료'))
  .catch((e) => console.error('[라운지] 테이블 준비 실패:', e.message))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`바이란미디어 허브가 ${PORT} 포트에서 실행 중입니다.`);
    });
  });
