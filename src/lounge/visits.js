/* 방문자 세기
 * - 브라우저마다 쿠키(bv)로 이름표를 붙이고 하루에 한 줄 + IP 를 같이 남긴다
 * - 운영자 통계: 기기(브라우저) 하나당 1명 / 홈에 보이는 '오늘 방문': 본 화면 수를 모두 더한 값(중복 포함)
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

/** 방문자 IP: 레일웨이 앞단이 넣어 주는 X-Real-IP → 없으면 X-Forwarded-For 첫 번째 → req.ip */
function clientIp(req) {
  const real = String(req.get('x-real-ip') || '').trim();
  if (real) return real.slice(0, 64);
  const xff = String(req.get('x-forwarded-for') || '').split(',')[0].trim();
  return (xff || String(req.ip || '')).replace(/^::ffff:/, '').slice(0, 64) || null;
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
      `INSERT INTO lounge_visits (day, vid, user_id, first_path, ref_host, ip, last_at) VALUES (${DAY}, $1, $2, $3, $4, $5, now())
       ON CONFLICT (day, vid) DO UPDATE SET views = lounge_visits.views + 1,
         visits = lounge_visits.visits + CASE WHEN lounge_visits.last_at IS NULL OR now() - lounge_visits.last_at > interval '30 minutes' THEN 1 ELSE 0 END,
         last_at = now(),
         user_id = COALESCE(lounge_visits.user_id, EXCLUDED.user_id), ip = COALESCE(lounge_visits.ip, EXCLUDED.ip)`,
      [vid, req.user ? req.user.id : null, req.path.slice(0, 200), ref, clientIp(req)]
    ).catch((e) => console.error('[방문 기록]', e.message));
  });
  next();
}

/** 기간 조건: today(당일) | 7d(최근 7일) | all(전체). prev = 바로 앞 같은 길이 기간 (비교용) */
function range(r, col, prev = false) {
  if (r === 'all') return prev ? null : 'true';
  if (r === '7d') return prev ? `${col} BETWEEN ${DAY} - 13 AND ${DAY} - 7` : `${col} >= ${DAY} - 6`;
  return prev ? `${col} = ${DAY} - 1` : `${col} = ${DAY}`;
}
const KDATE = (c) => `(${c} AT TIME ZONE 'Asia/Seoul')::date`;

/** 요약 숫자 — '방문한 사람'은 기기(브라우저) 하나당 1명 */
async function summary(r) {
  const one = async (cond) => {
    if (!cond) return null;
    const { rows } = await db.query(
      `SELECT count(DISTINCT vid)::int AS people, COALESCE(sum(visits),0)::int AS visits, COALESCE(sum(views),0)::int AS views
         FROM lounge_visits WHERE ${cond}`
    );
    return rows[0];
  };
  const cnt = async (table, col, extra, prev) => {
    const c = range(r, KDATE(col), prev);
    if (!c) return null;
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${c}${extra ? ' AND ' + extra : ''}`);
    return rows[0].n;
  };
  const [cur, prev, joins, joinsPrev, reqs, shares, proofs] = await Promise.all([
    one(range(r, 'day')), one(range(r, 'day', true)),
    cnt('users', 'created_at', "role <> 'admin'"), cnt('users', 'created_at', "role <> 'admin'", true),
    cnt('lounge_posts', 'created_at', "category='request'"),
    cnt('lounge_prompts', 'created_at', 'user_id IS NOT NULL'),
    cnt('lounge_posts', 'created_at', "category='proof'"),
  ]);
  const rate = cur.people ? Math.round((joins / cur.people) * 1000) / 10 : 0;
  return { ...cur, prev, joins, joinsPrev, reqs, shares, proofs, rate };
}

/** 운영자 화면용 숫자 */
async function stats(r = 'today', days = 14) {
  const q = (sql, p) => db.query(sql, p).then((x) => x.rows);
  const sum = await summary(r);
  const [meta] = await q(`SELECT (SELECT count(*) FROM users WHERE role <> 'admin')::int AS total_users, (SELECT min(day) FROM lounge_visits)::text AS since`);
  const daily = await q(
    `WITH d AS (SELECT generate_series(${DAY} - ($1::int - 1), ${DAY}, interval '1 day')::date AS day)
     SELECT d.day::text AS day, to_char(d.day, 'MM.DD') AS label, extract(isodow FROM d.day)::int AS dow,
            (SELECT count(DISTINCT vid) FROM lounge_visits v WHERE v.day = d.day)::int AS v,
            (SELECT COALESCE(sum(visits),0) FROM lounge_visits v WHERE v.day = d.day)::int AS vc,
            (SELECT COALESCE(sum(views),0) FROM lounge_visits v WHERE v.day = d.day)::int AS pv,
            (SELECT count(*) FROM users u WHERE u.role <> 'admin' AND ${KDATE('u.created_at')} = d.day)::int AS j
       FROM d ORDER BY d.day DESC`,
    [days]
  );
  const rc = range(r, 'day');
  const refs = await q(
    `SELECT COALESCE(ref_host, '직접 들어옴 · 즐겨찾기') AS host, count(DISTINCT vid)::int AS n
       FROM lounge_visits WHERE ${rc} GROUP BY 1 ORDER BY n DESC LIMIT 10`
  );
  const pages = await q(
    `SELECT first_path AS path, count(DISTINCT vid)::int AS n
       FROM lounge_visits WHERE ${rc} GROUP BY 1 ORDER BY n DESC LIMIT 8`
  );
  const joins = await q(
    `SELECT id, COALESCE(nickname, name, '(이름 없음)') AS nick, nickname IS NOT NULL AS done,
            to_char(created_at AT TIME ZONE 'Asia/Seoul', 'MM.DD HH24:MI') AS at
       FROM users WHERE role <> 'admin' ORDER BY created_at DESC LIMIT 10`
  );
  const countries = await q(
    `SELECT COALESCE(country, '') AS code, count(*)::int AS n FROM users WHERE role <> 'admin' GROUP BY 1 ORDER BY n DESC LIMIT 15`
  );
  return { sum, meta, daily, refs, pages, joins, countries };
}

/** 머리 부분에 늘 보이는 오늘 숫자 */
async function todayBrief() {
  const { rows } = await db.query(
    `SELECT (SELECT count(DISTINCT vid) FROM lounge_visits WHERE day = ${DAY})::int AS v,
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
