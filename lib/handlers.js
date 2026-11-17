'use strict';
/**
 * ResuMail API handlers.
 * Written against the plain Node (req, res) API so the same code runs
 * under Express (server.js) and as Vercel serverless functions (api/*.js).
 */
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const nodemailer = require('nodemailer');

try { if (typeof process.loadEnvFile === 'function') process.loadEnvFile(); } catch (_) { /* no .env file */ }

const MAX_ATTACHMENT_BYTES = 2.5 * 1024 * 1024; // keeps request bodies under Vercel's 4.5 MB limit
const MAX_BODY_BYTES = 5 * 1024 * 1024;

const PROVIDERS = {
  gmail: { host: 'smtp.gmail.com', port: 465, secure: true },
  yahoo: { host: 'smtp.mail.yahoo.com', port: 465, secure: true },
  zoho: { host: 'smtp.zoho.com', port: 465, secure: true },
  zoho_in: { host: 'smtp.zoho.in', port: 465, secure: true },
  brevo: { host: 'smtp-relay.brevo.com', port: 587, secure: false },
};
const ALLOWED_CUSTOM_PORTS = new Set([25, 465, 587, 2525]);
const ALLOWED_EXT = /\.(pdf|docx?|txt|rtf|odt)$/i;

const EMAIL_RE = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const isEmail = (s) => typeof s === 'string' && s.length <= 254 && EMAIL_RE.test(s);
const str = (v, max = 1000) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
const oneLine = (v, max) => str(v, max).replace(/[\r\n\t]+/g, ' ').trim();

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

/* ---------- server-side sender (optional, from environment) ---------- */
const ACCESS_KEY = process.env.ACCESS_KEY || '';
const ENV_SENDER = process.env.SMTP_USER && process.env.SMTP_PASS ? {
  host: process.env.SMTP_HOST || PROVIDERS.gmail.host,
  port: Number(process.env.SMTP_PORT) || PROVIDERS.gmail.port,
  secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : (Number(process.env.SMTP_PORT) || 465) === 465,
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS,
  fromName: process.env.SMTP_FROM_NAME || '',
  fromEmail: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER,
  trusted: true,
} : null;
const serverSenderEnabled = () => !!(ENV_SENDER && ACCESS_KEY);

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(str(a)).digest();
  const hb = crypto.createHash('sha256').update(str(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function maskEmail(e) {
  const [u, d] = String(e).split('@');
  if (!d) return '***';
  return `${u.slice(0, 2)}${'*'.repeat(Math.max(1, u.length - 2))}@${d}`;
}

/* ---------- tiny helpers for raw Node responses ---------- */
function json(res, status, data) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

const hits = new Map();
function rateLimit(req, res, bucket, limit, windowMs) {
  const key = `${bucket}:${clientIp(req)}`;
  const now = Date.now();
  let e = hits.get(key);
  if (!e || now - e.start > windowMs) { e = { start: now, count: 0 }; hits.set(key, e); }
  e.count += 1;
  if (e.count > limit) {
    json(res, 429, { ok: false, code: 'RATE_LIMIT', error: 'Too many requests. Please slow down a little.' });
    return false;
  }
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of hits) if (now - e.start > 120000) hits.delete(k);
}, 60000).unref();

function allowMethod(req, res, method) {
  if (req.method === method) return true;
  res.setHeader('Allow', method);
  json(res, 405, { ok: false, code: 'METHOD', error: `Use ${method}.` });
  return false;
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return parseJson(req.body);
  if (Buffer.isBuffer(req.body)) return parseJson(req.body.toString('utf8'));
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'TOO_LARGE', 'Request is too large. Use a resume under 2.5 MB.');
    chunks.push(chunk);
  }
  return parseJson(Buffer.concat(chunks).toString('utf8'));
}
function parseJson(text) {
  if (!text) return {};
  try { return JSON.parse(text); } catch (_) { throw new HttpError(400, 'BAD_JSON', 'Malformed request.'); }
}

/* ---------- SSRF guard for custom SMTP hosts ---------- */
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}
async function assertPublicHost(host) {
  if (!/^[a-z0-9.-]{3,253}$/i.test(host) || !host.includes('.')) {
    throw new HttpError(400, 'BAD_HOST', 'Enter a valid SMTP host, e.g. smtp.example.com');
  }
  let addrs;
  try { addrs = await dns.lookup(host, { all: true }); } catch (_) {
    throw new HttpError(400, 'BAD_HOST', `Could not find the SMTP host "${host}".`);
  }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
    throw new HttpError(400, 'BAD_HOST', 'That SMTP host is not allowed.');
  }
}

