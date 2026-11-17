'use strict';
/** Verify a sender, send one email, and enforce each plan's quota and minimum gap on the server. */
const db = require('./db');
const { requireUser, publicUser, USER_COLS } = require('./auth');
const { PLANS, TEST_PER_DAY, effectivePlan, monthKey, dayKey, usage } = require('./plans');
const templates = require('./templates');
const { resolveSender, getTransport, dropTransport, mapError, textToHtml, buildAttachment } = require('./mail');
const { HttpError, json, readBody, isEmail, oneLine, str, sha256, maskEmail } = require('./util');

const GAP_SLACK = 0.5; // seconds of tolerance for network jitter
const RETURNING = 'RETURNING id, plan, credits, free_period, free_used, sent_total';

async function verify(req, res) {
  await requireUser(req);
  const body = await readBody(req);
  let key;
  try {
    const cfg = await resolveSender(body);
    const t = getTransport(cfg);
    key = t.key;
    await t.transport.verify();
    json(res, 200, { ok: true, from: cfg.trusted ? maskEmail(cfg.fromEmail) : cfg.fromEmail });
  } catch (err) {
    if (key) dropTransport(key);
    throw mapError(err);
  }
}

/**
 * Atomically takes one email from the user's allowance. Each UPDATE re-checks the plan, the
 * remaining quota and the minimum gap inside its WHERE clause, so two tabs (or a script) racing
 * each other can never send more, or faster, than the plan allows.
 */
async function reserve(user, senderEmail, attempt = 0) {
  const plan = effectivePlan(user);
  const gap = Math.max(0, PLANS[plan].minGap - GAP_SLACK);
  const gapOk = '(last_send_at IS NULL OR last_send_at <= now() - make_interval(secs => $2::double precision))';
  let rows;
  const r = { plan, userId: user.id };

  if (plan === 'premium') {
    rows = await db.query(
      `UPDATE users SET last_send_at = now(), sent_total = sent_total + 1
       WHERE id = $1 AND plan = 'premium' AND ${gapOk} ${RETURNING}`, [user.id, gap]);
  } else if (plan === 'trial' || plan === 'standard') {
    rows = await db.query(
      `UPDATE users SET credits = credits - 1, last_send_at = now(), sent_total = sent_total + 1
       WHERE id = $1 AND plan = $3 AND credits > 0 AND ${gapOk} ${RETURNING}`, [user.id, gap, plan]);
  } else {
    r.period = monthKey();
    r.senderHash = sha256(`sender:${String(senderEmail).toLowerCase()}`);
    // The free allowance is also counted per sending address, so new accounts can't reset it.
    const s = await db.one('SELECT used FROM sender_usage WHERE sender_hash = $1 AND period = $2', [r.senderHash, r.period]);
    if (s && s.used >= PLANS.free.monthly) {
      throw new HttpError(402, 'QUOTA', `This sending address has already used its ${PLANS.free.monthly} free emails this month. Upgrade to keep sending.`);
    }
    rows = await db.query(
      `WITH u AS (
         UPDATE users SET
           free_used = CASE WHEN free_period = $3 THEN free_used + 1 ELSE 1 END,
           free_period = $3, last_send_at = now(), sent_total = sent_total + 1
         WHERE id = $1
           AND NOT (plan = 'premium' OR (plan IN ('trial', 'standard') AND credits > 0))
           AND (CASE WHEN free_period = $3 THEN free_used ELSE 0 END) < $4
           AND ${gapOk}
         ${RETURNING}
       ), s AS (
         INSERT INTO sender_usage (sender_hash, period, used) SELECT $5, $3, 1 FROM u
         ON CONFLICT (sender_hash, period) DO UPDATE SET used = sender_usage.used + 1
         RETURNING used
       )
       SELECT u.*, (SELECT used FROM s) AS sender_used FROM u`,
      [user.id, gap, r.period, PLANS.free.monthly, r.senderHash]);
  }
  if (rows.length) return { ...r, row: rows[0] };

  // Nothing updated: find out why (plan changed meanwhile, gap too short, or out of emails).
  const cur = await db.one(
    `SELECT ${USER_COLS}, EXTRACT(EPOCH FROM (now() - u.last_send_at))::float AS since FROM users u WHERE u.id = $1`, [user.id]);
  if (!cur) throw new HttpError(401, 'AUTH_REQUIRED', 'Please sign in to continue.');
  const nowPlan = effectivePlan(cur);
  if (nowPlan !== plan && attempt === 0) return reserve(cur, senderEmail, 1);
  const minGap = PLANS[nowPlan].minGap;
  if (cur.since != null && cur.since < minGap - GAP_SLACK) {
    const wait = Math.max(1, Math.ceil(minGap - cur.since));
    throw new HttpError(429, 'GAP', `Your ${PLANS[nowPlan].name} plan sends one email every ${minGap} seconds. Next one in ${wait}s.`, { retryAfter: wait, usage: usage(cur) });
  }
  const msg = nowPlan === 'free'
    ? `You've used all ${PLANS.free.monthly} free emails for this month. Upgrade to keep sending, or wait until the 1st.`
    : 'Your email pack is used up. Buy another pack or upgrade to keep sending.';
  throw new HttpError(402, 'QUOTA', msg, { usage: usage(cur) });
}

