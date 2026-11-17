'use strict';
/**
 * Production build (runs on Vercel): copies public/ to dist/, fills in the site URL for SEO tags,
 * adds content hashes to CSS/JS links (so they can be cached for a year), writes robots.txt and
 * sitemap.xml, and checks that every inline script is allowed by the Content-Security-Policy.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const site = require('../lib/site');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'dist');

const SITE = site.siteUrl();
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(SRC, OUT, { recursive: true });

const hashes = new Map();
const version = (file) => {
  const p = path.join(SRC, file);
  if (!fs.existsSync(p)) return '';
  if (!hashes.has(file)) hashes.set(file, crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 10));
  return hashes.get(file);
};

const vercel = fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8');
const missing = [];
for (const f of fs.readdirSync(OUT).filter((n) => n.endsWith('.html'))) {
  const p = path.join(OUT, f);
  const html = site.renderHtml(fs.readFileSync(p, 'utf8'), { site: SITE, version });
  for (const h of site.inlineScriptHashes(html)) if (!vercel.includes(h)) missing.push(`${f}: ${h}`);
  fs.writeFileSync(p, html);
}
if (missing.length) {
  console.error('Inline scripts not allowed by the CSP in vercel.json:\n  ' + missing.join('\n  '));
  process.exit(1);
}
for (const f of ['manifest.webmanifest']) {
  const p = path.join(OUT, f);
  if (fs.existsSync(p)) fs.writeFileSync(p, site.renderHtml(fs.readFileSync(p, 'utf8'), { site: SITE }));
}
fs.writeFileSync(path.join(OUT, 'robots.txt'), site.robotsTxt(SITE));
fs.writeFileSync(path.join(OUT, 'sitemap.xml'), site.sitemapXml(SITE));
console.log(`Built dist/ for ${SITE}${site.supportEmail() ? '' : ' (SUPPORT_EMAIL not set: contact lines hidden)'}`);