/* ---------- resolve sender settings from the request ---------- */
async function resolveSender(body) {
  const smtp = body && typeof body.smtp === 'object' && body.smtp ? body.smtp : {};

  if (smtp.useServer) {
    if (!serverSenderEnabled()) throw new HttpError(400, 'NO_SERVER_SENDER', 'No sender is configured on this server.');
    if (!safeEqual(body.accessKey, ACCESS_KEY)) throw new HttpError(401, 'BAD_KEY', 'The access key is not correct.');
    return ENV_SENDER;
  }

  const provider = str(smtp.provider, 20) || 'gmail';
  const user = oneLine(smtp.user, 254);
  let pass = str(smtp.pass, 256);
  if (provider === 'gmail') pass = pass.replace(/\s+/g, ''); // Google shows app passwords as "abcd efgh ijkl mnop"
  if (!user) throw new HttpError(400, 'BAD_SENDER', 'Enter your sender email / SMTP login.');
  if (!pass) throw new HttpError(400, 'BAD_SENDER', 'Enter your app password.');

  let cfg;
  if (provider === 'custom') {
    const host = oneLine(smtp.host, 253).toLowerCase();
    const port = Number(smtp.port);
    if (!ALLOWED_CUSTOM_PORTS.has(port)) throw new HttpError(400, 'BAD_HOST', 'SMTP port must be 25, 465, 587 or 2525.');
    await assertPublicHost(host);
    cfg = { host, port, secure: port === 465 };
  } else if (PROVIDERS[provider]) {
    cfg = PROVIDERS[provider];
  } else {
    throw new HttpError(400, 'BAD_SENDER', 'Unknown email provider.');
  }

  const fromEmail = oneLine(smtp.fromEmail, 254) || user;
  if (!isEmail(fromEmail)) {
    throw new HttpError(400, 'BAD_SENDER', provider === 'brevo' || provider === 'custom'
      ? 'Enter a valid "From" email address.'
      : 'Enter a valid sender email address.');
  }
  return { ...cfg, user, pass, fromName: oneLine(smtp.fromName, 80).replace(/["<>]/g, ''), fromEmail };
}

/* ---------- pooled transports (reused between requests = lower latency) ---------- */
const transports = new Map();
function transportKey(cfg) {
  return crypto.createHash('sha256').update([cfg.host, cfg.port, cfg.secure, cfg.user, cfg.pass].join('\u0000')).digest('hex');
}
function getTransport(cfg) {
  const key = transportKey(cfg);
  let entry = transports.get(key);
  if (!entry) {
    const transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      requireTLS: !cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
      // Serverless functions are frozen between requests, so pooled sockets go stale there.
      pool: !process.env.VERCEL,
      maxConnections: 2,
      maxMessages: 100,
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 30000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    entry = { transport, last: Date.now() };
    transports.set(key, entry);
  }
  entry.last = Date.now();
  return { transport: entry.transport, key };
}
function dropTransport(key) {
  const entry = transports.get(key);
  if (entry) { try { entry.transport.close(); } catch (_) { /* ignore */ } transports.delete(key); }
}
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of transports) if (now - e.last > 5 * 60000) dropTransport(k);
}, 60000).unref();

/* ---------- friendly SMTP errors ---------- */
function mapError(err) {
  if (err instanceof HttpError) return err;
  const code = err && err.code;
  const rc = Number(err && err.responseCode) || 0;
  const text = String((err && (err.response || err.message)) || '');

  if (code === 'EAUTH' || rc === 535 || rc === 534) {
    return new HttpError(401, 'AUTH', 'Sign-in failed. For Gmail, use a 16-character App Password (not your normal password) and make sure 2-Step Verification is turned on.');
  }
  if (/daily (user )?sending (quota|limit)|sending limit exceeded|5\.4\.5|quota exceeded/i.test(text)) {
    return new HttpError(429, 'LIMIT', 'Your email provider\'s daily sending limit was reached. Try again in 24 hours.');
  }
  if ([421, 450, 451, 452, 454].includes(rc)) {
    return new HttpError(503, 'THROTTLED', 'The mail server is busy or rate-limiting. It will retry automatically.');
  }
  if (code === 'EENVELOPE' || [550, 551, 553, 501].includes(rc)) {
    return new HttpError(422, 'RECIPIENT', 'The mail server rejected this recipient address.');
  }
  if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'EHOSTUNREACH', 'ETLS'].includes(code)) {
    return new HttpError(502, 'CONNECTION', 'Could not connect to the mail server. Check your internet connection or SMTP settings.');
  }
  return new HttpError(500, 'SEND_FAILED', `Sending failed: ${text.slice(0, 180) || 'unknown error'}`);
}
function sendError(res, err) {
  const e = mapError(err);
  if (e.status >= 500 && e.code === 'SEND_FAILED') console.error('[resumail]', err && err.message);
  json(res, e.status, { ok: false, code: e.code, error: e.message });
}

