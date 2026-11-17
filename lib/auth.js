'use strict';
/** Accounts: sign up, sign in (with lockout), sessions, password change and reset. */
const crypto = require('crypto');
const { promisify } = require('util');
const db = require('./db');
const guard = require('./guard');
const { usage } = require('./plans');
const { systemMail, systemMailEnabled } = require('./mail');
const {
  HttpError, json, readBody, isEmail, oneLine, str, normEmail, sha256, randomToken, parseCookies, isHttps,
} = require('./util');

const scrypt = promisify(crypto.scrypt);
// OWASP-recommended scrypt cost (N=2^14, r=8, p=5): ~16 MB of memory per hash.
const KDF = { N: 16384, r: 8, p: 5, keylen: 32 };
const COOKIE = 'rm_sess';
const SESSION_DAYS = 30;
const MAX_SESSIONS = 10;
const LOGIN_MAX_FAILS = 5;
const COOLDOWN_SEC = 15 * 60;
const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, KDF.keylen, { N: KDF.N, r: KDF.r, p: KDF.p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${KDF.N}$${KDF.r}$${KDF.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function verifyPassword(pw, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(pw, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return crypto.timingSafeEqual(key, expected);
}
// A real hash to check against when the email doesn't exist, so response time doesn't reveal accounts.
let dummyHash = null;
const getDummy = async () => (dummyHash || (dummyHash = await hashPassword(randomToken(12))));

const COMMON = new Set(['password1', 'password123', '12345678a', 'qwerty123', 'abc12345', 'admin123', 'welcome1', 'iloveyou1', 'passw0rd', 'india123']);
function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Use at least 8 characters for your password.';
  if (pw.length > 128) return 'That password is too long (max 128 characters).';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use both letters and numbers in your password.';
  if (COMMON.has(pw.toLowerCase())) return 'That password is too common. Choose another one.';
  return '';
}

/* ---------------- sessions ---------------- */
function setCookie(req, res, token, maxAge) {
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (isHttps(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
async function createSession(req, res, userId) {
  const token = randomToken(32);
  await db.tx([
    [`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))`, [sha256(token), userId, SESSION_DAYS]],
    [`DELETE FROM sessions WHERE user_id = $1 AND (expires_at < now() OR token_hash NOT IN (
        SELECT token_hash FROM sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2))`, [userId, MAX_SESSIONS]],
  ]);
  setCookie(req, res, token, SESSION_DAYS * 86400);
}
function sessionToken(req) {
  const t = parseCookies(req)[COOKIE];
  return t && /^[A-Za-z0-9_-]{40,60}$/.test(t) ? t : null;
}

const USER_COLS = 'u.id, u.email, u.name, u.plan, u.credits, u.free_period, u.free_used, u.sent_total, u.last_send_at, u.plan_since, u.created_at';

/** The signed-in user, or null. One indexed query. */
async function currentUser(req) {
  const token = sessionToken(req);
  if (!token) return null;
  return db.one(
    `SELECT ${USER_COLS} FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)],
  );
}
async function requireUser(req) {
  const u = await currentUser(req);
  if (!u) throw new HttpError(401, 'AUTH_REQUIRED', 'Please sign in to continue.');
  return u;
}
const isAdminEmail = (email) => ADMIN_EMAILS.includes(String(email).toLowerCase());

function publicUser(u) {
  if (!u) return null;
  return {
    name: u.name,
    email: u.email,
    initials: u.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || 'U',
    memberSince: u.created_at,
    planSince: u.plan_since,
    usage: usage(u),
    admin: isAdminEmail(u.email),
  };
}

/* ---------------- handlers ---------------- */
function cooldownError(seconds) {
  return new HttpError(429, 'LOCKED', `Too many failed attempts. For your security, please wait ${guard.fmtWait(seconds)} and try again.`, { retryAfter: seconds });
}

async function signup(req, res, ctx) {
  const b = await readBody(req);
  const name = oneLine(b.name, 80).replace(/[<>"]/g, '');
  const email = normEmail(b.email);
  const password = str(b.password, 200);
  if (name.length < 2) throw new HttpError(400, 'VALIDATION', 'Enter your full name.');
  if (!isEmail(email)) throw new HttpError(400, 'VALIDATION', 'Enter a valid email address.');
  const pwProblem = passwordProblem(password);
  if (pwProblem) throw new HttpError(400, 'VALIDATION', pwProblem);
  if (b.acceptTerms !== true) throw new HttpError(400, 'VALIDATION', 'Please accept the Terms and Privacy Policy.');

  const ipKey = `signup:${ctx.ip}`;
  const wait = await guard.dbBlockedFor([ipKey, `ip:${ctx.ip}`]);
  if (wait) throw new HttpError(429, 'SIGNUP_LIMIT', `Too many new accounts from your network. Try again in ${guard.fmtWait(wait)}.`, { retryAfter: wait });

  const hash = await hashPassword(password);
  const row = await db.one(
    'INSERT INTO users (email, name, pass_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING RETURNING id',
    [email, name, hash],
  );
  if (!row) throw new HttpError(409, 'EMAIL_TAKEN', 'An account with this email already exists. Sign in instead.');
  await guard.fail(ipKey, 5, 3600, 3600); // at most 5 new accounts per IP per hour
  await createSession(req, res, row.id);
  const u = await db.one(`SELECT ${USER_COLS} FROM users u WHERE u.id = $1`, [row.id]);
  json(res, 201, { ok: true, user: publicUser(u) });
}

async function login(req, res, ctx) {
  const b = await readBody(req);
  const email = normEmail(b.email);
  const password = str(b.password, 200);
  if (!isEmail(email) || !password) throw new HttpError(400, 'VALIDATION', 'Enter your email and password.');

  const emailKey = `login:${sha256(email)}`;
  const ipKey = `login-ip:${ctx.ip}`;
  const wait = await guard.dbBlockedFor([emailKey, ipKey, `ip:${ctx.ip}`]);
  if (wait) throw cooldownError(wait);

  const u = await db.one('SELECT id, pass_hash FROM users WHERE email = $1', [email]);
  const ok = await verifyPassword(password, u ? u.pass_hash : await getDummy());
  if (!u || !ok) {
    const [f] = await Promise.all([
      guard.fail(emailKey, LOGIN_MAX_FAILS, COOLDOWN_SEC, COOLDOWN_SEC),
      guard.fail(ipKey, 30, COOLDOWN_SEC, COOLDOWN_SEC),
    ]);
    if (f.blockedFor) throw cooldownError(f.blockedFor);
    const left = LOGIN_MAX_FAILS - f.hits;
    throw new HttpError(401, 'BAD_LOGIN', `Incorrect email or password. ${left} attempt${left === 1 ? '' : 's'} left before a 15-minute cooling period.`, { attemptsLeft: left });
  }
  await guard.clear(emailKey);
  await createSession(req, res, u.id);
  const full = await db.one(`SELECT ${USER_COLS} FROM users u WHERE u.id = $1`, [u.id]);
  json(res, 200, { ok: true, user: publicUser(full) });
}

async function logout(req, res) {
  const token = sessionToken(req);
  if (token) await db.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  setCookie(req, res, '', 0);
  json(res, 200, { ok: true });
}

async function me(req, res) {
  const u = await currentUser(req);
  json(res, 200, { ok: true, user: publicUser(u) });
}

async function changePassword(req, res) {
  const u = await requireUser(req);
  const b = await readBody(req);
  const key = `pw:${u.id}`;
  const wait = await guard.dbBlockedFor([key]);
  if (wait) throw cooldownError(wait);
  const row = await db.one('SELECT pass_hash FROM users WHERE id = $1', [u.id]);
  if (!(await verifyPassword(str(b.current, 200), row.pass_hash))) {
    const f = await guard.fail(key, LOGIN_MAX_FAILS, COOLDOWN_SEC, COOLDOWN_SEC);
    if (f.blockedFor) throw cooldownError(f.blockedFor);
    throw new HttpError(401, 'BAD_PASSWORD', 'Your current password is not correct.');
  }
  const next = str(b.next, 200);
  const problem = passwordProblem(next);
  if (problem) throw new HttpError(400, 'VALIDATION', problem);
  const token = sessionToken(req);
  await db.tx([
    ['UPDATE users SET pass_hash = $2 WHERE id = $1', [u.id, await hashPassword(next)]],
    ['DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [u.id, sha256(token)]],
  ]);
  await guard.clear(key);
  json(res, 200, { ok: true });
}

const resetHash = (userId, code) => sha256(`reset:${userId}:${code}`);

async function forgot(req, res, ctx) {
  if (!systemMailEnabled()) throw new HttpError(503, 'RESET_UNAVAILABLE', 'Password reset by email is not set up yet. Please contact support.');
  const b = await readBody(req);
  const email = normEmail(b.email);
  if (!isEmail(email)) throw new HttpError(400, 'VALIDATION', 'Enter a valid email address.');
  const ipWait = await guard.dbBlockedFor([`forgot-ip:${ctx.ip}`, `ip:${ctx.ip}`]);
  if (ipWait) throw new HttpError(429, 'LOCKED', `Too many requests. Try again in ${guard.fmtWait(ipWait)}.`, { retryAfter: ipWait });
  await guard.fail(`forgot-ip:${ctx.ip}`, 10, 3600, 3600);
  const mailKey = `forgot:${sha256(email)}`;
  const mailWait = await guard.dbBlockedFor([mailKey]);
  const u = mailWait ? null : await db.one('SELECT id, name FROM users WHERE email = $1', [email]);
  if (u) {
    await guard.fail(mailKey, 3, 3600, 3600); // 3 codes per email per hour
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    await db.query(
      `INSERT INTO reset_codes (user_id, code_hash, expires_at, attempts) VALUES ($1, $2, now() + interval '15 minutes', 0)
       ON CONFLICT (user_id) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0`,
      [u.id, resetHash(u.id, code)],
    );
    await systemMail(email, `Your ResuMail reset code: ${code}`,
      `Hi ${u.name},\n\nYour ResuMail password reset code is: ${code}\n\nIt expires in 15 minutes. If you didn't ask for this, you can ignore this email; your password stays the same.\n\nResuMail`);
  }
  // Same answer whether or not the account exists, so emails can't be discovered.
  json(res, 200, { ok: true, message: 'If an account exists for that email, a 6-digit code is on its way.' });
}

async function reset(req, res, ctx) {
  const b = await readBody(req);
  const email = normEmail(b.email);
  const code = oneLine(b.code, 10);
  const password = str(b.password, 200);
  const invalid = new HttpError(400, 'BAD_CODE', 'That code is invalid or has expired. Request a new one.');
  if (!isEmail(email) || !/^\d{6}$/.test(code)) throw invalid;
  const problem = passwordProblem(password);
  if (problem) throw new HttpError(400, 'VALIDATION', problem);
  const ipWait = await guard.dbBlockedFor([`reset-ip:${ctx.ip}`, `ip:${ctx.ip}`]);
  if (ipWait) throw cooldownError(ipWait);

  const row = await db.one(
    `UPDATE reset_codes r SET attempts = r.attempts + 1 FROM users u
     WHERE u.email = $1 AND r.user_id = u.id AND r.expires_at > now()
     RETURNING r.user_id, r.code_hash, r.attempts`,
    [email],
  );
  if (!row || row.attempts > 5 || row.code_hash !== resetHash(row.user_id, code)) {
    await guard.fail(`reset-ip:${ctx.ip}`, 10, 3600, 3600);
    if (row && row.attempts >= 5) await db.query('DELETE FROM reset_codes WHERE user_id = $1', [row.user_id]);
    throw invalid;
  }
  await db.tx([
    ['UPDATE users SET pass_hash = $2 WHERE id = $1', [row.user_id, await hashPassword(password)]],
    ['DELETE FROM sessions WHERE user_id = $1', [row.user_id]],
    ['DELETE FROM reset_codes WHERE user_id = $1', [row.user_id]],
    ['DELETE FROM throttle WHERE key = $1', [`login:${sha256(email)}`]],
  ]);
  await createSession(req, res, row.user_id);
  const u = await db.one(`SELECT ${USER_COLS} FROM users u WHERE u.id = $1`, [row.user_id]);
  json(res, 200, { ok: true, user: publicUser(u) });
}

module.exports = {
  signup, login, logout, me, changePassword, forgot, reset,
  currentUser, requireUser, publicUser, isAdminEmail, USER_COLS, passwordProblem, hashPassword, verifyPassword,
};
