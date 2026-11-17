'use strict';
/**
 * Payments and coupons.
 *
 * - UPI (default, free): the buyer pays your personal UPI ID by QR / UPI app and submits the
 *   12-digit UTR. You confirm it in your bank app and approve the order in /admin.html.
 * - Razorpay (optional, automatic): enabled when RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are set.
 * - Coupons: only SHA-256 hashes are stored. A 100% coupon activates the plan instantly.
 */
const crypto = require('crypto');
const db = require('./db');
const guard = require('./guard');
const { requireUser, publicUser, USER_COLS } = require('./auth');
const { PLANS, PAID, effectivePlan, upgradeSql } = require('./plans');
const { systemMail } = require('./mail');
const { HttpError, json, readBody, oneLine, str, sha256, safeEqual, randomCode } = require('./util');

const UPI_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/;
const UPI_ID = String(process.env.UPI_ID || '').trim();
const UPI_NAME = oneLine(process.env.UPI_NAME || 'ResuMail', 60);
const RZP_KEY = String(process.env.RAZORPAY_KEY_ID || '').trim();
const RZP_SECRET = String(process.env.RAZORPAY_KEY_SECRET || '').trim();
const RZP_API = 'https://api.razorpay.com/v1';
const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const COUPON_FAILS = 5;

const methods = () => ({ upi: UPI_RE.test(UPI_ID), razorpay: !!(RZP_KEY && RZP_SECRET) });

const normalizeCoupon = (s) => String(s || '').toUpperCase().replace(/[\s-]+/g, '').slice(0, 40);
const couponHash = (code) => sha256(`coupon:${code}`);
const priceAfter = (price, pct) => Math.max(0, Math.round((price * (100 - pct)) / 100));

// Charges added on top of the plan price. Set GST_PERCENT=0 if you are not GST-registered.
const percentEnv = (v, def, max) => {
  const n = v === undefined || v === '' ? def : Number(v);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : def;
};
const FEE_PERCENT = percentEnv(process.env.PROCESSING_FEE_PERCENT, 2, 10);
const GST_PERCENT = percentEnv(process.env.GST_PERCENT, 18, 28);
const pricing = () => ({ feePercent: FEE_PERCENT, gstPercent: GST_PERCENT });

/**
 * Price breakdown in paise (integers, so no floating-point money errors):
 * plan price − coupon = subtotal; + processing fee on the subtotal; + GST on (subtotal + fee) = total.
 */
function breakdown(listRupees, percentOff = 0) {
  const listPaise = listRupees * 100;
  const subtotalPaise = priceAfter(listRupees, percentOff) * 100;
  const feePaise = Math.round((subtotalPaise * FEE_PERCENT) / 100);
  const gstPaise = Math.round(((subtotalPaise + feePaise) * GST_PERCENT) / 100);
  return {
    listPaise, discountPaise: listPaise - subtotalPaise, subtotalPaise, feePaise, gstPaise,
    totalPaise: subtotalPaise + feePaise + gstPaise, feePercent: FEE_PERCENT, gstPercent: GST_PERCENT,
  };
}
const rs = (paise) => (paise / 100).toFixed(2);

function needPaidPlan(plan) {
  if (!PAID.includes(plan)) throw new HttpError(400, 'VALIDATION', 'Choose the Trial, Standard or Premium plan.');
  return plan;
}

/** Validates a coupon for this user. Wrong codes count towards a 15-minute cooldown. */
async function checkCoupon(user, raw) {
  const lockKey = `coupon:${user.id}`;
  const wait = await guard.dbBlockedFor([lockKey]);
  if (wait) throw new HttpError(429, 'LOCKED', `Too many invalid coupon attempts. Try again in ${guard.fmtWait(wait)}.`, { retryAfter: wait });
  const code = normalizeCoupon(raw);
  const c = /^[A-Z0-9]{6,32}$/.test(code) ? await db.one(
    `SELECT id, plan, percent_off, max_uses, uses, active, (expires_at IS NOT NULL AND expires_at <= now()) AS expired,
       EXISTS (SELECT 1 FROM redemptions r WHERE r.coupon_id = coupons.id AND r.user_id = $2) AS redeemed
     FROM coupons WHERE code_hash = $1`, [couponHash(code), user.id]) : null;
  if (!c || !c.active || c.expired) {
    const f = await guard.fail(lockKey, COUPON_FAILS, 900, 900);
    if (f.blockedFor) throw new HttpError(429, 'LOCKED', `Too many invalid coupon attempts. Try again in ${guard.fmtWait(f.blockedFor)}.`, { retryAfter: f.blockedFor });
    const left = COUPON_FAILS - f.hits;
    throw new HttpError(400, 'COUPON_INVALID', `${c && c.expired ? 'That coupon has expired.' : 'That coupon code is not valid.'} ${left} attempt${left === 1 ? '' : 's'} left.`);
  }
  if (c.redeemed) throw new HttpError(409, 'COUPON_REDEEMED', 'You have already used this coupon.');
  if (c.uses >= c.max_uses) throw new HttpError(409, 'COUPON_USED_UP', 'This coupon has reached its usage limit.');
  return c;
}

