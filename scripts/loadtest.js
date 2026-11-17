'use strict';
/**
 * Concurrency test: N simulated visitors open the site at the same moment.
 * Each one loads the page, its CSS/JS and calls /api/bootstrap; signed-in visitors also call /api/me.
 *
 *   node scripts/loadtest.js [baseUrl] [users]
 *   node scripts/loadtest.js http://localhost:3000 300
 *
 * Only point it at your own deployment. Every visitor uses a different fake IP header,
 * which the server ignores unless TRUST_PROXY=1 (so local runs share one IP and may hit rate limits).
 */
const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/+$/, '');
const USERS = Number(process.argv[3]) || 300;

async function timed(path, opts) {
  const t = performance.now();
  const r = await fetch(BASE + path, opts);
  await r.arrayBuffer();
  return { ms: performance.now() - t, status: r.status };
}

async function visitor(i, cookie) {
  const headers = { 'X-Forwarded-For': `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}` };
  if (cookie) headers.Cookie = cookie;
  const out = [];
  out.push(await timed('/', { headers }));
  out.push(...await Promise.all(['/styles.css', '/app.js', '/account.js'].map((p) => timed(p, { headers }))));
  out.push(await timed('/api/bootstrap', { headers }));
  if (cookie) out.push(await timed('/api/me', { headers }));
  return out;
}

function pct(arr, p) { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; }

(async () => {
  // One real account so part of the traffic exercises the database.
  const email = `load-${Date.now()}@example.com`;
  const res = await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Load Test', email, password: 'loadtest123', acceptTerms: true }),
  });
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];

  const t0 = performance.now();
  const results = await Promise.all(Array.from({ length: USERS }, (_, i) => visitor(i, i % 2 ? cookie : '').catch((e) => [{ ms: 0, status: `ERR ${e.cause ? e.cause.code : e.message}` }])));
  const wall = performance.now() - t0;
  const all = results.flat();
  const ok = all.filter((r) => r.status === 200);
  const byStatus = all.reduce((m, r) => { m[r.status] = (m[r.status] || 0) + 1; return m; }, {});
  const ms = ok.map((r) => r.ms);
  console.log(`${USERS} concurrent visitors, ${all.length} requests in ${(wall / 1000).toFixed(2)} s`);
  console.log('Status codes:', byStatus);
  console.log(`Latency  p50 ${pct(ms, 50).toFixed(0)} ms · p95 ${pct(ms, 95).toFixed(0)} ms · p99 ${pct(ms, 99).toFixed(0)} ms · max ${Math.max(...ms).toFixed(0)} ms`);
  console.log(`Throughput ≈ ${(all.length / (wall / 1000)).toFixed(0)} requests/s`);
})();