/* ---------- message building ---------- */
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const LINK_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]]|www\.[^\s<]+[^\s<.,;:!?)\]]|(?:[a-z]{2,3}\.)?(?:linkedin|github)\.com\/[^\s<]*[^\s<.,;:!?)\]]|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
function linkify(escaped) {
  return escaped.replace(LINK_RE, (m) => {
    const isMail = m.includes('@') && !m.includes('/');
    const href = isMail ? `mailto:${m}` : /^https?:/i.test(m) ? m : `https://${m}`;
    return `<a href="${href}" style="color:#0f766e">${m}</a>`;
  });
}
function textToHtml(text) {
  const paras = text.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${linkify(escapeHtml(p)).replace(/\n/g, '<br>')}</p>`);
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1f2933">${paras.join('')}</div>`;
}

function buildAttachment(a) {
  if (!a) return null;
  const filename = oneLine(a.filename, 120).replace(/[^\w.\- ()]/g, '_') || 'resume.pdf';
  if (!ALLOWED_EXT.test(filename)) throw new HttpError(400, 'BAD_ATTACHMENT', 'Resume must be a PDF, DOC, DOCX or TXT file.');
  const b64 = str(a.base64, 4 * 1024 * 1024);
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(b64)) throw new HttpError(400, 'BAD_ATTACHMENT', 'Resume file could not be read.');
  const content = Buffer.from(b64, 'base64');
  if (!content.length) throw new HttpError(400, 'BAD_ATTACHMENT', 'Resume file is empty.');
  if (content.length > MAX_ATTACHMENT_BYTES) throw new HttpError(413, 'TOO_LARGE', 'Resume must be under 2.5 MB.');
  return { filename, content, contentType: oneLine(a.contentType, 100) || undefined };
}

/* ---------- handlers ---------- */
async function health(req, res) {
  json(res, 200, { ok: true, service: 'resumail', time: new Date().toISOString() });
}

async function config(req, res) {
  json(res, 200, {
    ok: true,
    serverSender: serverSenderEnabled(),
    serverFrom: serverSenderEnabled() ? maskEmail(ENV_SENDER.fromEmail) : null,
    maxAttachmentBytes: MAX_ATTACHMENT_BYTES,
  });
}

async function verify(req, res) {
  if (!allowMethod(req, res, 'POST')) return;
  if (!rateLimit(req, res, 'verify', 15, 60000)) return;
  let key;
  try {
    const body = await readBody(req);
    const cfg = await resolveSender(body);
    const t = getTransport(cfg);
    key = t.key;
    await t.transport.verify();
    json(res, 200, { ok: true, from: cfg.trusted ? maskEmail(cfg.fromEmail) : cfg.fromEmail });
  } catch (err) {
    if (key) dropTransport(key);
    sendError(res, err);
  }
}

async function send(req, res) {
  if (!allowMethod(req, res, 'POST')) return;
  if (!rateLimit(req, res, 'send', 40, 60000)) return;
  let key;
  try {
    const body = await readBody(req);
    const to = oneLine(body.to, 254);
    if (!isEmail(to)) throw new HttpError(422, 'RECIPIENT', 'Invalid recipient email address.');
    const subject = oneLine(body.subject, 250);
    if (!subject) throw new HttpError(400, 'VALIDATION', 'Subject is empty.');
    const text = str(body.text, 20000).replace(/\r\n/g, '\n').trim();
    if (!text) throw new HttpError(400, 'VALIDATION', 'Email body is empty.');
    const attachment = buildAttachment(body.attachment);

    const cfg = await resolveSender(body);
    const t = getTransport(cfg);
    key = t.key;

    const info = await t.transport.sendMail({
      from: cfg.fromName ? { name: cfg.fromName, address: cfg.fromEmail } : cfg.fromEmail,
      to,
      replyTo: cfg.fromEmail,
      subject,
      text,
      html: textToHtml(text),
      attachments: attachment ? [attachment] : [],
    });

    if (info.rejected && info.rejected.length) {
      throw new HttpError(422, 'RECIPIENT', 'The mail server rejected this recipient address.');
    }
    json(res, 200, { ok: true, messageId: info.messageId });
  } catch (err) {
    const mapped = mapError(err);
    if (key && (mapped.code === 'AUTH' || mapped.code === 'CONNECTION')) dropTransport(key);
    sendError(res, mapped);
  }
}

module.exports = { health, config, verify, send, json, _internal: { textToHtml, mapError, isEmail, isPrivateIp } };
