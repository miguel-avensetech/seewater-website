// Security rules tests — run with `npm run test:rules` in website/ (uses the emulators).
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { ref, uploadBytes, getBytes } from 'firebase/storage';
import { ref as dbRef, get as dbGet, set as dbSet } from 'firebase/database';

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-seewater',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
    storage: { rules: readFileSync(new URL('../storage.rules', import.meta.url), 'utf8') },
    database: { rules: readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8') },
  });
});

after(() => env?.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    await setDoc(doc(fs, 'users/maria'), { fullName: 'Maria', role: 'homeowner' });
    await setDoc(doc(fs, 'users/pedro'), { fullName: 'Pedro', role: 'homeowner' });
    await setDoc(doc(fs, 'houses/h-maria'), { userId: 'maria', houseName: 'Santos Residence' });
    await setDoc(doc(fs, 'houses/h-pedro'), { userId: 'pedro', houseName: 'Cruz Residence' });
    await setDoc(doc(fs, 'devices/d-maria'), { houseId: 'h-maria', deviceName: 'SW-1' });
    await setDoc(doc(fs, 'devices/d-pedro'), { houseId: 'h-pedro', deviceName: 'SW-2' });
    await setDoc(doc(fs, 'alerts/a-maria'), { houseId: 'h-maria', alertType: 'possible_leak', alertStatus: 'open' });
    await setDoc(doc(fs, 'alerts/a-pedro'), { houseId: 'h-pedro', alertType: 'high_flow', alertStatus: 'open' });
    await setDoc(doc(fs, 'notifications/n-maria'), { userId: 'maria', title: 'Hi' });
    await setDoc(doc(fs, 'activationCodes/SW-AAAA-BBBB'), { deviceId: 'd-maria', status: 'active' });
    await setDoc(doc(fs, 'systemLogs/l1'), { category: 'admin_action' });
    await setDoc(doc(fs, 'admins/admin1'), { fullName: 'Admin One' });
    await setDoc(doc(fs, 'admins/admin2'), { fullName: 'Admin Two' });
    await setDoc(doc(fs, 'announcements/pub'), { status: 'published', title: 'Advisory' });
    await setDoc(doc(fs, 'announcements/draft'), { status: 'draft', title: 'Draft' });
    const rt = ctx.database();
    await dbSet(dbRef(rt, 'live/devices/d-maria'), { ownerId: 'maria', connectionStatus: 'online', flowRate: 2.5 });
    await dbSet(dbRef(rt, 'live/devices/d-pedro'), { ownerId: 'pedro', connectionStatus: 'offline', flowRate: null });
    await dbSet(dbRef(rt, 'live/alerts/a-maria'), { ownerId: 'maria', alertType: 'possible_leak' });
  });
});

const admin = () => env.authenticatedContext('admin1', { role: 'admin', adminRole: 'super_admin', email_verified: true });
const maria = () => env.authenticatedContext('maria', { role: 'homeowner', email_verified: true });
const unverified = () => env.authenticatedContext('maria', { role: 'homeowner', email_verified: false });
const noRole = () => env.authenticatedContext('stranger', { email_verified: true });
const anon = () => env.unauthenticatedContext();

// ── Firestore ────────────────────────────────────────────────────────────────

test('anonymous and role-less users cannot read anything', async () => {
  await assertFails(getDoc(doc(anon().firestore(), 'alerts/a-maria')));
  await assertFails(getDoc(doc(noRole().firestore(), 'devices/d-maria')));
  await assertFails(getDoc(doc(noRole().firestore(), 'users/stranger')));
});

test('admins can read operational data for live dashboards', async () => {
  const fs = admin().firestore();
  await assertSucceeds(getDocs(query(collection(fs, 'alerts'), where('alertStatus', '==', 'open'))));
  await assertSucceeds(getDoc(doc(fs, 'devices/d-pedro')));
  await assertSucceeds(getDoc(doc(fs, 'systemLogs/l1')));
  await assertSucceeds(getDoc(doc(fs, 'admins/admin1')));
});

test('admins cannot write directly — all writes go through the API', async () => {
  const fs = admin().firestore();
  await assertFails(updateDoc(doc(fs, 'devices/d-maria'), { houseId: 'h-pedro' }));
  await assertFails(setDoc(doc(fs, 'alerts/new'), { houseId: 'h-maria' }));
  await assertFails(getDoc(doc(fs, 'admins/admin2')));
});

test('activation codes are not readable by any client', async () => {
  await assertFails(getDoc(doc(admin().firestore(), 'activationCodes/SW-AAAA-BBBB')));
  await assertFails(getDoc(doc(maria().firestore(), 'activationCodes/SW-AAAA-BBBB')));
});

