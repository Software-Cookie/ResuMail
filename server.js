'use strict';
const path = require('path');
const express = require('express');
const api = require('./lib/handlers');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.disable('x-powered-by');
app.set('trust proxy', true);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

app.use('/api', express.json({ limit: '5mb' }));
app.get('/api/health', api.health);
app.get('/api/config', api.config);
app.all('/api/verify', api.verify);
app.all('/api/send', api.send);
app.use('/api', (req, res) => api.json(res, 404, { ok: false, code: 'NOT_FOUND', error: 'Unknown API route.' }));

app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  setHeaders(res, filePath) {
    res.setHeader('Cache-Control', filePath.includes(`${path.sep}vendor${path.sep}`)
      ? 'public, max-age=604800, immutable'
      : 'no-cache');
  },
}));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') return api.json(res, 413, { ok: false, code: 'TOO_LARGE', error: 'Request is too large. Use a resume under 2.5 MB.' });
  if (err && err.type === 'entity.parse.failed') return api.json(res, 400, { ok: false, code: 'BAD_JSON', error: 'Malformed request.' });
  console.error('[resumail]', err);
  api.json(res, 500, { ok: false, code: 'SERVER', error: 'Unexpected server error.' });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`ResuMail is running at http://localhost:${PORT}`));
}

module.exports = app;
