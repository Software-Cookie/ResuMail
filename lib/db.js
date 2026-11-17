'use strict';
/**
 * Database access. Production uses Neon serverless Postgres over HTTPS (no connection pool to
 * exhaust, ideal for serverless functions). Local development without DATABASE_URL uses PGlite,
 * an embedded Postgres, stored in ./.data/db.
 *
 * Every query in this app goes through query()/tx() with $1, $2 … parameters. User input is
 * never concatenated into SQL, which is what makes SQL injection impossible here.
 */
const fs = require('fs');
const path = require('path');
const { STATEMENTS, MARKER } = require('./schema');

let ready = null;

async function connect() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
  if (url) {
    const { neon } = require('@neondatabase/serverless');
    const sql = neon(url);
    return {
      kind: 'neon',
      query: (text, params) => sql.query(text, params || []),
      tx: (list) => sql.transaction(list.map(([text, params]) => sql.query(text, params || []))),
    };
  }
  if (process.env.VERCEL) throw new Error('DATABASE_URL is not configured.');
  return localDb();
}

async function localDb() {
  // Built from parts so Vercel's bundler never packs this dev-only dependency into the function.
  const name = ['@electric-sql', 'pglite'].join('/');
  const { PGlite } = await import(name);
  const dir = process.env.LOCAL_DB_DIR || path.join(__dirname, '..', '.data', 'db');
  let db;
  if (dir === ':memory:') db = new PGlite();
  else { fs.mkdirSync(dir, { recursive: true }); db = new PGlite(dir); }
  await db.waitReady;
  return {
    kind: 'pglite',
    query: async (text, params) => (await db.query(text, params || [])).rows,
    tx: (list) => db.transaction(async (t) => {
      const out = [];
      for (const [text, params] of list) out.push((await t.query(text, params || [])).rows);
      return out;
    }),
    close: () => db.close(),
  };
}

/** Creates/updates tables once per server instance. One cheap query when already up to date. */
async function migrate(d) {
  const [row] = await d.query("SELECT obj_description(to_regclass('public.users'), 'pg_class') AS marker");
  if (row && row.marker === MARKER) return;
  await d.tx([
    ['SELECT pg_advisory_xact_lock(4207061)'],
    ...STATEMENTS.map((s) => [s]),
    [`COMMENT ON TABLE users IS '${MARKER}'`],
  ]);
}

function get() {
  if (!ready) {
    ready = (async () => {
      const d = await connect();
      await migrate(d);
      return d;
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

const query = async (text, params) => (await get()).query(text, params);
const one = async (text, params) => (await query(text, params))[0] || null;
/** Runs several statements in one transaction (one round trip on Neon). Returns an array of row arrays. */
const tx = async (list) => (await get()).tx(list);
async function close() { if (ready) { const d = await ready.catch(() => null); ready = null; if (d && d.close) await d.close(); } }

const isUniqueViolation = (e) => !!e && (e.code === '23505' || /duplicate key/i.test(String(e.message)));

module.exports = { query, one, tx, close, isUniqueViolation, _get: get };
