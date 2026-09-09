const config = require('./config');
const db = require('./db');
const { createApp } = require('./app');

async function start() {
  try {
    await db.initDb();
    const app = createApp();
    app.listen(config.port, () => {
      console.log(`[server] Listening on http://localhost:${config.port}`);
      console.log(`[server] Admin UI: http://localhost:${config.port}/admin/login`);
      console.log(`[server] SQL Server: ${config.db.server}/${config.db.database}`);
    });
  } catch (err) {
    console.error('[server] Failed to start:', err.message);
    process.exit(1);
  }
}

start();
