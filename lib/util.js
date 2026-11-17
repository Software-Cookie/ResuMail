'use strict';
/** Small shared helpers: errors, JSON responses, body parsing, crypto helpers. */
const crypto = require('crypto');

try { if (typeof process.loadEnvFile === 'function') process.loadEnvFile(); } catch (_) { /* no .env file */ }

class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra || null;
  }
}

const EMAIL_RE = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const isEmail = (s) => typeof s === 'string' && s.length <= 254 && EMAIL_RE.test(s);
const str = (v, max = 1000) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
const oneLine = (v, max) => str(v, max).replace(/[\r\n\t]+/g, ' ').trim();
const normEmail = (v) => oneLine(v, 254).toLowerCase();

function json(res, status, data, headers) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (headers) for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(data));
}

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/** Constant-time comparison of two strings of any length. */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(str(a, 10000)).digest();
  const hb = crypto.createHash('sha256').update(str(b, 10000)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/** Unbiased random code from a 32-character alphabet without look-alikes (no 0/O, 1/I). */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomCode(len) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (const b of bytes) out += ALPHABET[b & 31];
  return out;
}

/**
 * The visitor's IP. On Vercel the platform sets x-real-ip / x-forwarded-for itself,
 * so they can't be spoofed. Elsewhere we only trust them when TRUST_PROXY=1.
 */
function clientIp(req) {
  const h = req.headers || {};
  if (process.env.VERCEL || process.env.TRUST_PROXY === '1') {
    if (h['x-real-ip']) return String(h['x-real-ip']).trim().slice(0, 64);
    if (h['x-forwarded-for']) return String(h['x-forwarded-for']).split(',')[0].trim().slice(0, 64);
  }
  return ((req.socket && req.socket.remoteAddress) || 'unknown').replace(/^::ffff:/, '');
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers && req.headers.cookie;
  if (!raw) return out;
  for (const part of String(raw).split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    if (!(k in out)) out[k] = part.slice(i + 1).trim();
  }
  return out;
}

function isHttps(req) {
  if (process.env.VERCEL) return true;
  const proto = req.headers && req.headers['x-forwarded-proto'];
  return (process.env.TRUST_PROXY === '1' && proto === 'https') || !!(req.socket && req.socket.encrypted);
}

/** Reads a JSON body (works with Vercel's pre-parsed body and with a raw Node stream). */
async function readBody(req, limit = 32 * 1024) {
  let pre;
  try { pre = req.body; } catch (_) { throw new HttpError(400, 'BAD_JSON', 'Malformed request.'); }
  if (pre && typeof pre === 'object' && !Buffer.isBuffer(pre)) return pre;
  if (typeof pre === 'string') return parseJson(pre, limit);
  if (Buffer.isBuffer(pre)) return parseJson(pre.toString('utf8'), limit);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'TOO_LARGE', limit > 1e6 ? 'Request is too large. Use a resume under 2.5 MB.' : 'Request is too large.');
    chunks.push(chunk);
  }
  return parseJson(Buffer.concat(chunks).toString('utf8'), limit);
}
function parseJson(text, limit) {
  if (!text) return {};
  if (text.length > limit * 1.05) throw new HttpError(413, 'TOO_LARGE', 'Request is too large.');
  let v;
  try { v = JSON.parse(text); } catch (_) { throw new HttpError(400, 'BAD_JSON', 'Malformed request.'); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'BAD_JSON', 'Malformed request.');
  return v;
}

function maskEmail(e) {
  const [u, d] = String(e).split('@');
  if (!d) return '***';
  return `${u.slice(0, 2)}${'*'.repeat(Math.max(1, u.length - 2))}@${d}`;
}

module.exports = {
  HttpError, json, isEmail, str, oneLine, normEmail, sha256, safeEqual, randomToken, randomCode,
  clientIp, parseCookies, isHttps, readBody, maskEmail,
};
