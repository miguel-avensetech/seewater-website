import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { db, C } from '../src/db/index.js';
import { adminAgent, createAdmin, resetEmulators } from './helpers.js';

let app;
let admin;
const PASSWORD = 'CorrectHorse42';

// Verification codes are emailed and only their hash is stored, so tests make
// the code predictable by stubbing crypto.randomInt.
import crypto from 'node:crypto';
let nextCode = 123456;
crypto.randomInt = () => nextCode;

before(async () => {
  app = await resetEmulators();
  await createAdmin({ email: 'admin@test.ph', password: PASSWORD });
  admin = await adminAgent(app, 'admin@test.ph', PASSWORD);
});

const mobile = (token) => ({
  get: (p) => request(app).get(`/api/mobile${p}`).set('authorization', `Bearer ${token}`),
  post: (p) => request(app).post(`/api/mobile${p}`).set('authorization', `Bearer ${token}`),
  patch: (p) => request(app).patch(`/api/mobile${p}`).set('authorization', `Bearer ${token}`),
  del: (p) => request(app).delete(`/api/mobile${p}`).set('authorization', `Bearer ${token}`),
});

async function signUp(email, fullName = 'Home Owner') {
  const res = await request(app).post('/api/mobile/auth/signup').send({ fullName, email, password: 'Water12345', address: 'Lahug, Cebu City' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const v = await request(app).post('/api/mobile/auth/verify-email').send({ email, code: String(nextCode) });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  return v.body;
}

let maria;
let pedro;
let device;
let creds;

test('sign-up requires email verification before login', async () => {
  const s = await request(app).post('/api/mobile/auth/signup').send({ fullName: 'Pedro Cruz', email: 'pedro@example.com', password: 'Water12345' });
  assert.equal(s.status, 201);
  const early = await request(app).post('/api/mobile/auth/login').send({ email: 'pedro@example.com', password: 'Water12345' });
  assert.equal(early.status, 403);
  assert.equal(early.body.error.code, 'EMAIL_NOT_VERIFIED');
  const wrong = await request(app).post('/api/mobile/auth/verify-email').send({ email: 'pedro@example.com', code: '000000' });
  assert.equal(wrong.status, 400);
  const ok = await request(app).post('/api/mobile/auth/verify-email').send({ email: 'pedro@example.com', code: String(nextCode) });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
  assert.equal(ok.body.user.passwordHash, undefined);
  pedro = ok.body;
  const dup = await request(app).post('/api/mobile/auth/signup').send({ fullName: 'Pedro Cruz', email: 'pedro@example.com', password: 'Water12345' });
  assert.equal(dup.status, 409);
});

test('sign-up claims a homeowner record created by the admin', async () => {
  const created = await admin.post('/api/users').send({ fullName: 'Maria Santos', email: 'maria@example.com', address: 'Banilad, Cebu City' });
  const house = await admin.post(`/api/users/${created.body.id}/houses`).send({ houseName: 'Santos Residence', address: 'Banilad, Cebu City', houseStatus: 'pending_installation' });
  maria = await signUp('maria@example.com', 'Maria S.');
  assert.equal(maria.user.id, created.body.id);
  assert.equal(maria.user.fullName, 'Maria Santos');

  const reg = await admin.post('/api/devices').send({ deviceName: 'SW-GW-200', houseId: house.body.id, sensors: [{ sensorType: 'flow', sensorLocation: 'Main line' }, { sensorType: 'vibration', sensorLocation: 'Main line' }] });
  device = reg.body;
});

test('homeowner tokens cannot use admin routes, admin cookie cannot use mobile routes', async () => {
  const res = await request(app).get('/api/users').set('authorization', `Bearer ${maria.token}`);
  assert.equal(res.status, 401);
  const adminOnMobile = await admin.get('/api/mobile/home');
  assert.equal(adminOnMobile.status, 401);
});

test('activation code links only to the household owner and only once', async () => {
  const bad = await mobile(maria.token).post('/devices/link').send({ activationCode: 'SW-AAAA-BBBB' });
  assert.equal(bad.status, 400);
  const stolen = await mobile(pedro.token).post('/devices/link').send({ activationCode: device.activationCode });
  assert.equal(stolen.status, 403);
  const ok = await mobile(maria.token).post('/devices/link').send({ activationCode: device.activationCode.toLowerCase() });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.device.id, device.id);
  const again = await mobile(maria.token).post('/devices/link').send({ activationCode: device.activationCode });
  assert.equal(again.status, 409);

  // Visible to the admin.
  const detail = await admin.get(`/api/devices/${device.id}`);
  assert.equal(detail.body.device.linkedUserName, 'Maria Santos');

  // Hardware activation with the same code still works (separate step).
  const act = await request(app).post('/api/device-api/activate').send({ activationCode: device.activationCode });
  assert.equal(act.status, 201);
  creds = act.body;
});

test('unassigned device creates a household for a new homeowner', async () => {
  const reg = await admin.post('/api/devices').send({ deviceName: 'SW-GW-201', sensors: [{ sensorType: 'flow', sensorLocation: 'Main line' }] });
  const res = await mobile(pedro.token).post('/devices/link').send({ activationCode: reg.body.activationCode });
  assert.equal(res.status, 400);
  assert.ok(res.body.error.fields.address);
  const ok = await mobile(pedro.token).post('/devices/link').send({ activationCode: reg.body.activationCode, address: 'Talamban, Cebu City' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.device.house.houseName, 'Cruz Residence');
});

const dev = (method, path) => request(app)[method](`/api/device-api${path}`).set('x-device-id', creds.deviceId).set('x-device-key', creds.deviceKey);

test('home shows unavailable flow (not zero) until the device reports', async () => {
  const home = await mobile(maria.token).get('/home');
  assert.equal(home.status, 200);
  assert.equal(home.body.current.flowRate, null);
  assert.equal(home.body.systemStatus.status, 'offline');
});

test('readings and alerts reach only the owning homeowner', async () => {
  const flow = creds.sensors.find((s) => s.sensorType === 'flow');
  await dev('post', '/heartbeat').send({});
  await dev('post', '/readings').send({ readings: [{ sensorId: flow.id, flowRate: 30, waterUsage: 12 }] });

  const home = await mobile(maria.token).get('/home');
  assert.equal(home.body.current.flowRate, 30);
  assert.equal(home.body.usage.todayLiters, 12);
  assert.equal(home.body.systemStatus.status, 'critical');
  assert.equal(home.body.activeAlerts[0].alertType, 'high_flow');
  assert.equal(home.body.unreadCount, 1);

  const alerts = await mobile(maria.token).get('/alerts');
  assert.equal(alerts.body.total, 1);
  assert.equal(alerts.body.items[0].metrics.flowRate, 30);

  // Pedro sees none of Maria's data, and cannot open her alert by id.
  const other = await mobile(pedro.token).get('/alerts');
  assert.equal(other.body.total, 0);
  const peek = await mobile(pedro.token).get(`/alerts/${alerts.body.items[0].id}`);
  assert.equal(peek.status, 404);
  const pedroHome = await mobile(pedro.token).get('/home');
  assert.equal(pedroHome.body.usage.todayLiters, 0);

  const ins = await mobile(maria.token).get('/insights?period=daily');
  assert.equal(ins.body.totals.liters, 12);
  assert.equal(ins.body.houses, undefined);
});

test('notifications: list, read, clear — scoped to the user', async () => {
  const list = await mobile(maria.token).get('/notifications');
  const n = list.body.items[0];
  assert.equal(n.notificationType, 'high_flow');
  const peek = await mobile(pedro.token).get(`/notifications/${n.id}`);
  assert.equal(peek.status, 404);
  const read = await mobile(maria.token).get(`/notifications/${n.id}`);
  assert.equal(read.body.isRead, true);
  const clear = await mobile(maria.token).del('/notifications');
  assert.equal(clear.body.removed, 1);
});

test('homeowner valve command: pending → acknowledged, recorded for admins', async () => {
  const valves = await mobile(maria.token).get('/valves');
  const valve = valves.body.items[0];
  assert.equal(valves.body.positionFeedbackAvailable, false);

  const foreign = await mobile(pedro.token).post(`/valves/${valve.id}/command`).send({ action: 'close', emergency: true });
  assert.equal(foreign.status, 404);

  const badEmergency = await mobile(maria.token).post(`/valves/${valve.id}/command`).send({ action: 'open', emergency: true });
  assert.equal(badEmergency.status, 400);

  const cmd = await mobile(maria.token).post(`/valves/${valve.id}/command`).send({ action: 'close', emergency: true });
  assert.equal(cmd.status, 202);
  assert.equal(cmd.body.commandStatus, 'pending');
  const after = await mobile(maria.token).get('/valves');
  assert.equal(after.body.items[0].status, 'unknown');
  assert.equal(after.body.items[0].commands[0].emergency, true);

  const { body } = await dev('get', '/commands');
  await dev('post', '/valve-ack').send({ valveId: body.commands[0].valveId, commandId: body.commands[0].commandId, state: 'closed', success: true });
  const done = await mobile(maria.token).get('/valves');
  assert.equal(done.body.items[0].status, 'closed');
  assert.equal(done.body.items[0].commandStatus, 'acknowledged');
  assert.equal(done.body.items[0].positionConfirmed, false);
  assert.equal(done.body.items[0].commands[0].status, 'acknowledged');

  const adminView = await admin.get(`/api/valves/${valve.id}/commands`);
  assert.equal(adminView.body.items[0].requestedByType, 'homeowner');
  const logs = await admin.get('/api/logs/system?category=valve_operation');
  assert.ok(logs.body.items.some((l) => /homeowner Maria Santos/i.test(l.description)));
});

test('feedback from the app appears for admins', async () => {
  const fb = await mobile(maria.token).post('/feedback').send({ type: 'report', subject: 'Meter noise', message: 'The meter makes a ticking noise at night.' });
  assert.equal(fb.status, 201);
  const adminList = await admin.get('/api/feedback?q=Meter');
  assert.equal(adminList.body.items[0].userName, 'Maria Santos');
});

test('password change signs out other sessions', async () => {
  const res = await mobile(maria.token).post('/auth/password').send({ currentPassword: 'Water12345', newPassword: 'Water67890', confirmPassword: 'Water67890' });
  assert.equal(res.status, 200);
  const old = await mobile(maria.token).get('/home');
  assert.equal(old.status, 401);
  const fresh = await mobile(res.body.token).get('/home');
  assert.equal(fresh.status, 200);
});

test('admin user responses never include password data', async () => {
  const list = await admin.get('/api/users?q=maria');
  assert.equal(list.body.items[0].passwordHash, undefined);
  assert.equal(list.body.items[0].hasAppAccount, true);
});
