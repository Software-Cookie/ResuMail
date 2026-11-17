'use strict';
/**
 * Creates or updates the database tables. The app also does this automatically on first use;
 * run it yourself to check a new DATABASE_URL:  npm run db:migrate
 */
const db = require('../lib/db');

(async () => {
  const t = Date.now();
  const rows = await db.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
  console.log(`Database ready in ${Date.now() - t} ms. Tables: ${rows.map((r) => r.table_name).join(', ')}`);
  await db.close();
})().catch((e) => {
  console.error('Migration failed:', e.message);
  process.exit(1);
});
