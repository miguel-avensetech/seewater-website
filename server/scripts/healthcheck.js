// End-to-end health check for a running SeeWater stack: API, admin website,
// device API (ESP32) and homeowner mobile API.
//
//   npm run healthcheck                # read-only checks (safe on the live project)
//   npm run healthcheck -- --write     # also registers, activates and removes a
//                                      # throwaway device and a draft announcement
//
// Configuration (server/.env or the shell):
//   HEALTHCHECK_API_URL        default http://localhost:4000
//   HEALTHCHECK_ADMIN_URL      default http://localhost:3000 (Next.js admin site)
//   HEALTHCHECK_ADMIN_EMAIL    admin account to sign in with
//   HEALTHCHECK_ADMIN_PASSWORD
//   HEALTHCHECK_ADMIN_UID      alternative to email/password: signs in as this admin with the
//                              service-account credentials in .env (no password needed, e.g. CI)
//   FIREBASE_WEB_API_KEY       defaults to NEXT_PUBLIC_FIREBASE_API_KEY in admin/.env.local
//   HEALTHCHECK_HOMEOWNER_EMAIL / HEALTHCHECK_HOMEOWNER_PASSWORD   optional, enables mobile API checks
//
// Exits with code 1 when any check fails.

import fs from 'node:fs';
import path from 'node:path';

const env = process.env;
const args = new Set(process.argv.slice(2));
const WRITE = args.has('--write');
const API = (env.HEALTHCHECK_API_URL || 'http://localhost:4000').replace(/\/$/, '');
const WEB = (env.HEALTHCHECK_ADMIN_URL || 'http://localhost:3000').replace(/\/$/, '');
const TIMEOUT_MS = 60_000; // Next.js dev compiles a page on its first request.

function webApiKey() {
  if (env.FIREBASE_WEB_API_KEY) return env.FIREBASE_WEB_API_KEY;
  const file = path.resolve(import.meta.dirname, '../../admin/.env.local');
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8').match(/^NEXT_PUBLIC_FIREBASE_API_KEY=(.+)$/m)?.[1].trim() ?? null;
}

// ── Reporting ────────────────────────────────────────────────────────────────

const color = process.stdout.isTTY ? (c, s) => `\x1b[${c}m${s}\x1b[0m` : (_c, s) => s;
const results = { pass: 0, fail: 0, skip: 0 };
const failures = [];

class Skip extends Error {}
const skip = (reason) => {
  throw new Skip(reason);
};

function section(title) {
  console.log(`\n${color('1', title)}`);
}

async function check(name, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    const note = typeof result === 'string' ? result : '';
    results.pass++;
    console.log(`  ${color('32', '✓')} ${name} ${color('2', `${Date.now() - started}ms${note ? ` · ${note}` : ''}`)}`);
  } catch (err) {
    if (err instanceof Skip) {
      results.skip++;
      console.log(`  ${color('33', '–')} ${name} ${color('2', `skipped: ${err.message}`)}`);
      return;
    }
    results.fail++;
    failures.push(`${name}: ${err.message}`);
    console.log(`  ${color('31', '✗')} ${name}\n      ${color('31', err.message)}`);
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

async function request(url, { method = 'GET', body, headers = {}, redirect = 'manual' } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      redirect,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(`${method} ${url} → ${err.name === 'TimeoutError' ? 'timed out' : `unreachable (${err.cause?.code ?? err.message})`}`);
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON (HTML pages).
  }
  return { status: res.status, headers: res.headers, json, text };
}

// Calls the API and asserts the status; returns the parsed body.
async function call(pathname, { expect = 200, ...opts } = {}) {
  const res = await request(`${API}/api${pathname}`, opts);
  const expected = [].concat(expect);
  if (!expected.includes(res.status)) {
    const msg = res.json?.error?.message ?? res.text.slice(0, 200);
    throw new Error(`${opts.method ?? 'GET'} /api${pathname} → ${res.status} (expected ${expected.join('/')})${msg ? `: ${msg}` : ''}`);
  }
  return res.json;
}

function isList(body, label) {
  assert(body && Array.isArray(body.items) && typeof body.total === 'number', `${label}: expected { items[], total }`);
  return `${body.total} total`;
}

