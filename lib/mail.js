'use strict';
/** SMTP plumbing: providers, SSRF guard, pooled transports, friendly errors, message building. */
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const nodemailer = require('nodemailer');
const { HttpError, str, oneLine, isEmail, safeEqual } = require('./util');

const MAX_ATTACHMENT_BYTES = 2.5 * 1024 * 1024; // keeps request bodies under Vercel's 4.5 MB limit

const PROVIDERS = {
  gmail: { host: 'smtp.gmail.com', port: 465, secure: true },
  yahoo: { host: 'smtp.mail.yahoo.com', port: 465, secure: true },
  zoho: { host: 'smtp.zoho.com', port: 465, secure: true },
  zoho_in: { host: 'smtp.zoho.in', port: 465, secure: true },
  brevo: { host: 'smtp-relay.brevo.com', port: 587, secure: false },
};
const ALLOWED_CUSTOM_PORTS = new Set([25, 465, 587, 2525]);
const ALLOWED_EXT = /\.(pdf|docx?|txt|rtf|odt)$/i;

/* ---------- server-side sender (optional, from environment) ---------- */
const ACCESS_KEY = process.env.ACCESS_KEY || '';
const ENV_SENDER = process.env.SMTP_USER && process.env.SMTP_PASS ? {
  host: process.env.SMTP_HOST || PROVIDERS.gmail.host,
  port: Number(process.env.SMTP_PORT) || PROVIDERS.gmail.port,
  secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : (Number(process.env.SMTP_PORT) || 465) === 465,
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS.replace(/\s+/g, ''),
  fromName: process.env.SMTP_FROM_NAME || 'ResuMail',
  fromEmail: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER,
  trusted: true,
} : null;
const serverSenderEnabled = () => !!(ENV_SENDER && ACCESS_KEY.length >= 12);
const systemMailEnabled = () => !!ENV_SENDER;

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
  return addrs[0].address; // connect to this checked address, so DNS can't be switched afterwards
}

/* ---------- sender settings from the request ---------- */
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
    const address = await assertPublicHost(host);
    cfg = { host: address, servername: host, port, secure: port === 465 };
  } else if (Object.prototype.hasOwnProperty.call(PROVIDERS, provider)) {
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
  return crypto.createHash('sha256').update([cfg.servername || cfg.host, cfg.port, cfg.secure, cfg.user, cfg.pass].join('\u0000')).digest('hex');
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
      tls: cfg.servername ? { servername: cfg.servername } : undefined, // TLS certificate still checked against the real name
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
    if (transports.size > 500) { for (const k of transports.keys()) { dropTransport(k); break; } }
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
  return { filename, content, contentType: oneLine(a.contentType, 100).replace(/[^\w.+/-]/g, '') || undefined };
}

/** Sends a service email (password reset codes, payment notices) from the site's own account. */
async function systemMail(to, subject, text) {
  if (!ENV_SENDER || !isEmail(to)) return false;
  const { transport, key } = getTransport(ENV_SENDER);
  try {
    await transport.sendMail({
      from: { name: ENV_SENDER.fromName, address: ENV_SENDER.fromEmail },
      to, subject, text, html: textToHtml(text),
    });
    return true;
  } catch (err) {
    dropTransport(key);
    console.error('[mail] system mail failed:', err && err.code);
    return false;
  }
}

module.exports = {
  MAX_ATTACHMENT_BYTES, ENV_SENDER, serverSenderEnabled, systemMailEnabled, resolveSender, getTransport, dropTransport,
  mapError, textToHtml, buildAttachment, systemMail, isPrivateIp,
};
