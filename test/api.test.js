'use strict';
/**
 * End-to-end API tests against an in-memory Postgres (PGlite) and a fake SMTP transport.
 * Run with: npm test
 */
process.env.LOCAL_DB_DIR = ':memory:';
process.env.TRUST_PROXY = '1'; // lets each test use its own fake IP via X-Forwarded-For
process.env.ADMIN_EMAILS = 'owner@example.com';
process.env.ADMIN_KEY = 'test-admin-key-0123456789';
process.env.UPI_ID = 'owner@okaxis';
process.env.UPI_NAME = 'Test Owner';
process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret';
process.env.PROCESSING_FEE_PERCENT = '2';
process.env.GST_PERCENT = '18';
delete process.env.DATABASE_URL;
delete process.env.SMTP_USER;

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// Fake SMTP: records messages, fails for addresses starting with "bounce".
const sent = [];
nodemailer.createTransport = () => ({
  verify: async () => true,
  close() {},
  sendMail: async (m) => {
    if (String(m.to).startsWith('bounce')) throw Object.assign(new Error('550 no such user'), { responseCode: 550 });
    sent.push(m);
    return { messageId: `<${sent.length}@test>`, rejected: [] };
  },
});

const app = require('../server');
const db = require('../lib/db');
const billing = require('../lib/billing');

let base;
let server;
let ipSeq = 1;
const newIp = () => `198.51.100.${ipSeq++}`;

function client(ip = newIp()) {
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, {
      method,
      headers: Object.assign({ 'X-Forwarded-For': ip }, body !== undefined ? { 'Content-Type': 'application/json' } : {}, cookie ? { Cookie: cookie } : {}, headers),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    let data = null;
    try { data = await r.json(); } catch (_) { /* not json */ }
    return { status: r.status, data, headers: r.headers };
  };
  return {
    ip,
    get: (p, h) => call('GET', p, undefined, h),
    post: (p, b = {}, h) => call('POST', p, b, h),
    get cookie() { return cookie; },
  };
}

let userSeq = 0;
async function newUser(ip) {
  const c = client(ip);
  const email = `user${++userSeq}@example.com`;
  const r = await c.post('/api/auth/signup', { name: `User ${userSeq}`, email, password: 'secret123', acceptTerms: true });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return Object.assign(c, { email });
}
const smtp = (user = 'sender@gmail.com') => ({ provider: 'gmail', user, pass: 'abcdabcdabcdabcd', fromName: 'Tester' });
const mail = (to, sender) => ({ smtp: smtp(sender), to, subject: 'Application', text: 'Hello there' });
const resetGap = (email) => db.query("UPDATE users SET last_send_at = now() - interval '1 hour' WHERE email = $1", [email]);
const admin = { 'X-Admin-Key': process.env.ADMIN_KEY };

