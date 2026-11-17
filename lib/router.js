'use strict';
/**
 * The whole API behind one entry point (one Vercel function = one warm instance for every route,
 * and well under the Hobby plan's function limit). Every request passes the abuse guard first.
 */
const guard = require('./guard');
const auth = require('./auth');
const sending = require('./sending');
const billing = require('./billing');
const admin = require('./admin');
const templates = require('./templates');
const { publicPlans, GAP_CHOICES } = require('./plans');
const { MAX_ATTACHMENT_BYTES, ENV_SENDER, serverSenderEnabled, systemMailEnabled } = require('./mail');
const { HttpError, json, clientIp, maskEmail } = require('./util');

async function health(req, res) {
  json(res, 200, { ok: true, service: 'resumail', time: new Date().toISOString() });
}

/** Everything the page needs on load, in one request. No database query unless signed in. */
async function bootstrap(req, res) {
  let user = null;
  let degraded = false;
  try { user = auth.publicUser(await auth.currentUser(req)); } catch (e) {
    degraded = true;
    console.error('[bootstrap] database unavailable:', e && e.message);
  }
  json(res, 200, {
    ok: true,
    user,
    degraded,
    plans: publicPlans(),
    gapChoices: GAP_CHOICES,
    templates: templates.list(),
    payments: billing.methods(),
    upiName: billing.methods().upi ? billing.UPI_NAME : null,
    resetEnabled: systemMailEnabled(),
    serverSender: serverSenderEnabled(),
    serverFrom: serverSenderEnabled() ? maskEmail(ENV_SENDER.fromEmail) : null,
    maxAttachmentBytes: MAX_ATTACHMENT_BYTES,
  });
}

// "METHOD path": [handler, rate-limit group]
const ROUTES = {
  'GET health': [health, 'public'],
  'GET bootstrap': [bootstrap, 'public'],
  'GET config': [bootstrap, 'public'],
  'GET me': [auth.me, 'api'],
  'POST auth/signup': [auth.signup, 'auth'],
  'POST auth/login': [auth.login, 'auth'],
  'POST auth/logout': [auth.logout, 'auth'],
  'POST auth/forgot': [auth.forgot, 'auth'],
  'POST auth/reset': [auth.reset, 'auth'],
  'POST auth/password': [auth.changePassword, 'auth'],
  'POST verify': [sending.verify, 'verify'],
  'POST send': [sending.send, 'send'],
  'GET templates': [sending.listTemplates, 'api'],
  'POST billing/quote': [billing.quote, 'billing'],
  'POST billing/checkout': [billing.checkout, 'billing'],
  'POST billing/upi': [billing.submitUtr, 'billing'],
  'POST billing/razorpay/verify': [billing.rzpVerify, 'billing'],
  'POST billing/razorpay/sync': [billing.rzpSync, 'billing'],
  'GET billing/orders': [billing.orders, 'billing'],
  'GET admin/overview': [admin.overview, 'admin'],
  'GET admin/orders': [admin.listOrders, 'admin'],
  'POST admin/orders/approve': [admin.approve, 'admin'],
  'POST admin/orders/reject': [admin.reject, 'admin'],
  'GET admin/coupons': [admin.listCoupons, 'admin'],
  'POST admin/coupons': [admin.createCoupon, 'admin'],
  'POST admin/coupons/toggle': [admin.toggleCoupon, 'admin'],
  'GET admin/users': [admin.findUsers, 'admin'],
  'POST admin/users/plan': [admin.setPlan, 'admin'],
};
const PATHS = new Set(Object.keys(ROUTES).map((k) => k.split(' ')[1]));
const SUSPICIOUS = new Set(['BAD_JSON', 'TOO_LARGE']);

function routePath(req) {
  const url = new URL(req.url || '/', 'http://localhost');
  // Vercel rewrites /api/<path> to /api/index?__p=<path>; Express passes the real path.
  const p = url.searchParams.has('__p') ? url.searchParams.get('__p') : url.pathname.replace(/^\/api(?=\/|$)/, '');
  return { path: String(p || '').replace(/^\/+|\/+$/g, '').slice(0, 100), query: url.searchParams };
}

async function handle(req, res) {
  const ip = clientIp(req);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');

  const blocked = guard.blockedFor(ip);
  if (blocked) return guard.tooMany(res, blocked, 'BLOCKED', `Too many unusual requests from your network. Access is paused for ${guard.fmtWait(blocked)}.`);

  const { path, query } = routePath(req);
  const route = ROUTES[`${req.method} ${path}`];
  if (!route) {
    guard.strike(ip, `404:${path}`);
    if (PATHS.has(path)) return json(res, 405, { ok: false, code: 'METHOD', error: 'Method not allowed.' });
    return json(res, 404, { ok: false, code: 'NOT_FOUND', error: 'Unknown API route.' });
  }

  const wait = guard.hit(ip, route[1]);
  if (wait) return guard.tooMany(res, wait, 'RATE_LIMIT', 'Too many requests. Please slow down a little.');

  if (req.method === 'POST') {
    // Cross-site request forgery defence (together with SameSite cookies).
    if (!guard.isJsonRequest(req)) { guard.strike(ip, 'content-type'); return json(res, 415, { ok: false, code: 'BAD_TYPE', error: 'Send JSON.' }); }
    if (!guard.sameOrigin(req)) { guard.strike(ip, 'origin'); return json(res, 403, { ok: false, code: 'BAD_ORIGIN', error: 'Request blocked.' }); }
  }

  try {
    await route[0](req, res, { ip, query });
  } catch (err) {
    if (err instanceof HttpError) {
      if (SUSPICIOUS.has(err.code)) guard.strike(ip, err.code);
      const headers = err.extra && err.extra.retryAfter ? { 'Retry-After': String(err.extra.retryAfter) } : undefined;
      return json(res, err.status, { ok: false, code: err.code, error: err.message, ...(err.extra || {}) }, headers);
    }
    const dbDown = /DATABASE_URL|ECONNREFUSED|fetch failed|Couldn't connect|terminating connection/i.test(String(err && err.message));
    console.error('[api]', path, err && (err.stack || err.message));
    if (dbDown) return json(res, 503, { ok: false, code: 'UNAVAILABLE', error: 'The service is temporarily unavailable. Please try again in a minute.' });
    return json(res, 500, { ok: false, code: 'SERVER', error: 'Unexpected server error. Please try again.' });
  }
}

module.exports = { handle, ROUTES };