// ── State shared between checks ──────────────────────────────────────────────

const state = { cookie: null, admin: null, homeownerToken: null, ids: {} };
const asAdmin = () => {
  if (!state.cookie) skip('admin sign-in did not succeed');
  return { cookie: state.cookie };
};
// Skips (with the real reason) until sign-in has succeeded and the record exists.
const need = (id, reason) => {
  asAdmin();
  if (!id) skip(reason);
  return id;
};
const admin = (pathname, opts = {}) => call(pathname, { ...opts, headers: { ...asAdmin(), ...opts.headers } });

const today = new Date();
const isoDay = (d) => d.toISOString().slice(0, 10);
const weekAgo = new Date(today.getTime() - 6 * 86400_000);

// ── Checks ───────────────────────────────────────────────────────────────────

async function infrastructure() {
  section('Infrastructure');
  await check('API server is up (GET /api/health)', async () => {
    const body = await call('/health');
    assert(body?.ok === true, 'health did not return { ok: true }');
    return API;
  });
  await check('Admin website is up (GET /login)', async () => {
    const res = await request(`${WEB}/login`);
    assert(res.status === 200, `GET /login → ${res.status}`);
    return WEB;
  });
  await check('Admin website proxies /api to the server', async () => {
    const res = await request(`${WEB}/api/health`);
    assert(res.status === 200 && res.json?.ok === true, `GET ${WEB}/api/health → ${res.status}; check API_URL in admin/.env.local`);
  });
  await check('Unknown route returns a JSON 404', async () => {
    const res = await request(`${API}/healthcheck-missing`);
    assert(res.status === 404 && res.json?.error, `GET /healthcheck-missing → ${res.status}`);
  });
}

async function security() {
  section('Access control');
  for (const p of ['/dashboard/summary', '/devices', '/users', '/settings']) {
    await check(`Admin ${p} rejects requests without a session (401)`, () => call(p, { expect: 401 }));
  }
  await check('Admin API rejects a forged session cookie (401)', () => call('/auth/me', { expect: 401, headers: { cookie: 'sw_session=forged' } }));
  await check('Admin pages redirect to /login without a session', async () => {
    const res = await request(`${WEB}/devices`);
    assert([307, 308].includes(res.status) && res.headers.get('location')?.includes('/login'), `GET /devices → ${res.status} ${res.headers.get('location') ?? ''}`);
  });
  await check('Device API rejects missing credentials (401)', () => call('/device-api/heartbeat', { method: 'POST', body: {}, expect: 401 }));
  await check('Device API rejects unknown device credentials (401)', () =>
    call('/device-api/commands', { expect: 401, headers: { 'x-device-id': 'healthcheck-unknown', 'x-device-key': 'x' } }),
  );
  await check('Device activation validates the code format (400)', () => call('/device-api/activate', { method: 'POST', body: { activationCode: 'bad' }, expect: 400 }));
  await check('Mobile API rejects requests without a token (401)', () => call('/mobile/home', { expect: 401 }));
  await check('Mobile API rejects an invalid token (401)', () => call('/mobile/home', { expect: 401, headers: { authorization: 'Bearer not-a-token' } }));
}

