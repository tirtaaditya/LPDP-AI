/**
 * Daily USD→IDR sync from LPDP Kurs API at 10:00 Asia/Jakarta (configurable hour).
 */
const cron = require('node-cron');
const kursService = require('../services/kurs.service');

let task = null;

async function runSync(reason) {
  try {
    console.log(`[kurs] Sync start (${reason})`);
    const result = await kursService.syncUsdToIdr({ force: false });
    if (result.skipped) {
      console.log(`[kurs] Skipped: ${result.reason}`);
      return result;
    }
    console.log(`[kurs] Sync OK usd_to_idr=${result.usdToIdr}`);
    return result;
  } catch (err) {
    console.error('[kurs] Sync failed:', err.message);
    try {
      const db = require('../db');
      await db.setSetting('kurs_last_error', String(err.message || err).slice(0, 500));
      await db.setSetting('kurs_last_sync_at', new Date().toISOString());
    } catch {
      // ignore
    }
    return { error: err.message };
  }
}

async function startKursScheduler() {
  if (task) {
    task.stop();
    task = null;
  }

  let hour = 10;
  try {
    const cfg = await kursService.getKursConfig();
    hour = cfg.hour;
  } catch {
    hour = 10;
  }

  const expr = `0 ${hour} * * *`;
  if (!cron.validate(expr)) {
    console.error(`[kurs] Invalid cron: ${expr}`);
    return;
  }

  task = cron.schedule(
    expr,
    () => {
      runSync('scheduled');
    },
    { timezone: 'Asia/Jakarta' }
  );

  console.log(
    `[kurs] Scheduler armed: every day at ${String(hour).padStart(2, '0')}:00 Asia/Jakarta`
  );
}

module.exports = {
  startKursScheduler,
  runSync,
};
