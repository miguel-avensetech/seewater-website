import { config } from '../config.js';
import { createFirestoreDriver } from './firestoreDriver.js';
import { createLocalDriver } from './localDriver.js';
import { withLiveSync } from '../services/live.js';

export { C } from './collections.js';

let driver = null;

export function initDb(override) {
  if (override) {
    driver = override;
  } else if (config.dbDriver === 'local') {
    if (config.isProduction) throw new Error('DB_DRIVER=local is not allowed in production.');
    driver = createLocalDriver({ file: config.localDbFile });
  } else if (config.dbDriver === 'firestore') {
    // Firestore is the system of record; writes also refresh the Realtime Database live mirror.
    driver = withLiveSync(createFirestoreDriver());
  } else {
    throw new Error(`Unknown DB_DRIVER "${config.dbDriver}". Use "firestore" or "local".`);
  }
  return driver;
}

// Services import `db` and call db.get/list/create/update/remove/count.
export const db = new Proxy(
  {},
  {
    get(_target, prop) {
      if (!driver) throw new Error('Database not initialised. Call initDb() first.');
      return driver[prop];
    },
  },
);
