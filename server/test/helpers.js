// Test helpers. Tests run against the Firebase Emulator Suite (Auth + Firestore),
// started by `npm test` through `firebase emulators:exec`.
import { after } from 'node:test';
import { deleteApp, getApps } from 'firebase-admin/app';
import request from 'supertest';
import { initDb } from '../src/db/index.js';
import { adminAuth, adminDatabase } from '../src/lib/firebaseAdmin.js';
import { createApp } from '../src/app.js';
import { db, C } from '../src/db/index.js';

const projectId = process.env.FIREBASE_PROJECT_ID;

// Close Firebase connections (Realtime Database keeps a socket open) so each
// test file's process can exit.
after(async () => {
  await Promise.all(getApps().map((a) => deleteApp(a)));
});

export async function resetEmulators() {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error('Tests must run against the Firebase emulators: use `npm test`.');
  }
  const driver = initDb();
  await driver.reset();
  const res = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${projectId}/accounts`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Auth emulator reset failed: ${res.status}`);
  await adminDatabase().ref().remove();
  return createApp();
}

// Mirrors scripts/createAdmin.js: Auth user + custom claims + admins/{uid} profile.
export async function createAdmin({ email, password, fullName = 'Test Admin', adminRole = 'super_admin' }) {
  const user = await adminAuth().createUser({ email, password, displayName: fullName, emailVerified: true });
  await adminAuth().setCustomUserClaims(user.uid, { role: 'admin', adminRole });
  await db.set(C.admins, user.uid, { email, fullName, role: adminRole, status: 'active', department: 'QA', createdAt: new Date().toISOString() });
  return user;
}

// Signs in with the Auth emulator's REST API, as the Firebase client SDK would.
export async function firebaseSignIn(email, password) {
  const res = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message ?? 'sign-in failed');
  return json.idToken;
}

// Returns a supertest agent holding a Firebase session cookie.
export async function adminAgent(app, email, password) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/session').send({ idToken: await firebaseSignIn(email, password) });
  if (res.status !== 200) throw new Error(`session failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}
