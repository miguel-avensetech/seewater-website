// Trusted administrator initialisation (run on a machine that holds the
// service-account credentials, or against the Firebase emulators).
//
//   npm run create-admin -- --email admin@mcwd.gov.ph --name "Juan Dela Cruz" [--role super_admin|admin|viewer] [--department Operations]
//
// • Creates the Firebase Auth user if it doesn't exist (password from ADMIN_PASSWORD
//   or an interactive prompt), or promotes an existing Auth user.
// • Sets the custom claims { role: 'admin', adminRole } — the ONLY way an account
//   becomes an administrator. Nothing in the website or app can grant this.
// • Creates/updates the admins/{uid} profile in Firestore.
//
//   npm run create-admin -- --email someone@example.com --revoke   removes admin access

import readline from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { initDb, db, C } from '../src/db/index.js';
import { adminAuth } from '../src/lib/firebaseAdmin.js';
import { ROLES } from '../src/middleware/auth.js';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string', default: 'super_admin' },
    department: { type: 'string', default: 'Operations' },
    revoke: { type: 'boolean', default: false },
  },
});

const email = values.email?.trim().toLowerCase();
if (!email || (!values.revoke && !values.name)) {
  console.error('Usage: npm run create-admin -- --email <email> --name "<full name>" [--role super_admin|admin|viewer]');
  process.exit(1);
}
if (!ROLES.includes(values.role)) {
  console.error(`Role must be one of: ${ROLES.join(', ')}`);
  process.exit(1);
}

initDb();
const auth = adminAuth();

let user = await auth.getUserByEmail(email).catch((err) => (err.code === 'auth/user-not-found' ? null : Promise.reject(err)));

if (values.revoke) {
  if (!user) {
    console.error('No such user.');
    process.exit(1);
  }
  const { role, adminRole, ...rest } = user.customClaims ?? {};
  await auth.setCustomUserClaims(user.uid, rest);
  await auth.revokeRefreshTokens(user.uid);
  await db.update(C.admins, user.uid, { status: 'disabled', updatedAt: new Date().toISOString() });
  console.log(`Removed admin access from ${email}.`);
  process.exit(0);
}

if (!user) {
  const password = process.env.ADMIN_PASSWORD || (await prompt('Password (min 10 chars, letters and numbers): '));
  if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    console.error('Password must be at least 10 characters and include letters and numbers.');
    process.exit(1);
  }
  user = await auth.createUser({ email, password, displayName: values.name, emailVerified: true });
  console.log(`Created Firebase Auth user ${email} (${user.uid}).`);
} else {
  await auth.updateUser(user.uid, { displayName: values.name });
  console.log(`Using existing Firebase Auth user ${email} (${user.uid}).`);
}

await auth.setCustomUserClaims(user.uid, { ...(user.customClaims ?? {}), role: 'admin', adminRole: values.role });
// Existing sessions must sign in again to pick up the new claims.
await auth.revokeRefreshTokens(user.uid);

const existing = await db.get(C.admins, user.uid);
await db.set(C.admins, user.uid, {
  ...(existing ?? { preferences: { defaultUsagePeriod: 'daily', rowsPerPage: 10 }, createdAt: new Date().toISOString() }),
  email,
  username: email,
  fullName: values.name,
  role: values.role, // mirror of the custom claim, for display only
  department: values.department,
  status: 'active',
  updatedAt: new Date().toISOString(),
});
console.log(`${email} is now an administrator (${values.role}).`);
process.exit(0);

async function prompt(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(q);
  rl.close();
  return answer;
}
