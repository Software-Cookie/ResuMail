'use strict';
/**
 * Local / any-Node-host server. On Vercel the same API runs as api/index.js and static files come
 * from the build output; this server reproduces that setup (same headers, same router).
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const router = require('./lib/router');
const site = require('./lib/site');
const { isHttps } = require('./lib/util');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const RULES = site.headerRules(__dirname);

app.disable('x-powered-by');

app.use((req, res, next) => {
  const secure = isHttps(req);
  for (const rule of RULES) {
    if (!rule.re.test(req.path)) continue;
    for (const { key, value } of rule.headers) {
      if (key === 'Cache-Control') continue; // dev server: always revalidate
      if (key === 'Strict-Transport-Security' && !secure) continue;
      res.setHeader(key, key === 'Content-Security-Policy' && !secure ? value.replace(/;\s*upgrade-insecure-requests/, '') : value);
    }
  }
  next();
});

// API: one router for every /api/* path (same code as the Vercel function).
app.use('/api', (req, res) => { req.url = req.originalUrl; router.handle(req, res); });

const siteFor = (req) => process.env.SITE_URL || `${isHttps(req) ? 'https' : 'http'}://${req.headers.host || `localhost:${PORT}`}`;
app.get('/robots.txt', (req, res) => res.type('text/plain').send(site.robotsTxt(siteFor(req))));
app.get('/sitemap.xml', (req, res) => res.type('application/xml').send(site.sitemapXml(siteFor(req))));

// HTML pages get the same placeholder filling as the production build.
app.get(/^\/(?:[\w-]+\.html)?$/, (req, res, next) => {
  const file = path.join(PUBLIC, req.path === '/' ? 'index.html' : path.basename(req.path));
  fs.readFile(file, 'utf8', (err, html) => {
    if (err) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(site.renderHtml(html, { site: siteFor(req) }));
  });
});

app.use(express.static(PUBLIC, {
  etag: true,
  index: false,
  setHeaders(res, filePath) {
    res.setHeader('Cache-Control', filePath.includes(`${path.sep}vendor${path.sep}`) ? 'public, max-age=604800, immutable' : 'no-cache');
  },
}));

app.use((req, res) => {
  fs.readFile(path.join(PUBLIC, '404.html'), 'utf8', (err, html) => {
    res.status(404).type('html').send(err ? 'Not found' : site.renderHtml(html, { site: siteFor(req) }));
  });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[resumail]', err);
  res.status(500).json({ ok: false, code: 'SERVER', error: 'Unexpected server error.' });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`ResuMail is running at http://localhost:${PORT}`));
}

module.exports = app;
