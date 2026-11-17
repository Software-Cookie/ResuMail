'use strict';
/** SEO + static page helpers shared by the build script (Vercel) and the local Express server. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PAGES = [
  { loc: '/', priority: '1.0', changefreq: 'weekly' },
  { loc: '/privacy.html', priority: '0.3', changefreq: 'yearly' },
  { loc: '/terms.html', priority: '0.3', changefreq: 'yearly' },
  { loc: '/refund.html', priority: '0.3', changefreq: 'yearly' },
];

function siteUrl(fallbackPort) {
  const raw = process.env.SITE_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')
    || `http://localhost:${fallbackPort || process.env.PORT || 3000}`;
  return raw.replace(/\/+$/, '');
}

const supportEmail = () => {
  const e = String(process.env.SUPPORT_EMAIL || '').trim();
  return /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(e) ? e : '';
};

/** Fills %SITE_URL% / %SUPPORT_EMAIL%, drops <!--support-->…<!--/support--> when no email, versions assets. */
function renderHtml(html, { site, version } = {}) {
  const email = supportEmail();
  let out = html.replace(/%SITE_URL%/g, site).replace(/%SUPPORT_EMAIL%/g, email);
  out = email
    ? out.replace(/<!--support-->|<!--\/support-->/g, '')
    : out.replace(/<!--support-->[\s\S]*?<!--\/support-->/g, '');
  if (version) {
    out = out.replace(/(\s(?:href|src)=")((?!https?:|\/\/|data:|#|mailto:)[^"?#]+\.(?:css|js))"/g,
      (m, pre, file) => { const v = version(file); return v ? `${pre}${file}?v=${v}"` : m; });
  }
  return out;
}

const robotsTxt = (site) => `User-agent: *\nAllow: /\nDisallow: /admin.html\nDisallow: /api/\n\nSitemap: ${site}/sitemap.xml\n`;

function sitemapXml(site, lastmod = new Date().toISOString().slice(0, 10)) {
  const urls = PAGES.map((p) => `  <url><loc>${site}${p.loc}</loc><lastmod>${lastmod}</lastmod><changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

/** sha256 hashes of executable inline <script> blocks, for the Content-Security-Policy. */
function inlineScriptHashes(html) {
  const out = [];
  const re = /<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) out.push(`'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
  return out;
}

/** Header rules from vercel.json, so local Express and Vercel send identical headers. */
function headerRules(root) {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  return (cfg.headers || []).map((h) => ({ re: new RegExp(`^${h.source}$`), headers: h.headers }));
}

module.exports = { PAGES, siteUrl, supportEmail, renderHtml, robotsTxt, sitemapXml, inlineScriptHashes, headerRules };
