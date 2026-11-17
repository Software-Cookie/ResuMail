'use strict';
/**
 * Owner tools. Two factors are required: you must be signed in with an email listed in
 * ADMIN_EMAILS, and every request must carry ADMIN_KEY. 5 wrong keys = 15-minute lockout.
 */
const db = require('./db');
const guard = require('./guard');
const { requireUser, isAdminEmail } = require('./auth');
const { PLANS, ORDER, PAID } = require('./plans');
const billing = require('./billing');
const { systemMail } = require('./mail');
const { HttpError, json, readBody, oneLine, safeEqual } = require('./util');

const ADMIN_KEY = String(process.env.ADMIN_KEY || '');

async function requireAdmin(req) {
  const user = await requireUser(req);
  // Non-admins get a plain 404 so the admin API doesn't advertise itself.
  if (!isAdminEmail(user.email) || ADMIN_KEY.length < 16) throw new HttpError(404, 'NOT_FOUND', 'Unknown API route.');
  const lock = `admin:${user.id}`;
  const wait = await guard.dbBlockedFor([lock]);
  if (wait) throw new HttpError(429, 'LOCKED', `Too many wrong admin keys. Try again in ${guard.fmtWait(wait)}.`, { retryAfter: wait });
  if (!safeEqual(req.headers['x-admin-key'] || '', ADMIN_KEY)) {
    const f = await guard.fail(lock, 5, 900, 900);
    if (f.blockedFor) throw new HttpError(429, 'LOCKED', `Too many wrong admin keys. Try again in ${guard.fmtWait(f.blockedFor)}.`, { retryAfter: f.blockedFor });
    throw new HttpError(401, 'ADMIN_KEY', `Admin key is incorrect. ${5 - f.hits} attempt${5 - f.hits === 1 ? '' : 's'} left.`);
  }
  return user;
}

async function overview(req, res) {
  await requireAdmin(req);
  const [u] = await db.query(
    `SELECT count(*)::int AS users,
       count(*) FILTER (WHERE plan = 'premium')::int AS premium,
       count(*) FILTER (WHERE plan = 'standard' AND credits > 0)::int AS standard,
       count(*) FILTER (WHERE plan = 'trial' AND credits > 0)::int AS trial,
       COALESCE(sum(sent_total), 0)::int AS sent
     FROM users`);
  const [o] = await db.query(
    `SELECT count(*) FILTER (WHERE status = 'submitted')::int AS pending,
       COALESCE(sum(amount) FILTER (WHERE status = 'paid'), 0)::int AS revenue,
       count(*) FILTER (WHERE status = 'paid' AND method <> 'coupon')::int AS paid_orders
     FROM orders`);
  json(res, 200, { ok: true, users: u, orders: o });
}

async function listOrders(req, res, ctx) {
  await requireAdmin(req);
  const status = oneLine(ctx.query.get('status'), 20) || 'submitted';
  const allowed = ['created', 'submitted', 'paid', 'rejected', 'all'];
  if (!allowed.includes(status)) throw new HttpError(400, 'VALIDATION', 'Unknown status.');
  const rows = await db.query(
    `SELECT o.id, o.plan, o.list_amount, o.amount, o.method, o.status, o.utr, o.note, o.created_at, o.paid_at, u.email, u.name
     FROM orders o JOIN users u ON u.id = o.user_id
     WHERE ($1 = 'all' OR o.status = $1) ORDER BY o.created_at DESC LIMIT 100`, [status]);
  json(res, 200, { ok: true, orders: rows });
}

async function approve(req, res) {
  await requireAdmin(req);
  const b = await readBody(req);
  const id = oneLine(b.id, 20);
  const row = await billing.grant(id, ['submitted', 'created']);
  if (!row) throw new HttpError(409, 'ORDER_CLOSED', 'That order is already paid or rejected.');
  systemMail(row.email, 'Your ResuMail plan is active',
    `Hi ${row.name},\n\nThank you! Your payment for order ${id} is confirmed and your ${PLANS[row.plan].name} plan is now active.\n\nHappy job hunting,\nResuMail`).catch(() => {});
  json(res, 200, { ok: true });
}

