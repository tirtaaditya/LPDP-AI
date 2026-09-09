const db = require('./index');

async function main() {
  try {
    await db.initDb();
    console.log('[init-db] Tables ready + default settings seeded.');
    process.exit(0);
  } catch (err) {
    console.error('[init-db] Failed:', err.message);
    process.exit(1);
  }
}

main();