async function adminSignIn() {
  section('Admin sign-in (Firebase Auth → session cookie)');
  await check('Sign in and create a session', async () => {
    const email = env.HEALTHCHECK_ADMIN_EMAIL;
    const password = env.HEALTHCHECK_ADMIN_PASSWORD;
    const uid = env.HEALTHCHECK_ADMIN_UID;
    if (!(email && password) && !uid) skip('set HEALTHCHECK_ADMIN_EMAIL + HEALTHCHECK_ADMIN_PASSWORD (or HEALTHCHECK_ADMIN_UID)');
    const key = webApiKey();
    if (!key && !env.FIREBASE_AUTH_EMULATOR_HOST) skip('no Firebase web API key (FIREBASE_WEB_API_KEY or admin/.env.local)');

    const authBase = env.FIREBASE_AUTH_EMULATOR_HOST ? `http://${env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com` : 'https://identitytoolkit.googleapis.com';
    let signIn;
    if (email && password) {
      signIn = await request(`${authBase}/v1/accounts:signInWithPassword?key=${key ?? 'fake-api-key'}`, { method: 'POST', body: { email, password, returnSecureToken: true } });
    } else {
      const { adminAuth } = await import('../src/lib/firebaseAdmin.js');
      const token = await adminAuth().createCustomToken(uid);
      signIn = await request(`${authBase}/v1/accounts:signInWithCustomToken?key=${key ?? 'fake-api-key'}`, { method: 'POST', body: { token, returnSecureToken: true } });
    }
    assert(signIn.status === 200, `Firebase sign-in failed: ${signIn.json?.error?.message ?? signIn.status}`);

    const res = await request(`${API}/api/auth/session`, { method: 'POST', body: { idToken: signIn.json.idToken } });
    assert(res.status === 200, `POST /api/auth/session → ${res.status}: ${res.json?.error?.message ?? ''}`);
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('sw_session='));
    assert(cookie, 'no sw_session cookie was set');
    state.cookie = cookie.split(';')[0];
    state.admin = res.json.admin;
    return `${state.admin.fullName} (${state.admin.role})`;
  });
  await check('GET /auth/me returns the signed-in admin', async () => {
    const body = await admin('/auth/me');
    assert(body?.admin?.id === state.admin.id, 'admin id mismatch');
  });
}