function assertCanBuy(user, plan) {
  if (effectivePlan(user) === 'premium') throw new HttpError(409, 'ALREADY_PREMIUM', 'You already have Premium: unlimited emails for life.');
  if (plan && user.plan === 'premium') throw new HttpError(409, 'ALREADY_PREMIUM', 'You already have Premium.');
}

/** Works out the price. A coupon decides the plan it applies to. */
async function priceFor(user, body) {
  let plan = oneLine(body.plan, 20);
  let coupon = null;
  assertCanBuy(user);
  if (oneLine(body.coupon, 60)) {
    coupon = await checkCoupon(user, body.coupon);
    plan = coupon.plan;
  }
  needPaidPlan(plan);
  assertCanBuy(user, plan);
  const list = PLANS[plan].price;
  return { plan, coupon, list, ...breakdown(list, coupon ? coupon.percent_off : 0) };
}

const quoteView = (q) => ({
  plan: q.plan,
  listPaise: q.listPaise,
  discountPaise: q.discountPaise,
  subtotalPaise: q.subtotalPaise,
  feePaise: q.feePaise,
  gstPaise: q.gstPaise,
  totalPaise: q.totalPaise,
  feePercent: q.feePercent,
  gstPercent: q.gstPercent,
  coupon: q.coupon ? { plan: q.coupon.plan, percentOff: q.coupon.percent_off } : null,
});

async function quote(req, res) {
  const user = await requireUser(req);
  const q = await priceFor(user, await readBody(req));
  json(res, 200, { ok: true, quote: quoteView(q) });
}

/** Marks an order paid and upgrades the user, all in one atomic statement. Idempotent. */
async function grant(orderId, fromStatuses) {
  const order = await db.one('SELECT id, plan FROM orders WHERE id = $1', [orderId]);
  if (!order) return null;
  const credits = PLANS[order.plan].credits || 0;
  return db.one(
    `WITH o AS (
       UPDATE orders SET status = 'paid', paid_at = now(), updated_at = now()
       WHERE id = $1 AND status = ANY($2::text[]) RETURNING id, user_id, coupon_id
     ), r AS (
       INSERT INTO redemptions (coupon_id, user_id, order_id)
       SELECT coupon_id, user_id, id FROM o WHERE coupon_id IS NOT NULL
       ON CONFLICT DO NOTHING RETURNING coupon_id
     ), c AS (
       UPDATE coupons SET uses = uses + 1 FROM r WHERE coupons.id = r.coupon_id RETURNING coupons.id
     ), u AS (
       UPDATE users SET credits = users.credits + $3, plan = ${upgradeSql(4)}, plan_since = now()
       FROM o WHERE users.id = o.user_id
       RETURNING users.id, users.email, users.name, users.plan, users.credits
     )
     SELECT u.*, (SELECT count(*) FROM c)::int AS coupon_counted FROM u`,
    [orderId, fromStatuses, credits, order.plan]);
}

/** 100%-off coupon: redeem and activate in a single atomic statement. */
async function redeemFree(user, coupon) {
  const id = `RM${randomCode(10)}`;
  try {
    const row = await db.one(
      `WITH c AS (
         UPDATE coupons SET uses = uses + 1
         WHERE id = $1 AND active AND uses < max_uses AND percent_off = 100 AND plan = $5
           AND (expires_at IS NULL OR expires_at > now())
         RETURNING id
       ), o AS (
         INSERT INTO orders (id, user_id, plan, list_amount, amount, coupon_id, method, status, paid_at)
         SELECT $2, $3, $5, $4, 0, c.id, 'coupon', 'paid', now() FROM c RETURNING id, coupon_id
       ), r AS (
         INSERT INTO redemptions (coupon_id, user_id, order_id) SELECT coupon_id, $3, id FROM o RETURNING coupon_id
       )
       UPDATE users SET credits = users.credits + $6, plan = ${upgradeSql(5)}, plan_since = now()
       WHERE users.id = $3 AND EXISTS (SELECT 1 FROM r)
       RETURNING users.id`,
      [coupon.id, id, user.id, PLANS[coupon.plan].price, coupon.plan, PLANS[coupon.plan].credits || 0]);
    if (!row) throw new HttpError(409, 'COUPON_USED_UP', 'This coupon is no longer available.');
  } catch (e) {
    if (db.isUniqueViolation(e)) throw new HttpError(409, 'COUPON_REDEEMED', 'You have already used this coupon.');
    throw e;
  }
  return id;
}