test.before(async () => {
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { server.close(); await db.close(); });

test('sign up, session cookie and profile', async () => {
  const c = await newUser();
  const me = await c.get('/api/me');
  assert.equal(me.data.user.usage.plan, 'free');
  assert.equal(me.data.user.usage.remaining, 10);
  assert.match(c.cookie, /^rm_sess=/);
  const dup = await client().post('/api/auth/signup', { name: 'X Y', email: c.email.toUpperCase(), password: 'secret123', acceptTerms: true });
  assert.equal(dup.data.code, 'EMAIL_TAKEN');
  const weak = await client().post('/api/auth/signup', { name: 'X Y', email: 'weak@example.com', password: 'password', acceptTerms: true });
  assert.equal(weak.status, 400);
});

test('5 failed logins start a cooling period, even with the right password', async () => {
  const u = await newUser();
  const c = client();
  for (let i = 1; i <= 4; i++) {
    const r = await c.post('/api/auth/login', { email: u.email, password: 'wrong-pass1' });
    assert.equal(r.data.code, 'BAD_LOGIN');
    assert.equal(r.data.attemptsLeft, 5 - i);
  }
  const fifth = await c.post('/api/auth/login', { email: u.email, password: 'wrong-pass1' });
  assert.equal(fifth.status, 429);
  assert.equal(fifth.data.code, 'LOCKED');
  assert.ok(fifth.data.retryAfter > 800);
  const good = await client().post('/api/auth/login', { email: u.email, password: 'secret123' });
  assert.equal(good.data.code, 'LOCKED');
});

test('SQL injection payloads are treated as plain data', async () => {
  const c = client();
  const payloads = ["' OR '1'='1", "x'; DROP TABLE users; --", "admin@example.com' --", "1; SELECT pg_sleep(5)"];
  for (const p of payloads) {
    const r = await c.post('/api/auth/login', { email: `${p}@example.com`, password: p });
    assert.ok([400, 401].includes(r.status), `${p} -> ${r.status}`);
  }
  const u = await newUser();
  const q = await u.post('/api/billing/quote', { coupon: "' OR 1=1 --" });
  assert.equal(q.data.code, 'COUPON_INVALID');
  const [{ n }] = await db.query('SELECT count(*)::int AS n FROM users');
  assert.ok(n >= 2, 'users table still exists');
});

test('CSRF: cross-site and non-JSON POSTs are refused', async () => {
  const u = await newUser();
  const foreign = await u.post('/api/auth/logout', {}, { Origin: 'https://evil.example' });
  assert.equal(foreign.status, 403);
  const r = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-Forwarded-For': newIp() }, body: '{}' });
  assert.equal(r.status, 415);
});

test('an IP sending 5 unusual requests is blocked for 15 minutes', async () => {
  const c = client();
  for (let i = 0; i < 4; i++) assert.equal((await c.get(`/api/wp-admin-${i}`)).status, 404);
  await c.get('/api/.env');
  const r = await c.get('/api/bootstrap');
  assert.equal(r.status, 429);
  assert.equal(r.data.code, 'BLOCKED');
  assert.ok(Number(r.headers.get('retry-after')) > 800);
  assert.equal((await client().get('/api/bootstrap')).status, 200, 'other visitors are unaffected');
});

test('free plan: 10 emails a month, 30 s gap, tests do not count', async () => {
  const u = await newUser();
  const t = await u.post('/api/send', { ...mail('ignored@example.com', 'free1@gmail.com'), test: true });
  assert.equal(t.status, 200);
  assert.equal(t.data.to, 'free1@gmail.com', 'tests only go to the sender');
  for (let i = 0; i < 10; i++) {
    const r = await u.post('/api/send', mail(`hr${i}@company.com`, 'free1@gmail.com'));
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.usage.remaining, 9 - i);
    if (i === 0) {
      const fast = await u.post('/api/send', mail('fast@company.com', 'free1@gmail.com'));
      assert.equal(fast.data.code, 'GAP');
      assert.ok(fast.data.retryAfter >= 28 && fast.data.retryAfter <= 30);
    }
    await resetGap(u.email);
  }
  const over = await u.post('/api/send', mail('hr11@company.com', 'free1@gmail.com'));
  assert.equal(over.status, 402);
  assert.equal(over.data.code, 'QUOTA');
});

test('free allowance is also counted per sending address across accounts', async () => {
  const a = await newUser();
  for (let i = 0; i < 10; i++) { assert.equal((await a.post('/api/send', mail(`x${i}@co.com`, 'shared@gmail.com'))).status, 200); await resetGap(a.email); }
  const b = await newUser();
  const r = await b.post('/api/send', mail('y@co.com', 'shared@gmail.com'));
  assert.equal(r.data.code, 'QUOTA');
  assert.equal((await b.post('/api/send', mail('y@co.com', 'own@gmail.com'))).status, 200);
});

test('a failed delivery gives the email back', async () => {
  const u = await newUser();
  const r = await u.post('/api/send', mail('bounce@company.com', 'refund@gmail.com'));
  assert.equal(r.data.code, 'RECIPIENT');
  const me = await u.get('/api/me');
  assert.equal(me.data.user.usage.remaining, 10);
});

test('concurrent sends cannot beat the quota or the gap (race safety)', async () => {
  const u = await newUser();
  await db.query("UPDATE users SET free_period = to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM'), free_used = 9 WHERE email = $1", [u.email]);
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => u.post('/api/send', mail(`race${i}@co.com`, 'race@gmail.com'))));
  assert.equal(results.filter((r) => r.status === 200).length, 1, results.map((r) => r.data.code).join(','));
  const p = await newUser();
  await db.query("UPDATE users SET plan = 'premium' WHERE email = $1", [p.email]);
  const burst = await Promise.all(Array.from({ length: 6 }, (_, i) => p.post('/api/send', mail(`p${i}@co.com`, 'prem@gmail.com'))));
  assert.equal(burst.filter((r) => r.status === 200).length, 1, 'premium still keeps a 2 s gap');
});

test('templates are locked on Free and open on paid plans', async () => {
  const u = await newUser();
  assert.equal((await u.get('/api/templates')).data.code, 'PLAN_REQUIRED');
  await db.query("UPDATE users SET plan = 'trial', credits = 5 WHERE email = $1", [u.email]);
  const r = await u.get('/api/templates');
  assert.equal(r.status, 200);
  assert.ok(r.data.templates.length >= 5 && r.data.templates[0].body.includes('{{intro}}'));
});

