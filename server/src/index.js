import { config } from './config.js';
import { initDb } from './db/index.js';
import { createApp } from './app.js';
import { sweepOfflineDevices } from './services/deviceStatus.js';
import { promoteScheduled } from './routes/announcements.js';

const driver = initDb();
const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`SeeWater API listening on http://localhost:${config.port} (db: ${driver.name})`);
});

// Background housekeeping: offline detection and scheduled announcements.
const sweep = setInterval(async () => {
  try {
    await sweepOfflineDevices();
    await promoteScheduled();
  } catch (err) {
    console.error('[sweep] failed', err);
  }
}, 60_000);

async function shutdown() {
  clearInterval(sweep);
  server.close();
  await driver.close?.();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