async function adminReads() {
  section('Admin API — dashboard, monitoring, usage');
  await check('Dashboard summary', async () => {
    const body = await admin('/dashboard/summary');
    assert(body && typeof body === 'object', 'empty body');
  });
  await check('Monitoring overview', () => admin('/monitoring/overview'));
  await check('Water usage (daily, last 7 days)', () => admin(`/usage?period=daily&from=${isoDay(weekAgo)}&to=${isoDay(today)}`));
  await check('Water usage (weekly / monthly)', async () => {
    await admin(`/usage?period=weekly&from=${isoDay(weekAgo)}&to=${isoDay(today)}`);
    await admin(`/usage?period=monthly&from=${isoDay(weekAgo)}&to=${isoDay(today)}`);
  });

  section('Admin API — IoT device management');
  await check('Devices list', async () => {
    const body = await admin('/devices?pageSize=100');
    const note = isList(body, 'devices');
    assert(body.summary, 'missing summary counts');
    state.ids.device = body.items[0]?.id;
    return note;
  });
  await check('Device search and filters', async () => {
    await admin('/devices?q=SW');
    for (const f of ['connection=online', 'connection=offline', 'activation=pending', 'activation=activated']) await admin(`/devices?${f}`);
  });
  await check('Device detail', async () => {
    need(state.ids.device, 'no devices registered');
    const body = await admin(`/devices/${state.ids.device}`);
    assert(body.device?.id === state.ids.device && Array.isArray(body.sensors), 'unexpected device detail shape');
    state.ids.valve = body.valve?.id;
    return body.device.deviceName;
  });
  await check('Valve command history', async () => {
    need(state.ids.valve, 'first device has no valve');
    await admin(`/valves/${state.ids.valve}/commands`);
  });
  await check('Device detail for an unknown id returns 404', () => admin('/devices/healthcheck-missing', { expect: 404 }));
  await check('Activation codes', async () => isList(await admin('/activation-codes'), 'activation codes'));
  await check('Valve commands', () => admin('/valve-commands'));
  await check('Firmware updates', () => admin('/firmware'));
  await check('System alerts (all / active)', async () => {
    const note = isList(await admin('/alerts'), 'alerts');
    await admin('/alerts?status=active&pageSize=1');
    return note;
  });
  await check('Device logs', async () => isList(await admin('/logs/devices'), 'device logs'));

  section('Admin API — users and households');
  await check('Registered users', async () => {
    const body = await admin('/users?pageSize=100&sort=fullName&order=asc');
    state.ids.user = body.items[0]?.id;
    return isList(body, 'users');
  });
  await check('User detail', async () => {
    need(state.ids.user, 'no users');
    await admin(`/users/${state.ids.user}`);
  });
  await check('Households', async () => {
    const body = await admin('/houses');
    state.ids.house = body.items[0]?.id;
    return isList(body, 'households');
  });
  await check('Live readings for a household', async () => {
    need(state.ids.house, 'no households');
    await admin(`/monitoring/houses/${state.ids.house}/readings?minutes=60`);
  });
  await check('Bill estimate for a household', async () => {
    need(state.ids.house, 'no households');
    await admin(`/rates/estimate?houseId=${state.ids.house}&customerClass=residential`);
  });
  await check('User feedback (all / new)', async () => {
    const note = isList(await admin('/feedback'), 'feedback');
    await admin('/feedback?status=new&pageSize=1');
    return note;
  });

  section('Admin API — announcements');
  await check('Announcements', async () => isList(await admin('/announcements'), 'announcements'));
  await check('Water rates', async () => isList(await admin('/rates'), 'rates'));
  await check('Water interruptions', async () => isList(await admin('/interruptions'), 'interruptions'));
  await check('Sent notifications', async () => isList(await admin('/notifications'), 'notifications'));

  section('Admin API — sensor calibration');
  await check('Calibration households', async () => isList(await admin('/calibration/households?pageSize=24'), 'calibration households'));
  await check('Calibration sensors', async () => {
    const body = await admin('/calibration/sensors?pageSize=100');
    const items = body.items ?? body;
    state.ids.flowSensor = items.find?.((s) => s.sensorType === 'flow')?.id;
    state.ids.vibrationSensor = items.find?.((s) => s.sensorType === 'vibration')?.id;
    return Array.isArray(items) ? `${items.length} sensors` : undefined;
  });
  await check('Calibration sensor detail', async () => {
    const id = state.ids.flowSensor ?? state.ids.vibrationSensor;
    need(id, 'no sensors');
    await admin(`/calibration/sensors/${id}`);
  });
  await check('Threshold profiles', () => admin('/calibration/thresholds'));
  await check('Flow: suggest alert levels (read-only)', async () => {
    need(state.ids.flowSensor, 'no flow sensor');
    await admin(`/calibration/sensors/${state.ids.flowSensor}/suggest-levels`, { method: 'POST', body: { days: 7 }, expect: [200, 400, 422] });
  });
  await check('Vibration baselines', () => admin('/vibration/baselines'));
  await check('Vibration sensor detail', async () => {
    need(state.ids.vibrationSensor, 'no vibration sensor');
    await admin(`/vibration/sensors/${state.ids.vibrationSensor}`);
  });
  await check('Vibration: measure baseline from readings (read-only)', async () => {
    need(state.ids.vibrationSensor, 'no vibration sensor');
    await admin(`/vibration/sensors/${state.ids.vibrationSensor}/measure`, { method: 'POST', body: { minutes: 60 }, expect: [200, 400, 422] });
  });

  section('Admin API — account and system');
  await check('System settings', () => admin('/settings'));
  await check('System logs', async () => isList(await admin('/logs/system'), 'system logs'));
  await check('Input validation rejects a bad device registration (400)', () => admin('/devices', { method: 'POST', body: { deviceName: '' }, expect: [400, 403] }));
}

const PAGES = [
  '/',
  '/devices',
  '/activation-codes',
  '/monitoring',
  '/alerts',
  '/logs/devices',
  '/users',
  '/households',
  '/usage',
  '/feedback',
  '/announcements',
  '/interruptions',
  '/notifications',
  '/calibration',
  '/vibration',
  '/settings',
  '/logs/system',
];

async function adminPages() {
  section('Admin website pages (render with a session)');
  const pages = [...PAGES];
  if (state.ids.device) pages.splice(2, 0, `/devices/${state.ids.device}`);
  if (state.ids.user) pages.splice(pages.indexOf('/households'), 0, `/users/${state.ids.user}`);
  for (const p of pages) {
    await check(`Page ${p}`, async () => {
      const res = await request(`${WEB}${p}`, { headers: asAdmin() });
      assert(res.status === 200, `GET ${p} → ${res.status}${res.headers.get('location') ? ` → ${res.headers.get('location')}` : ''}`);
      assert(!/Application error|Unhandled Runtime Error|Internal Server Error/i.test(res.text), 'page rendered an error');
    });
  }
}

