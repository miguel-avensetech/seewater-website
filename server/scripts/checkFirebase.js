// Verifies the server can reach every Firebase service it uses.
//   npm run check-firebase
import { config } from '../src/config.js';
import { adminAuth, adminBucket, adminDatabase, adminFirestore } from '../src/lib/firebaseAdmin.js';

const results = [];
async function check(name, fn, hint) {
  try {
    results.push([name, 'OK', await fn()]);
  } catch (err) {
    results.push([name, 'FAILED', `${err.message.split('\n')[0]}${hint ? ` → ${hint}` : ''}`]);
  }
}

console.log(`Project: ${config.firebase.projectId}${config.firebase.emulators ? ' (emulators)' : ''}\n`);
try {
  adminAuth();
} catch (err) {
  console.error(`FAILED   Credentials        ${err.message}`);
  process.exit(1);
}
await check('Authentication', async () => `${(await adminAuth().listUsers(1)).users.length ? 'has users' : 'no users yet'}`, 'Console → Authentication → Get started, enable Email/Password');
await check('Firestore', async () => `${(await adminFirestore().listCollections()).length} collections`, 'Console → Firestore Database → Create database');
await check('Realtime Database', async () => {
  await adminDatabase().ref('live').get();
  return config.firebase.databaseURL ?? 'default URL';
}, 'Check FIREBASE_DATABASE_URL');
if (config.firebase.storageEnabled) {
  await check('Storage', async () => {
    if (config.firebase.emulators) return 'emulator';
    const [exists] = await adminBucket().exists();
    if (!exists) throw new Error('bucket not found');
    return adminBucket().name;
  }, 'Console → Storage → Get started (Blaze plan), or set FIREBASE_STORAGE_ENABLED=false');
} else results.push(['Storage', 'SKIPPED', 'FIREBASE_STORAGE_ENABLED=false']);

for (const [name, status, detail] of results) console.log(`${status.padEnd(8)} ${name.padEnd(18)} ${detail}`);
process.exit(results.some(([, s]) => s === 'FAILED') ? 1 : 0);
