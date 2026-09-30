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

/* ---------- 들어온 플랫폼 ---------- */
const SOURCES = {
  threads: '🧵 스레드', instagram: '📸 인스타그램', facebook: '📘 페이스북', kakaotalk: '💬 카카오톡',
  naver: '🟢 네이버', google: '🔎 구글', youtube: '▶️ 유튜브', daum: '🔵 다음', x: '✖️ X(트위터)',
  tiktok: '🎵 틱톡', band: '🟩 밴드', line: '🟢 라인', direct: '🔗 직접 들어옴 · 즐겨찾기', other: '🌐 기타 사이트',
};
const SRC_WORDS = [
  ['threads', /threads/], ['instagram', /insta|ig\b/], ['facebook', /facebook|\bfb\b/], ['kakaotalk', /kakao|카톡/],
  ['naver', /naver|블로그|blog/], ['google', /google/], ['youtube', /youtube|yt\b/], ['daum', /daum/],
  ['x', /twitter|^x$/], ['tiktok', /tiktok/], ['band', /band/], ['line', /^line/],
];
function sourceOf(req, host) {
  // 1) 링크에 붙인 표시 (?from=threads, ?utm_source=instagram)
  const tag = String((req.query && (req.query.from || req.query.utm_source || req.query.ref)) || '').toLowerCase().slice(0, 30);
  if (tag) { const hit = SRC_WORDS.find((w) => w[1].test(tag)); return hit ? hit[0] : 'other'; }
  // 2) 앱 안 브라우저 (주소를 안 넘겨 줘도 앱 이름은 알 수 있음)
  const ua = req.get('user-agent') || '';
  if (/Barcelona|Threads/i.test(ua)) return 'threads';
  if (/Instagram/i.test(ua)) return 'instagram';
  if (/FBAN|FBAV|FB_IAB|FBIOS/i.test(ua)) return 'facebook';
  if (/KAKAOTALK/i.test(ua)) return 'kakaotalk';
  if (/NAVER\(inapp|NAVER\//i.test(ua)) return 'naver';
  if (/DaumApps/i.test(ua)) return 'daum';
  if (/\bBAND\//i.test(ua)) return 'band';
  if (/\bLine\//i.test(ua)) return 'line';
  if (/musical_ly|TikTok|BytedanceWebview/i.test(ua)) return 'tiktok';
  // 3) 들어오기 전 주소
  const h = host || '';
  if (!h) return 'direct';
  if (/threads\.(net|com)$/.test(h)) return 'threads';
  if (/instagram\.com$/.test(h)) return 'instagram';
  if (/(facebook\.com|fb\.me)$/.test(h)) return 'facebook';
  if (/kakao/.test(h)) return 'kakaotalk';
  if (/naver\./.test(h)) return 'naver';
  if (/(^|\.)google\./.test(h)) return 'google';
  if (/(youtube\.com|youtu\.be)$/.test(h)) return 'youtube';
  if (/daum\.net$/.test(h)) return 'daum';
  if (/(^|\.)(t\.co|x\.com|twitter\.com)$/.test(h)) return 'x';
  if (/tiktok\.com$/.test(h)) return 'tiktok';
  if (/band\.us$/.test(h)) return 'band';
  return 'other';
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
  const src = sourceOf(req, ref);
  // 처음 들어온 곳을 30일 기억 → 가입할 때 '가입 경로'로 남김
  if (src !== 'direct' && !readCookie(req, 'bsrc')) {
    res.cookie('bsrc', src, { maxAge: 1000 * 60 * 60 * 24 * 30, httpOnly: true, sameSite: 'lax', secure: PROD });
  }
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    if (!/text\/html/.test(String(res.get('content-type') || ''))) return;
    db.query(
      `INSERT INTO lounge_visits (day, vid, user_id, first_path, ref_host, ip, last_at, source) VALUES (${DAY}, $1, $2, $3, $4, $5, now(), $6)
       ON CONFLICT (day, vid) DO UPDATE SET views = lounge_visits.views + 1,
         visits = lounge_visits.visits + CASE WHEN lounge_visits.last_at IS NULL OR now() - lounge_visits.last_at > interval '30 minutes' THEN 1 ELSE 0 END,
         last_at = now(),
         user_id = COALESCE(lounge_visits.user_id, EXCLUDED.user_id), ip = COALESCE(lounge_visits.ip, EXCLUDED.ip)`,
      [vid, req.user ? req.user.id : null, req.path.slice(0, 200), ref, clientIp(req), src]
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
      `SELECT count(DISTINCT vid)::int AS people, count(DISTINCT ip)::int AS ips,
              COALESCE(sum(visits),0)::int AS visits, COALESCE(sum(views),0)::int AS views
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
  // 플랫폼별: 방문한 사람(기기) · 방문 횟수 · 그 플랫폼에서 온 가입자
  const uc = range(r, KDATE('created_at'));
  const platforms = await q(
    `WITH v AS (
       SELECT COALESCE(source, 'direct') AS src, count(DISTINCT vid)::int AS people, COALESCE(sum(visits),0)::int AS visits
         FROM lounge_visits WHERE ${rc} GROUP BY 1
     ), j AS (
       SELECT COALESCE(source, 'direct') AS src, count(*)::int AS joins FROM users WHERE role <> 'admin' AND ${uc} GROUP BY 1
     )
     SELECT COALESCE(v.src, j.src) AS src, COALESCE(v.people,0) AS people, COALESCE(v.visits,0) AS visits, COALESCE(j.joins,0) AS joins
       FROM v FULL JOIN j ON j.src = v.src ORDER BY people DESC, joins DESC`
  );
  const refs = await q(
    `SELECT ref_host AS host, count(DISTINCT vid)::int AS n
       FROM lounge_visits WHERE ${rc} AND ref_host IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 10`
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
  return { sum, meta, daily, platforms, refs, pages, joins, countries };
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

/** 날짜별 숫자 (from~to, 'YYYY-MM-DD') — 사람(기기)·방문 횟수·화면·가입 */
async function byDay(from, to) {
  const { rows } = await db.query(
    `WITH d AS (SELECT generate_series($1::date, $2::date, interval '1 day')::date AS day),
          v AS (SELECT day, count(DISTINCT vid)::int AS people, COALESCE(sum(visits),0)::int AS visits, COALESCE(sum(views),0)::int AS views
                  FROM lounge_visits WHERE day BETWEEN $1::date AND $2::date GROUP BY day),
          j AS (SELECT ${KDATE('created_at')} AS day, count(*)::int AS joins FROM users
                 WHERE role <> 'admin' AND ${KDATE('created_at')} BETWEEN $1::date AND $2::date GROUP BY 1)
     SELECT d.day::text AS day, extract(isodow FROM d.day)::int AS dow, extract(day FROM d.day)::int AS dnum,
            COALESCE(v.people,0) AS people, COALESCE(v.visits,0) AS visits, COALESCE(v.views,0) AS views, COALESCE(j.joins,0) AS joins,
            d.day = ${DAY} AS today, d.day > ${DAY} AS future
       FROM d LEFT JOIN v ON v.day = d.day LEFT JOIN j ON j.day = d.day ORDER BY d.day`,
    [from, to]
  );
  return rows;
}
/** 기간 합계 (사람은 기간 안에서 기기 1대당 1명) */
async function periodTotal(from, to) {
  const { rows } = await db.query(
    `SELECT count(DISTINCT vid)::int AS people, COALESCE(sum(visits),0)::int AS visits, COALESCE(sum(views),0)::int AS views,
            (SELECT count(*) FROM users WHERE role <> 'admin' AND ${KDATE('created_at')} BETWEEN $1::date AND $2::date)::int AS joins
       FROM lounge_visits WHERE day BETWEEN $1::date AND $2::date`,
    [from, to]
  );
  return rows[0];
}
/** 하루 자세히: 플랫폼 · 처음 들어온 화면 */
async function dayDetail(day) {
  const q = (sql) => db.query(sql, [day]).then((x) => x.rows);
  const [platforms, pages, joins] = await Promise.all([
    q(`SELECT COALESCE(source,'direct') AS src, count(DISTINCT vid)::int AS people, COALESCE(sum(visits),0)::int AS visits
         FROM lounge_visits WHERE day=$1::date GROUP BY 1 ORDER BY people DESC`),
    q(`SELECT first_path AS path, count(DISTINCT vid)::int AS n FROM lounge_visits WHERE day=$1::date GROUP BY 1 ORDER BY n DESC LIMIT 8`),
    q(`SELECT id, COALESCE(nickname, name) AS nick, source, to_char(created_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI') AS at
         FROM users WHERE role <> 'admin' AND ${KDATE('created_at')} = $1::date ORDER BY created_at`),
  ]);
  return { platforms, pages, joins };
}
async function todayStr() {
  const { rows } = await db.query(`SELECT ${DAY}::text AS d`);
  return rows[0].d;
}

/** 이 기기의 이름표 (방문 쿠키). 없으면 null */
function deviceId(req) {
  const v = readCookie(req, 'bv');
  return /^[a-f0-9]{16,40}$/.test(v) ? v : null;
}

module.exports = { track, stats, byDay, periodTotal, dayDetail, todayStr, todayBrief, publicToday, deviceId, SOURCES, readCookie };