/** Gives the email back when it could not be sent. */
async function refund(r) {
  if (r.plan === 'premium') {
    await db.query('UPDATE users SET last_send_at = NULL, sent_total = GREATEST(sent_total - 1, 0) WHERE id = $1', [r.userId]);
  } else if (r.plan === 'trial' || r.plan === 'standard') {
    await db.query('UPDATE users SET credits = credits + 1, last_send_at = NULL, sent_total = GREATEST(sent_total - 1, 0) WHERE id = $1', [r.userId]);
  } else {
    await db.tx([
      ['UPDATE users SET free_used = GREATEST(free_used - 1, 0), last_send_at = NULL, sent_total = GREATEST(sent_total - 1, 0) WHERE id = $1 AND free_period = $2', [r.userId, r.period]],
      ['UPDATE sender_usage SET used = GREATEST(used - 1, 0) WHERE sender_hash = $1 AND period = $2', [r.senderHash, r.period]],
    ]);
  }
}

async function useTestAllowance(user) {
  const day = dayKey();
  const row = await db.one(
    `UPDATE users SET test_used = CASE WHEN test_day = $2 THEN test_used + 1 ELSE 1 END, test_day = $2
     WHERE id = $1 AND (CASE WHEN test_day = $2 THEN test_used ELSE 0 END) < $3 RETURNING test_used`,
    [user.id, day, TEST_PER_DAY]);
  if (!row) throw new HttpError(429, 'TEST_LIMIT', `You can send up to ${TEST_PER_DAY} test emails a day. Try again tomorrow.`);
}

async function send(req, res) {
  const user = await requireUser(req);
  const body = await readBody(req, 5 * 1024 * 1024);
  const isTest = body.test === true;
  const subject = oneLine(body.subject, 250);
  if (!subject) throw new HttpError(400, 'VALIDATION', 'Subject is empty.');
  const text = str(body.text, 20000).replace(/\r\n/g, '\n').trim();
  if (!text) throw new HttpError(400, 'VALIDATION', 'Email body is empty.');
  const attachment = buildAttachment(body.attachment);
  let to = oneLine(body.to, 254);
  if (!isTest && !isEmail(to)) throw new HttpError(422, 'RECIPIENT', 'Invalid recipient email address.');

  const cfg = await resolveSender(body).catch((e) => { throw mapError(e); });
  let reservation = null;
  if (isTest) {
    to = cfg.trusted ? user.email : cfg.fromEmail; // tests only ever go to yourself
    await useTestAllowance(user);
  } else {
    reservation = await reserve(user, cfg.fromEmail);
  }

  let key;
  try {
    const t = getTransport(cfg);
    key = t.key;
    const info = await t.transport.sendMail({
      from: cfg.fromName ? { name: cfg.fromName, address: cfg.fromEmail } : cfg.fromEmail,
      to,
      replyTo: cfg.fromEmail,
      subject: isTest ? `[Test] ${subject.replace(/^\[Test\]\s*/i, '')}` : subject,
      text,
      html: textToHtml(text),
      attachments: attachment ? [attachment] : [],
    });
    if (info.rejected && info.rejected.length) throw new HttpError(422, 'RECIPIENT', 'The mail server rejected this recipient address.');
    const u = reservation ? { ...user, ...reservation.row } : user;
    json(res, 200, { ok: true, to: isTest ? to : undefined, messageId: info.messageId, usage: usage(u) });
  } catch (err) {
    if (reservation) await refund(reservation).catch((e) => console.error('[send] refund failed', e && e.message));
    const mapped = mapError(err);
    if (key && (mapped.code === 'AUTH' || mapped.code === 'CONNECTION')) dropTransport(key);
    if (mapped.code === 'SEND_FAILED') console.error('[send]', err && err.message);
    throw mapped;
  }
}

async function listTemplates(req, res) {
  const user = await requireUser(req);
  const plan = effectivePlan(user);
  if (!PLANS[plan].templates) {
    throw new HttpError(403, 'PLAN_REQUIRED', 'Templates are included in the Trial, Standard and Premium plans.', { user: publicUser(user) });
  }
  json(res, 200, { ok: true, templates: templates.full() });
}

module.exports = { verify, send, listTemplates, _internal: { reserve, refund } };
