/* 방문자 세기
 * - 브라우저마다 쿠키(bv)로 이름표를 붙이고 하루에 한 줄 + IP 를 같이 남긴다
 * - 운영자 통계: IP 하나당 1명 / 홈에 보이는 '오늘 방문': 본 화면 수를 모두 더한 값(중복 포함)
 * - 화면(HTML)을 연 것만 센다. 사진·CSS·채팅 새로고침·봇·운영자는 빼고
 * - 날짜는 한국 시간 기준
 */
const crypto = require('crypto');
const db = require('../db');

const DAY = `(now() AT TIME ZONE 'Asia/Seoul')::date`;
const SKIP_PATH = /^\/(admin|u\/|chat\/|api\/|auth\/|healthz|favicon|manifest|robots|sitemap)|\.[a-z0-9]{2,5}$/i;
const BOT = /bot|crawl|spider|slurp|preview|scrap|facebookexternalhit|kakaotalk-scrap|daum|yeti|curl|wget|python|go-http|java\/|headless|lighthouse|monitor|uptime|axios|node-fetch/i;
const PROD = process.env.NODE_ENV === 'production';

function readCookie(req, name) {
  const m = String(req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : '';
}

function refHost(req) {
  try {
    const h = new URL(req.get('referer') || '').host.replace(/^www\./, '').replace(/^m\./, '').toLowerCase();
    const own = String(req.get('host') || '').replace(/^www\./, '').toLowerCase();
    return h && h !== own ? h.slice(0, 120) : null;
  } catch (e) {
    return null;
  }
}

function track(req, res, next) {
  if (req.method !== 'GET' || SKIP_PATH.test(req.path)) return next();
  const ua = req.get('user-agent') || '';
  if (!ua || BOT.test(ua)) return next();
  if (req.user && req.user.role === 'admin') return next();

  let vid = readCookie(req, 'bv');
  if (!/^[a-f0-9]{16,40}$/.test(vid)) {
    vid = crypto.randomBytes(12).toString('hex');
    res.cookie('bv', vid, { maxAge: 1000 * 60 * 60 * 24 * 400, httpOnly: true, sameSite: 'lax', secure: PROD });
  }
  const ref = refHost(req);
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    if (!/text\/html/.test(String(res.get('content-type') || ''))) return;
    db.query(
      `INSERT INTO lounge_visits (day, vid, user_id, first_path, ref_host, ip) VALUES (${DAY}, $1, $2, $3, $4, $5)
       ON CONFLICT (day, vid) DO UPDATE SET views = lounge_visits.views + 1,
         user_id = COALESCE(lounge_visits.user_id, EXCLUDED.user_id), ip = COALESCE(lounge_visits.ip, EXCLUDED.ip)`,
      [vid, req.user ? req.user.id : null, req.path.slice(0, 200), ref, String(req.ip || '').slice(0, 64) || null]
    ).catch((e) => console.error('[방문 기록]', e.message));
  });
  next();
}

/** 운영자 화면용 숫자 */
async function stats(days = 14) {
  const q = (sql, p) => db.query(sql, p).then((r) => r.rows);
  const [today] = await q(
    `WITH d AS (SELECT ${DAY} AS t)
     SELECT (SELECT count(DISTINCT COALESCE(ip, vid)) FROM lounge_visits, d WHERE day = d.t)::int AS v,
            (SELECT COALESCE(sum(views),0) FROM lounge_visits, d WHERE day = d.t)::int AS pv,
            (SELECT count(DISTINCT COALESCE(ip, vid)) FROM lounge_visits, d WHERE day = d.t - 1)::int AS v_y,
            (SELECT count(*) FROM users, d WHERE (created_at AT TIME ZONE 'Asia/Seoul')::date = d.t)::int AS j,
            (SELECT count(*) FROM users, d WHERE (created_at AT TIME ZONE 'Asia/Seoul')::date = d.t - 1)::int AS j_y,
            (SELECT count(*) FROM users, d WHERE (lounge_at AT TIME ZONE 'Asia/Seoul')::date = d.t)::int AS p,
            (SELECT count(*) FROM lounge_posts, d WHERE (created_at AT TIME ZONE 'Asia/Seoul')::date = d.t)::int AS posts,
            (SELECT count(*) FROM users)::int AS total_users,
            (SELECT min(day) FROM lounge_visits)::text AS since`
  );
  const daily = await q(
    `WITH d AS (SELECT generate_series(${DAY} - ($1::int - 1), ${DAY}, interval '1 day')::date AS day)
     SELECT d.day::text AS day, to_char(d.day, 'MM.DD') AS label, extract(isodow FROM d.day)::int AS dow,
            (SELECT count(DISTINCT COALESCE(ip, vid)) FROM lounge_visits v WHERE v.day = d.day)::int AS v,
            (SELECT COALESCE(sum(views),0) FROM lounge_visits v WHERE v.day = d.day)::int AS pv,
            (SELECT count(*) FROM users u WHERE (u.created_at AT TIME ZONE 'Asia/Seoul')::date = d.day)::int AS j,
            (SELECT count(*) FROM users u WHERE (u.lounge_at AT TIME ZONE 'Asia/Seoul')::date = d.day)::int AS p
       FROM d ORDER BY d.day DESC`,
    [days]
  );
  const refs = await q(
    `SELECT COALESCE(ref_host, '직접 들어옴 · 즐겨찾기') AS host, count(DISTINCT COALESCE(ip, vid))::int AS n
       FROM lounge_visits WHERE day >= ${DAY} - 6 GROUP BY 1 ORDER BY n DESC LIMIT 10`
  );
  const pages = await q(
    `SELECT first_path AS path, count(DISTINCT COALESCE(ip, vid))::int AS n
       FROM lounge_visits WHERE day >= ${DAY} - 6 GROUP BY 1 ORDER BY n DESC LIMIT 8`
  );
  const joins = await q(
    `SELECT id, COALESCE(nickname, name, '(이름 없음)') AS nick, nickname IS NOT NULL AS done,
            to_char(created_at AT TIME ZONE 'Asia/Seoul', 'MM.DD HH24:MI') AS at
       FROM users ORDER BY created_at DESC LIMIT 10`
  );
  return { today, daily, refs, pages, joins };
}

/** 머리 부분에 늘 보이는 오늘 숫자 */
async function todayBrief() {
  const { rows } = await db.query(
    `SELECT (SELECT count(DISTINCT COALESCE(ip, vid)) FROM lounge_visits WHERE day = ${DAY})::int AS v,
            (SELECT count(*) FROM users WHERE (created_at AT TIME ZONE 'Asia/Seoul')::date = ${DAY})::int AS j`
  );
  return rows[0];
}

/** 홈에 보여줄 오늘 방문 수 — 본 화면 수를 모두 더한 값 (중복 포함). 1분 동안 저장해 두고 씀 */
let pubCache = { at: 0, n: 0 };
async function publicToday() {
  if (Date.now() - pubCache.at < 60000) return pubCache.n;
  const { rows } = await db.query(`SELECT COALESCE(sum(views),0)::int AS n FROM lounge_visits WHERE day = ${DAY}`);
  pubCache = { at: Date.now(), n: rows[0].n };
  return pubCache.n;
}

module.exports = { track, stats, todayBrief, publicToday };