async function mobileApi() {
  section('Homeowner mobile API');
  await check('Homeowner sign-in', async () => {
    const email = env.HEALTHCHECK_HOMEOWNER_EMAIL;
    const password = env.HEALTHCHECK_HOMEOWNER_PASSWORD;
    if (!email || !password) skip('set HEALTHCHECK_HOMEOWNER_EMAIL and HEALTHCHECK_HOMEOWNER_PASSWORD');
    const body = await call('/mobile/auth/login', { method: 'POST', body: { email, password } });
    assert(body?.token, 'no token returned');
    state.homeownerToken = body.token;
    return body.user?.fullName;
  });
  const mobile = (p) => {
    if (!state.homeownerToken) skip('homeowner sign-in did not succeed');
    return call(`/mobile${p}`, { headers: { authorization: `Bearer ${state.homeownerToken}` } });
  };
  for (const p of ['/auth/me', '/home', '/devices', '/monitoring', '/alerts', '/notifications', '/announcements', '/interruptions', '/rates', '/insights', '/valves', '/feedback']) {
    await check(`GET /mobile${p}`, () => mobile(p));
  }
  await check('Homeowner token is not accepted by admin routes (401)', async () => {
    if (!state.homeownerToken) skip('homeowner sign-in did not succeed');
    await call('/dashboard/summary', { expect: 401, headers: { authorization: `Bearer ${state.homeownerToken}` } });
  });
}

