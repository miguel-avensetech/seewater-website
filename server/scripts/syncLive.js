// Rebuilds the Realtime Database live mirror (/live) from Firestore.
//   npm run sync-live
import { initDb } from '../src/db/index.js';
import { rebuildLive } from '../src/services/live.js';

initDb();
const result = await rebuildLive();
console.log(`Live mirror rebuilt: ${result.devices} devices, ${result.alerts} active alerts.`);
process.exit(0);