test('admin needs the right email AND key; 5 wrong keys lock it', async () => {
  const stranger = await newUser();
  assert.equal((await stranger.get('/api/admin/overview', admin)).status, 404);
  const owner = client();
  await owner.post('/api/auth/signup', { name: 'Owner', email: 'owner@example.com', password: 'secret123', acceptTerms: true });
  assert.equal((await owner.get('/api/admin/overview', admin)).status, 200);
  for (let i = 0; i < 4; i++) assert.equal((await owner.get('/api/admin/overview', { 'X-Admin-Key': 'nope' })).data.code, 'ADMIN_KEY');
  assert.equal((await owner.get('/api/admin/overview', { 'X-Admin-Key': 'nope' })).data.code, 'LOCKED');
  assert.equal((await owner.get('/api/admin/overview', admin)).data.code, 'LOCKED', 'even the right key waits');
  await db.query("DELETE FROM throttle WHERE key LIKE 'admin:%'");
});

test('coupons: hashed storage, 100% activation, single use, brute-force lockout', async () => {
  const owner = client();
  await owner.post('/api/auth/login', { email: 'owner@example.com', password: 'secret123' });
  const code = crypto.randomBytes(8).toString('hex').toUpperCase();
  assert.equal((await owner.post('/api/admin/coupons', { code, plan: 'premium', percentOff: 100, maxUses: 2 }, admin)).status, 201);
  const half = crypto.randomBytes(8).toString('hex').toUpperCase();
  await owner.post('/api/admin/coupons', { code: half, plan: 'standard', percentOff: 50, maxUses: 5 }, admin);
  const stored = await db.query('SELECT code_hash, hint FROM coupons');
  assert.ok(stored.every((c) => !c.code_hash.includes(code) && c.hint.length <= 5), 'only hashes are stored');

  const u = await newUser();
  const q = await u.post('/api/billing/quote', { coupon: code.toLowerCase().replace(/(.{4})/g, '$1-') });
  assert.deepEqual([q.data.quote.totalPaise, q.data.quote.feePaise, q.data.quote.gstPaise], [0, 0, 0], '100% coupon: nothing to pay');
  const act = await u.post('/api/billing/checkout', { coupon: code, plan: 'premium' });
  assert.equal(act.data.activated, true);
  assert.equal(act.data.user.usage.plan, 'premium');
  assert.equal((await u.post('/api/billing/quote', { coupon: code })).data.code, 'ALREADY_PREMIUM');

  const v = await newUser();
  const hq = await v.post('/api/billing/quote', { coupon: half });
  // ₹99 − 50% = ₹50; fee 2% = ₹1.00; GST 18% of ₹51.00 = ₹9.18; total ₹60.18
  const h = hq.data.quote;
  assert.deepEqual([h.plan, h.subtotalPaise, h.discountPaise, h.feePaise, h.gstPaise, h.totalPaise], ['standard', 5000, 4900, 100, 918, 6018]);

  const w = await newUser();
  for (let i = 0; i < 4; i++) assert.equal((await w.post('/api/billing/quote', { coupon: `WRONGCODE${i}XYZ` })).data.code, 'COUPON_INVALID');
  assert.equal((await w.post('/api/billing/quote', { coupon: 'WRONGCODE5XYZ' })).data.code, 'LOCKED');
  assert.equal((await w.post('/api/billing/quote', { coupon: code })).data.code, 'LOCKED', 'valid code still waits out the cooldown');

  const x = await newUser();
  await x.post('/api/billing/checkout', { coupon: code, plan: 'premium' });
  const y = await newUser();
  assert.equal((await y.post('/api/billing/quote', { coupon: code })).data.code, 'COUPON_USED_UP');
});