// Full lifecycle on throwaway records, removed again at the end.
async function writeFlows() {
  section('Write flows (--write): device lifecycle and announcement draft');
  if (!WRITE) {
    await check('Device and announcement lifecycle', () => skip('run with --write to include'));
    return;
  }
  const tag = `HC-${Date.now().toString(36).toUpperCase()}`;
  const created = { device: null, announcement: null };
  let creds = null;
  try {
    await check('Register device with sensors and valve', async () => {
      if (!state.admin) skip('admin sign-in did not succeed');
      if (state.admin.role === 'viewer') skip('viewer accounts cannot make changes');
      const body = await admin('/devices', {
        method: 'POST',
        expect: 201,
        body: { deviceName: tag, deviceType: 'esp32_gateway', macAddress: '', houseId: null, notes: 'Created by healthcheck; safe to delete', includeValve: true, sensors: [{ sensorType: 'flow', sensorLocation: 'Main line' }, { sensorType: 'vibration', sensorLocation: 'Main line' }] },
      });
      created.device = body;
      assert(/^SW-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(body.activationCode ?? ''), 'no activation code issued');
      return tag;
    });
    await check('Duplicate MAC address is rejected', async () => {
      if (!created.device) skip('device was not registered');
      const mac = `02:${Array.from({ length: 5 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join(':')}`.toUpperCase();
      await admin(`/devices/${created.device.id}`, { method: 'PATCH', body: { deviceName: tag, deviceType: 'esp32_gateway', macAddress: mac, houseId: null, notes: '' } });
      await admin('/devices', { method: 'POST', expect: 400, body: { deviceName: `${tag}-DUP`, macAddress: mac, sensors: [] } });
      created.device.macAddress = mac;
    });
    await check('Regenerate activation code', async () => {
      if (!created.device) skip('device was not registered');
      const body = await admin(`/devices/${created.device.id}/activation-code`, { method: 'POST', expect: [200, 201] });
      assert(body.activationCode && body.activationCode !== created.device.activationCode, 'code did not change');
      created.device.activationCode = body.activationCode;
    });
    await check('Activation from a different MAC is rejected', async () => {
      if (!created.device) skip('device was not registered');
      await call('/device-api/activate', { method: 'POST', expect: 401, body: { activationCode: created.device.activationCode, macAddress: '02:00:00:00:00:01' } });
    });
    await check('ESP32 activates with the code', async () => {
      if (!created.device) skip('device was not registered');
      creds = await call('/device-api/activate', { method: 'POST', expect: 201, body: { activationCode: created.device.activationCode, macAddress: created.device.macAddress, firmwareVersion: '0.0.0-healthcheck' } });
      assert(creds.deviceKey && creds.sensors?.length === 2 && creds.valveId, 'incomplete activation response');
    });
    const device = (p, opts = {}) => {
      if (!creds) skip('device did not activate');
      return call(`/device-api${p}`, { ...opts, headers: { 'x-device-id': creds.deviceId, 'x-device-key': creds.deviceKey } });
    };
    await check('Activation code cannot be reused', async () => {
      if (!creds) skip('device did not activate');
      await call('/device-api/activate', { method: 'POST', expect: 401, body: { activationCode: created.device.activationCode } });
    });
    await check('Device heartbeat', () => device('/heartbeat', { method: 'POST', body: { firmwareVersion: '0.0.0-healthcheck', signalStrength: -60 } }));
    await check('Device log', () => device('/logs', { method: 'POST', expect: 201, body: { eventType: 'healthcheck', description: 'Health check log entry', status: 'info' } }));
    await check('Device commands and config', async () => {
      const body = await device('/commands');
      assert(Array.isArray(body.commands) && body.config?.sensors, 'unexpected commands shape');
    });
    await check('Readings are refused while unassigned (400)', () => device('/readings', { method: 'POST', expect: 400, body: { readings: [{ sensorId: creds?.sensors[0].id, flowRate: 1 }] } }));
    await check('Admin sees the device online with reported firmware', async () => {
      const body = await admin(`/devices/${created.device.id}`);
      assert(body.device.connectionStatus === 'online', `connectionStatus is ${body.device.connectionStatus}`);
      assert(body.device.firmwareVersion === '0.0.0-healthcheck', `firmwareVersion is ${body.device.firmwareVersion}`);
    });
    await check('Deactivate device revokes its key', async () => {
      if (!creds) skip('device did not activate');
      await admin(`/devices/${created.device.id}/deactivate`, { method: 'POST' });
      await call('/device-api/heartbeat', { method: 'POST', body: {}, expect: 401, headers: { 'x-device-id': creds.deviceId, 'x-device-key': creds.deviceKey } });
    });

    await check('Announcement: save draft, edit, archive', async () => {
      if (!state.admin || state.admin.role === 'viewer') skip('needs an admin account');
      const body = await admin('/announcements', { method: 'POST', expect: 201, body: { title: `${tag} draft`, message: 'Health check draft — not published.', category: 'customer_tip', action: 'draft' } });
      created.announcement = body;
      assert(body.status === 'draft', `status is ${body.status}`);
      await admin(`/announcements/${body.id}`, { method: 'PATCH', body: { title: `${tag} draft edited`, message: 'Health check draft — not published.', category: 'customer_tip', action: 'draft' } });
      await admin(`/announcements/${body.id}/archive`, { method: 'POST' });
    });
  } finally {
    await check('Clean up: remove test device', async () => {
      if (!created.device) skip('nothing to remove');
      await admin(`/devices/${created.device.id}`, { method: 'DELETE', expect: 204 });
      await admin(`/devices/${created.device.id}`, { expect: 404 });
    });
    await check('Clean up: delete test announcement', async () => {
      if (!created.announcement) skip('nothing to remove');
      await admin(`/announcements/${created.announcement.id}`, { method: 'DELETE', expect: [200, 204] });
    });
  }
}

// ── Run ──────────────────────────────────────────────────────────────────────

console.log(color('1', `SeeWater health check${WRITE ? ' (with write flows)' : ' (read-only)'}`));
console.log(color('2', `API ${API} · admin site ${WEB}`));
const started = Date.now();

await infrastructure();
await security();
await adminSignIn();
await adminReads();
await adminPages();
await mobileApi();
await writeFlows();

const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n${color('1', 'Summary')}: ${color('32', `${results.pass} passed`)}, ${results.fail ? color('31', `${results.fail} failed`) : '0 failed'}, ${color('33', `${results.skip} skipped`)} in ${secs}s`);
if (failures.length) {
  console.log(color('31', '\nFailures:'));
  for (const f of failures) console.log(color('31', `  • ${f}`));
}
process.exit(results.fail ? 1 : 0);
