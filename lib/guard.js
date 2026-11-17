'use strict';
/**
 * Abuse protection.
 *
 * Layer 1 (memory, per server instance, zero cost): request-rate limits per IP and route group.
 *   Every "unusual" request (over the rate limit, unknown API route, malformed or oversized body,
 *   wrong method, cross-site POST) is a strike. 5 strikes within 10 minutes blocks that IP for
 *   15 minutes. The block is also written to the database so other instances honour it.
 *
 * Layer 2 (database, shared by all instances): failure counters with cooling periods, used for
 *   logins (5 wrong passwords => 15 min cooldown), coupons, admin key, password resets, signups.
 *
 * Layer 3 (platform): Vercel's built-in DDoS mitigation and Firewall (see the production guide).
 */
const db = require('./db');
const { json } = require('./util');

const LIMITS = { // [requests, per seconds]
  public: [240, 60],
  api: [300, 60],
  auth: [30, 60],
  verify: [20, 60],
  send: [240, 60], // per IP; each user's own gap is enforced separately in the database
  billing: [40, 60],
  admin: [150, 60],
};
const STRIKES_TO_BLOCK = 5;
const STRIKE_WINDOW_MS = 10 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 50000;

const windows = new Map(); // `${bucket}|${ip}` -> { start, count }
const strikes = new Map(); // ip -> { first, count }
const blocked = new Map(); // ip -> until (ms)

function blockedFor(ip) {
  const until = blocked.get(ip);
  if (!until) return 0;
  if (until <= Date.now()) { blocked.delete(ip); return 0; }
  return Math.ceil((until - Date.now()) / 1000);
}

function block(ip, ms = BLOCK_MS, reason = '') {
  blocked.set(ip, Date.now() + ms);
  strikes.delete(ip);
  console.warn(`[guard] blocked ${maskIp(ip)} for ${Math.round(ms / 60000)} min${reason ? ` (${reason})` : ''}`);
  // Share the block with other instances (best effort; never fails the request).
  db.query(
    `INSERT INTO throttle (key, hits, window_start, blocked_until, updated_at)
     VALUES ($1, 0, now(), now() + make_interval(secs => $2::double precision), now())
     ON CONFLICT (key) DO UPDATE SET blocked_until = EXCLUDED.blocked_until, updated_at = now()`,
    [`ip:${ip}`, ms / 1000],
  ).catch(() => {});
}

/** Records an unusual request. Returns true when the IP just got blocked. */
function strike(ip, reason) {
  const now = Date.now();
  let s = strikes.get(ip);
  if (!s || now - s.first > STRIKE_WINDOW_MS) { s = { first: now, count: 0 }; strikes.set(ip, s); }
  s.count += 1;
  if (s.count >= STRIKES_TO_BLOCK) { block(ip, BLOCK_MS, reason); return true; }
  return false;
}

/** Counts a request. Returns 0 when allowed, otherwise seconds until the window resets. */
function hit(ip, bucket) {
  const [limit, per] = LIMITS[bucket] || LIMITS.api;
  const key = `${bucket}|${ip}`;
  const now = Date.now();
  let w = windows.get(key);
  if (!w || now - w.start >= per * 1000) {
    if (windows.size > MAX_ENTRIES) windows.clear();
    w = { start: now, count: 0 };
    windows.set(key, w);
  }
  w.count += 1;
  if (w.count <= limit) return 0;
  strike(ip, `rate:${bucket}`);
  return Math.max(1, Math.ceil((w.start + per * 1000 - now) / 1000));
}

setInterval(() => {
  const now = Date.now();
  for (const [k, w] of windows) if (now - w.start > 120000) windows.delete(k);
  for (const [k, s] of strikes) if (now - s.first > STRIKE_WINDOW_MS) strikes.delete(k);
  for (const [k, u] of blocked) if (u <= now) blocked.delete(k);
}, 60000).unref();

function maskIp(ip) {
  const s = String(ip);
  if (s.includes('.')) return s.replace(/\.\d+$/, '.x');
  return s.replace(/(:[0-9a-f]*){2}$/i, ':x:x');
}

function tooMany(res, seconds, code, message) {
  json(res, 429, { ok: false, code, error: message, retryAfter: seconds }, { 'Retry-After': String(seconds) });
}

/* ---------------- database-backed counters (shared across instances) ---------------- */

/**
 * Adds one failure to `key`. When the count reaches `max` inside `windowSec`, the key is blocked
 * for `blockSec`. Returns { hits, blockedFor (seconds, 0 if not blocked) }.
 */
async function fail(key, max, windowSec, blockSec) {
  const [row] = await db.query(
    `INSERT INTO throttle (key, hits, window_start, blocked_until, updated_at)
     VALUES ($1, 1, now(), CASE WHEN 1 >= $2 THEN now() + make_interval(secs => $4::double precision) END, now())
     ON CONFLICT (key) DO UPDATE SET
       hits = CASE WHEN throttle.window_start < now() - make_interval(secs => $3::double precision) THEN 1 ELSE throttle.hits + 1 END,
       window_start = CASE WHEN throttle.window_start < now() - make_interval(secs => $3::double precision) THEN now() ELSE throttle.window_start END,
       blocked_until = CASE
         WHEN (CASE WHEN throttle.window_start < now() - make_interval(secs => $3::double precision) THEN 1 ELSE throttle.hits + 1 END) >= $2
           THEN now() + make_interval(secs => $4::double precision)
         ELSE throttle.blocked_until END,
       updated_at = now()
     RETURNING hits, GREATEST(0, CEIL(EXTRACT(EPOCH FROM (blocked_until - now()))))::int AS blocked_for`,
    [key, max, windowSec, blockSec],
  );
  maybeCleanup();
  return { hits: row.hits, blockedFor: row.blocked_for || 0 };
}

/** Seconds remaining on the longest active block among `keys` (0 = not blocked). */
async function dbBlockedFor(keys) {
  const [row] = await db.query(
    `SELECT COALESCE(MAX(CEIL(EXTRACT(EPOCH FROM (blocked_until - now())))), 0)::int AS s
     FROM throttle WHERE key = ANY($1::text[]) AND blocked_until > now()`,
    [keys],
  );
  return row ? row.s : 0;
}

const clear = (key) => db.query('DELETE FROM throttle WHERE key = $1', [key]);

let lastCleanup = 0;
function maybeCleanup() {
  const now = Date.now();
  if (now - lastCleanup < 10 * 60 * 1000) return;
  lastCleanup = now;
  db.query("DELETE FROM throttle WHERE updated_at < now() - interval '2 days' AND (blocked_until IS NULL OR blocked_until < now())").catch(() => {});
  db.query('DELETE FROM sessions WHERE expires_at < now()').catch(() => {});
}

/** Browsers always send Origin on cross-site POSTs; reject any that isn't this site. */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  let host;
  try { host = new URL(origin).host; } catch (_) { return false; }
  const allowed = [req.headers.host, req.headers['x-forwarded-host']].filter(Boolean).map(String);
  return allowed.includes(host);
}

function isJsonRequest(req) {
  return /^application\/json\b/i.test(String(req.headers['content-type'] || ''));
}

const fmtWait = (s) => (s >= 90 ? `${Math.ceil(s / 60)} minutes` : `${s} seconds`);

module.exports = { LIMITS, hit, strike, block, blockedFor, tooMany, fail, dbBlockedFor, clear, sameOrigin, isJsonRequest, fmtWait, maskIp };