test('homeowners can read only their own account, household, devices and alerts', async () => {
  const fs = maria().firestore();
  await assertSucceeds(getDoc(doc(fs, 'users/maria')));
  await assertSucceeds(getDoc(doc(fs, 'houses/h-maria')));
  await assertSucceeds(getDoc(doc(fs, 'devices/d-maria')));
  await assertSucceeds(getDoc(doc(fs, 'alerts/a-maria')));
  await assertSucceeds(getDoc(doc(fs, 'notifications/n-maria')));
  await assertFails(getDoc(doc(fs, 'users/pedro')));
  await assertFails(getDoc(doc(fs, 'houses/h-pedro')));
  await assertFails(getDoc(doc(fs, 'devices/d-pedro')));
  await assertFails(getDoc(doc(fs, 'alerts/a-pedro')));
  await assertFails(getDoc(doc(fs, 'systemLogs/l1')));
});

test('homeowners cannot change their role or device ownership', async () => {
  const fs = maria().firestore();
  await assertFails(updateDoc(doc(fs, 'users/maria'), { role: 'admin' }));
  await assertFails(updateDoc(doc(fs, 'devices/d-pedro'), { houseId: 'h-maria' }));
  await assertFails(setDoc(doc(fs, 'admins/maria'), { fullName: 'Maria' }));
});

test('unverified homeowners are denied', async () => {
  await assertFails(getDoc(doc(unverified().firestore(), 'users/maria')));
});

test('homeowners see published announcements only', async () => {
  await assertSucceeds(getDoc(doc(maria().firestore(), 'announcements/pub')));
  await assertFails(getDoc(doc(maria().firestore(), 'announcements/draft')));
});

// ── Storage ──────────────────────────────────────────────────────────────────

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pdf = new TextEncoder().encode('%PDF-1.4 test');

test('admins upload only their own profile picture, images under 2 MB', async () => {
  const st = admin().storage();
  await assertSucceeds(uploadBytes(ref(st, 'admins/admin1/avatar.png'), png, { contentType: 'image/png' }));
  await assertFails(uploadBytes(ref(st, 'admins/admin2/avatar.png'), png, { contentType: 'image/png' }));
  await assertFails(uploadBytes(ref(st, 'admins/admin1/script.js'), png, { contentType: 'text/javascript' }));
  await assertFails(uploadBytes(ref(st, 'admins/admin1/big.png'), new Uint8Array(2 * 1024 * 1024 + 1), { contentType: 'image/png' }));
  await assertFails(uploadBytes(ref(maria().storage(), 'admins/maria/avatar.png'), png, { contentType: 'image/png' }));
});

test('announcement attachments: admins upload PDFs/images, signed-in users read', async () => {
  await assertSucceeds(uploadBytes(ref(admin().storage(), 'announcements/a1/notice.pdf'), pdf, { contentType: 'application/pdf' }));
  await assertFails(uploadBytes(ref(maria().storage(), 'announcements/a1/evil.pdf'), pdf, { contentType: 'application/pdf' }));
  await assertFails(uploadBytes(ref(admin().storage(), 'announcements/a1/app.exe'), pdf, { contentType: 'application/octet-stream' }));
  await assertSucceeds(getBytes(ref(maria().storage(), 'announcements/a1/notice.pdf')));
  await assertFails(getBytes(ref(anon().storage(), 'announcements/a1/notice.pdf')));
});

test('everything else in Storage is denied', async () => {
  await assertFails(uploadBytes(ref(admin().storage(), 'random/file.png'), png, { contentType: 'image/png' }));
});

// ── Realtime Database (/live) ────────────────────────────────────────────────

test('admins read the whole live tree; nobody writes it from a client', async () => {
  await assertSucceeds(dbGet(dbRef(admin().database(), 'live/devices')));
  await assertSucceeds(dbGet(dbRef(admin().database(), 'live/alerts')));
  await assertFails(dbSet(dbRef(admin().database(), 'live/devices/d-maria/flowRate'), 0));
  await assertFails(dbSet(dbRef(maria().database(), 'live/devices/d-maria/flowRate'), 0));
});

test('homeowners read only their own live device and alert nodes', async () => {
  const rt = maria().database();
  await assertSucceeds(dbGet(dbRef(rt, 'live/devices/d-maria')));
  await assertSucceeds(dbGet(dbRef(rt, 'live/alerts/a-maria')));
  await assertFails(dbGet(dbRef(rt, 'live/devices/d-pedro')));
  await assertFails(dbGet(dbRef(rt, 'live/devices')));
  await assertFails(dbGet(dbRef(unverified().database(), 'live/devices/d-maria')));
  await assertFails(dbGet(dbRef(anon().database(), 'live/devices')));
  await assertFails(dbGet(dbRef(admin().database(), '/')));
});