async function reject(req, res) {
  await requireAdmin(req);
  const b = await readBody(req);
  const note = oneLine(b.note, 200) || 'Payment not found. Please check the UTR and amount.';
  const row = await db.one(
    `UPDATE orders SET status = 'rejected', note = $2, updated_at = now()
     WHERE id = $1 AND status IN ('submitted', 'created') RETURNING id`, [oneLine(b.id, 20), note]);
  if (!row) throw new HttpError(409, 'ORDER_CLOSED', 'That order is already paid or rejected.');
  json(res, 200, { ok: true });
}

async function listCoupons(req, res) {
  await requireAdmin(req);
  const rows = await db.query(
    'SELECT id, hint, plan, percent_off, max_uses, uses, active, expires_at, created_at FROM coupons ORDER BY created_at DESC LIMIT 200');
  json(res, 200, { ok: true, coupons: rows });
}

async function createCoupon(req, res) {
  await requireAdmin(req);
  const b = await readBody(req);
  const code = billing.normalizeCoupon(b.code);
  const plan = oneLine(b.plan, 20);
  const pct = Number(b.percentOff);
  const max = Number(b.maxUses);
  if (!/^[A-Z0-9]{8,32}$/.test(code)) throw new HttpError(400, 'VALIDATION', 'Coupon codes need 8–32 letters or digits.');
  if (!PAID.includes(plan)) throw new HttpError(400, 'VALIDATION', 'Pick the plan this coupon unlocks.');
  if (!Number.isInteger(pct) || pct < 1 || pct > 100) throw new HttpError(400, 'VALIDATION', 'Discount must be 1–100%.');
  if (!Number.isInteger(max) || max < 1 || max > 100000) throw new HttpError(400, 'VALIDATION', 'Max uses must be 1–100000.');
  let expires = null;
  if (b.expiresAt) {
    const d = new Date(String(b.expiresAt));
    if (Number.isNaN(d.getTime()) || d < new Date()) throw new HttpError(400, 'VALIDATION', 'Expiry must be a future date.');
    expires = d.toISOString();
  }
  const row = await db.one(
    `INSERT INTO coupons (code_hash, hint, plan, percent_off, max_uses, expires_at) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (code_hash) DO NOTHING RETURNING id`,
    [billing.couponHash(code), `…${code.slice(-4)}`, plan, pct, max, expires]);
  if (!row) throw new HttpError(409, 'EXISTS', 'That coupon already exists.');
  json(res, 201, { ok: true, id: row.id });
}

async function toggleCoupon(req, res) {
  await requireAdmin(req);
  const b = await readBody(req);
  const row = await db.one('UPDATE coupons SET active = $2 WHERE id = $1 RETURNING id', [Number(b.id) || 0, b.active === true]);
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Coupon not found.');
  json(res, 200, { ok: true });
}

async function findUsers(req, res, ctx) {
  await requireAdmin(req);
  const q = oneLine(ctx.query.get('q'), 100).toLowerCase();
  if (q.length < 3) throw new HttpError(400, 'VALIDATION', 'Type at least 3 characters of the email.');
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`; // literal search, wildcards escaped
  const rows = await db.query(
    `SELECT id, email, name, plan, credits, free_period, free_used, sent_total, created_at FROM users
     WHERE email LIKE $1 ESCAPE '\\' ORDER BY created_at DESC LIMIT 20`, [like]);
  json(res, 200, { ok: true, users: rows });
}

async function setPlan(req, res) {
  await requireAdmin(req);
  const b = await readBody(req);
  const plan = oneLine(b.plan, 20);
  const credits = Number(b.credits);
  if (!ORDER.includes(plan)) throw new HttpError(400, 'VALIDATION', 'Unknown plan.');
  if (!Number.isInteger(credits) || credits < 0 || credits > 1000000) throw new HttpError(400, 'VALIDATION', 'Credits must be a whole number ≥ 0.');
  const row = await db.one('UPDATE users SET plan = $2, credits = $3, plan_since = now() WHERE id = $1 RETURNING id', [Number(b.userId) || 0, plan, credits]);
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'User not found.');
  json(res, 200, { ok: true });
}

module.exports = { overview, listOrders, approve, reject, listCoupons, createCoupon, toggleCoupon, findUsers, setPlan };