async function freshUser(id) {
  return publicUser(await db.one(`SELECT ${USER_COLS} FROM users u WHERE u.id = $1`, [id]));
}

async function rzpRequest(path, opts = {}) {
  const res = await fetch(`${RZP_API}${path}`, {
    method: opts.method || 'GET',
    headers: { Authorization: `Basic ${Buffer.from(`${RZP_KEY}:${RZP_SECRET}`).toString('base64')}`, 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('[razorpay]', res.status, data && data.error && data.error.code);
    throw new HttpError(502, 'GATEWAY', 'The payment gateway is not responding. Please try again in a minute.');
  }
  return data;
}

async function checkout(req, res) {
  const user = await requireUser(req);
  const body = await readBody(req);
  const q = await priceFor(user, body);

  if (q.totalPaise === 0) {
    if (!q.coupon) throw new HttpError(400, 'VALIDATION', 'Choose a plan.');
    const orderId = await redeemFree(user, q.coupon);
    return json(res, 200, { ok: true, activated: true, orderId, user: await freshUser(user.id) });
  }

  const m = methods();
  const method = oneLine(body.method, 20) || (m.upi ? 'upi' : 'razorpay');
  if (!m[method]) throw new HttpError(503, 'PAYMENTS_OFF', 'Online payment is not available yet. Please try again later or use a coupon.');

  const open = await db.one(
    `SELECT count(*)::int AS n FROM orders WHERE user_id = $1 AND status IN ('created', 'submitted') AND created_at > now() - interval '1 day'`, [user.id]);
  if (open.n >= 8) throw new HttpError(429, 'TOO_MANY_ORDERS', 'You have several unpaid orders. Finish or wait for one of them first.');

  // Reuse an identical unpaid order from the last day instead of creating duplicates.
  // Reuse an identical unpaid order (same plan, coupon and total) instead of creating duplicates.
  let order = await db.one(
    `SELECT id, gateway_order_id FROM orders WHERE user_id = $1 AND plan = $2 AND total_paise = $3 AND method = $4
       AND status = 'created' AND coupon_id IS NOT DISTINCT FROM $5 AND created_at > now() - interval '1 day'
     ORDER BY created_at DESC LIMIT 1`,
    [user.id, q.plan, q.totalPaise, method, q.coupon ? q.coupon.id : null]);
  if (!order) {
    order = await db.one(
      `INSERT INTO orders (id, user_id, plan, list_amount, amount, coupon_id, method, fee_paise, gst_paise, total_paise)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, gateway_order_id`,
      [`RM${randomCode(10)}`, user.id, q.plan, q.list, q.subtotalPaise / 100, q.coupon ? q.coupon.id : null, method, q.feePaise, q.gstPaise, q.totalPaise]);
  }

  const out = { ok: true, orderId: order.id, quote: quoteView(q) };
  if (method === 'upi') {
    // The QR / UPI link carries the full total (plan − coupon + fee + GST).
    const note = `ResuMail ${order.id}`;
    out.upi = {
      vpa: UPI_ID,
      name: UPI_NAME,
      amountPaise: q.totalPaise,
      note,
      uri: `upi://pay?pa=${encodeURIComponent(UPI_ID)}&pn=${encodeURIComponent(UPI_NAME)}&am=${rs(q.totalPaise)}&cu=INR&tn=${encodeURIComponent(note)}`,
    };
  } else {
    let rzpId = order.gateway_order_id;
    if (!rzpId) {
      const r = await rzpRequest('/orders', { method: 'POST', body: { amount: q.totalPaise, currency: 'INR', receipt: order.id, notes: { plan: q.plan } } });
      rzpId = r.id;
      await db.query('UPDATE orders SET gateway_order_id = $2, updated_at = now() WHERE id = $1', [order.id, rzpId]);
    }
    out.razorpay = {
      key: RZP_KEY, order_id: rzpId, amount: q.totalPaise, currency: 'INR', name: 'ResuMail',
      description: `${PLANS[q.plan].name} plan`, prefill: { name: user.name, email: user.email },
    };
  }
  json(res, 200, out);
}

async function submitUtr(req, res) {
  const user = await requireUser(req);
  const b = await readBody(req);
  const orderId = oneLine(b.orderId, 20);
  const utr = oneLine(b.utr, 30).replace(/\s+/g, '');
  if (!/^RM[A-Z0-9]{10}$/.test(orderId)) throw new HttpError(400, 'VALIDATION', 'Unknown order.');
  if (!/^\d{12}$/.test(utr)) throw new HttpError(400, 'VALIDATION', 'The UPI transaction ID (UTR) is the 12-digit number shown in your UPI app after paying.');
  const lock = `utr:${user.id}`;
  const wait = await guard.dbBlockedFor([lock]);
  if (wait) throw new HttpError(429, 'LOCKED', `Too many submissions. Try again in ${guard.fmtWait(wait)}.`, { retryAfter: wait });
  await guard.fail(lock, 10, 3600, 3600);

  let row;
  try {
    row = await db.one(
      `UPDATE orders SET utr = $3, status = 'submitted', updated_at = now()
       WHERE id = $1 AND user_id = $2 AND method = 'upi' AND status = 'created' AND created_at > now() - interval '2 days'
       RETURNING id, plan, total_paise`, [orderId, user.id, utr]);
  } catch (e) {
    if (db.isUniqueViolation(e)) throw new HttpError(409, 'UTR_USED', 'This UTR has already been submitted.');
    throw e;
  }
  if (!row) throw new HttpError(409, 'ORDER_CLOSED', 'This order was already submitted or has expired. Start a new payment.');

  const text = `New UPI payment to verify\n\nOrder: ${row.id}\nPlan: ${PLANS[row.plan].name}\nAmount: Rs ${rs(row.total_paise)} (incl. fee and GST)\nUTR: ${utr}\nUser: ${user.email}\n\nCheck your bank app for this UTR and amount, then approve it in /admin.html.`;
  await Promise.all(ADMIN_EMAILS.map((a) => systemMail(a, `ResuMail: verify Rs ${rs(row.total_paise)} payment (${row.id})`, text)));
  json(res, 200, { ok: true, status: 'submitted' });
}

function validRzpSignature(rzpOrderId, paymentId, signature) {
  const expected = crypto.createHmac('sha256', RZP_SECRET).update(`${rzpOrderId}|${paymentId}`).digest('hex');
  return typeof signature === 'string' && /^[a-f0-9]{64}$/.test(signature) && safeEqual(expected, signature);
}

async function rzpVerify(req, res) {
  const user = await requireUser(req);
  if (!methods().razorpay) throw new HttpError(503, 'PAYMENTS_OFF', 'Card payments are not enabled.');
  const b = await readBody(req);
  const order = await db.one(`SELECT id, gateway_order_id FROM orders WHERE id = $1 AND user_id = $2 AND method = 'razorpay'`, [oneLine(b.orderId, 20), user.id]);
  if (!order || order.gateway_order_id !== str(b.razorpay_order_id, 60)) throw new HttpError(400, 'VALIDATION', 'Unknown order.');
  if (!validRzpSignature(order.gateway_order_id, str(b.razorpay_payment_id, 60), str(b.razorpay_signature, 128))) {
    throw new HttpError(400, 'BAD_SIGNATURE', 'We could not confirm this payment. If money was deducted, it will be checked automatically.');
  }
  await grant(order.id, ['created', 'submitted']);
  json(res, 200, { ok: true, user: await freshUser(user.id) });
}

/** Re-checks unpaid Razorpay orders with Razorpay (covers a closed tab after paying). */
async function rzpSync(req, res) {
  const user = await requireUser(req);
  if (!methods().razorpay) return json(res, 200, { ok: true, updated: 0 });
  const rows = await db.query(
    `SELECT id, gateway_order_id FROM orders WHERE user_id = $1 AND method = 'razorpay' AND status = 'created'
       AND gateway_order_id IS NOT NULL AND created_at > now() - interval '3 days' ORDER BY created_at DESC LIMIT 3`, [user.id]);
  let updated = 0;
  for (const o of rows) {
    const r = await rzpRequest(`/orders/${encodeURIComponent(o.gateway_order_id)}`);
    if (r && r.status === 'paid' && r.receipt === o.id) { if (await grant(o.id, ['created'])) updated++; }
  }
  json(res, 200, { ok: true, updated, user: updated ? await freshUser(user.id) : undefined });
}

async function orders(req, res) {
  const user = await requireUser(req);
  const rows = await db.query(
    `SELECT id, plan, list_amount, amount, fee_paise, gst_paise, total_paise, method, status, utr, note, created_at, paid_at FROM orders
     WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`, [user.id]);
  json(res, 200, { ok: true, orders: rows });
}

module.exports = {
  methods, pricing, quote, checkout, submitUtr, rzpVerify, rzpSync, orders, grant, normalizeCoupon, couponHash, UPI_NAME,
  _internal: { validRzpSignature, priceAfter, breakdown },
};