test('UPI: order, UTR checks, admin approval adds the pack', async () => {
  const u = await newUser();
  const co = await u.post('/api/billing/checkout', { plan: 'trial', method: 'upi' });
  assert.equal(co.status, 200);
  // Trial ₹29 + 2% fee (₹0.58) + 18% GST on ₹29.58 (₹5.32) = ₹34.90, and the QR link asks for exactly that.
  assert.equal(co.data.upi.amountPaise, 3490);
  assert.match(co.data.upi.uri, /^upi:\/\/pay\?pa=owner%40okaxis&pn=Test%20Owner&am=34\.90&cu=INR&tn=ResuMail%20RM/);
  const [stored] = await db.query('SELECT amount, fee_paise, gst_paise, total_paise FROM orders WHERE id = $1', [co.data.orderId]);
  assert.deepEqual(stored, { amount: 29, fee_paise: 58, gst_paise: 532, total_paise: 3490 }, 'breakdown saved on the order');
  const again = await u.post('/api/billing/checkout', { plan: 'trial', method: 'upi' });
  assert.equal(again.data.orderId, co.data.orderId, 'identical unpaid order is reused');
  assert.equal((await u.post('/api/billing/upi', { orderId: co.data.orderId, utr: '12345' })).status, 400);
  const utr = String(Date.now()).slice(-12).padStart(12, '7');
  assert.equal((await u.post('/api/billing/upi', { orderId: co.data.orderId, utr })).data.status, 'submitted');
  const other = await newUser();
  const o2 = await other.post('/api/billing/checkout', { plan: 'standard', method: 'upi' });
  assert.equal((await other.post('/api/billing/upi', { orderId: o2.data.orderId, utr })).data.code, 'UTR_USED');
  assert.equal((await other.post('/api/billing/upi', { orderId: co.data.orderId, utr: '999999999999' })).data.code, 'ORDER_CLOSED', "can't touch someone else's order");

  const owner = client();
  await owner.post('/api/auth/login', { email: 'owner@example.com', password: 'secret123' });
  const list = await owner.get('/api/admin/orders?status=submitted', admin);
  assert.ok(list.data.orders.some((o) => o.id === co.data.orderId && o.utr === utr));
  assert.equal((await owner.post('/api/admin/orders/approve', { id: co.data.orderId }, admin)).status, 200);
  assert.equal((await owner.post('/api/admin/orders/approve', { id: co.data.orderId }, admin)).data.code, 'ORDER_CLOSED', 'approving twice does nothing');
  const me = await u.get('/api/me');
  assert.equal(me.data.user.usage.plan, 'trial');
  assert.equal(me.data.user.usage.remaining, 100);
  const s = await u.post('/api/send', mail('hr@co.com', 'paid@gmail.com'));
  assert.equal(s.data.usage.remaining, 99);
  assert.equal((await u.post('/api/send', mail('hr2@co.com', 'paid@gmail.com'))).data.retryAfter <= 10, true);
});

test('price breakdown: plan + 2% processing fee + 18% GST on every plan', async () => {
  const u = await newUser();
  const expected = { trial: [2900, 58, 532, 3490], standard: [9900, 198, 1818, 11916], premium: [29900, 598, 5490, 35988] };
  for (const [plan, [sub, fee, gst, total]] of Object.entries(expected)) {
    const { quote } = (await u.post('/api/billing/quote', { plan })).data;
    assert.deepEqual([quote.subtotalPaise, quote.feePaise, quote.gstPaise, quote.totalPaise], [sub, fee, gst, total], plan);
    assert.equal(quote.subtotalPaise + quote.feePaise + quote.gstPaise, quote.totalPaise);
  }
  const boot = await u.get('/api/bootstrap');
  assert.deepEqual(boot.data.pricing, { feePercent: 2, gstPercent: 18 });
  const { breakdown } = billing._internal;
  assert.equal(breakdown(99, 100).totalPaise, 0, 'free coupons add no fee or GST');
});

test('SSRF: custom SMTP hosts on private networks are refused', async () => {
  const u = await newUser();
  for (const host of ['127.0.0.1', 'localhost', '169.254.169.254', '10.0.0.5']) {
    const r = await u.post('/api/verify', { smtp: { provider: 'custom', host, port: 587, user: 'x', pass: 'y', fromEmail: 'a@b.co' } });
    assert.equal(r.data.code, 'BAD_HOST', host);
  }
});

test('Razorpay signature check', () => {
  const sig = crypto.createHmac('sha256', 'rzp_test_secret').update('order_1|pay_1').digest('hex');
  assert.equal(billing._internal.validRzpSignature('order_1', 'pay_1', sig), true);
  assert.equal(billing._internal.validRzpSignature('order_1', 'pay_2', sig), false);
  assert.equal(billing._internal.validRzpSignature('order_1', 'pay_1', 'x'.repeat(64)), false);
});

test('static site: security headers, robots, sitemap and 404', async () => {
  const r = await fetch(`${base}/`);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  const html = await r.text();
  assert.ok(html.includes('<link rel="canonical" href="http://127.0.0.1') && !html.includes('%SITE_URL%'));
  assert.match(await (await fetch(`${base}/robots.txt`)).text(), /Sitemap: .*\/sitemap\.xml/);
  assert.match(await (await fetch(`${base}/sitemap.xml`)).text(), /<urlset/);
  assert.equal((await fetch(`${base}/no-such-page`)).status, 404);
});
