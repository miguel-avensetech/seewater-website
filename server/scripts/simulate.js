// Device simulator: drives the seeded sample devices through the real device API
// (activation credentials → heartbeat → readings → valve commands), exactly as
// ESP32 firmware would. All data it produces is stored as `source: "simulated"`
// because the server knows these devices are flagged isSimulated.
//
//   npm run simulate                       normal household usage
//   npm run simulate -- --scenario leak    one device reports a leak pattern
//   npm run simulate -- --scenario high-flow
//   npm run simulate -- --interval 10      seconds between reports (default 15)

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    scenario: { type: 'string', default: 'normal' },
    interval: { type: 'string', default: '15' },
    'api-url': { type: 'string' },
  },
});

const file = path.resolve('data/simulator-devices.json');
if (!fs.existsSync(file)) {
  console.error('No simulator credentials found. Run `npm run seed` first.');
  process.exit(1);
}
const { apiUrl: seededUrl, devices } = JSON.parse(fs.readFileSync(file, 'utf8'));
const apiUrl = args['api-url'] || process.env.API_URL || seededUrl;
const intervalSec = Math.max(5, Number(args.interval));
const round1 = (v) => Math.round(v * 10) / 10;

async function call(device, method, route, body) {
  const res = await fetch(`${apiUrl}/api/device-api${route}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-device-id': device.deviceId, 'x-device-key': device.deviceKey },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${route} → ${res.status} ${json?.error?.message ?? ''}`);
  return json;
}

// Skip the device seeded as offline so the dashboard keeps a realistic mix.
const active = devices.filter((_, i) => i !== 3);
const target = active[1] ?? active[0];

async function tick(device) {
  const hour = new Date().getHours();
  const busy = (hour >= 5 && hour <= 8) || (hour >= 11 && hour <= 13) || (hour >= 18 && hour <= 21);
  let flowRate = Math.random() < (busy ? 0.6 : 0.2) ? round1(2 + Math.random() * 8) : 0;
  let vibration = Math.round(device.baseline + (Math.random() - 0.5) * 40 + (flowRate ? 10 : 0));

  if (device === target && args.scenario === 'leak') {
    flowRate = round1(0.8 + Math.random() * 0.6); // small continuous flow
    vibration = Math.round(device.baseline * 1.6 + Math.random() * 30);
  }
  if (device === target && args.scenario === 'high-flow') flowRate = round1(19 + Math.random() * 8);

  device.firmwareVersion ??= '1.2.0';
  await call(device, 'POST', '/heartbeat', { firmwareVersion: device.firmwareVersion, signalStrength: -50 - Math.round(Math.random() * 30) });
  const result = await call(device, 'POST', '/readings', {
    readings: [
      { sensorId: device.flowSensorId, flowRate, waterUsage: round1((flowRate * intervalSec) / 60) },
      { sensorId: device.vibrationSensorId, vibrationLevel: vibration },
    ],
  });

  // Act on pending valve commands like the relay firmware would, then confirm.
  const { commands } = await call(device, 'GET', '/commands');
  for (const c of commands) {
    if (c.type === 'firmware') {
      // Pretend to download and flash the image; the next heartbeat reports the new version.
      await call(device, 'POST', '/firmware-status', { updateId: c.updateId, status: 'installed' });
      device.firmwareVersion = c.version;
      continue;
    }
    await call(device, 'POST', '/valve-ack', { valveId: c.valveId, commandId: c.commandId, state: c.state, success: true, positionConfirmed: false });
    console.log(`  ${device.deviceName}: relay switched valve ${c.state} (acknowledged)`);
  }
  return { flowRate, vibration, alerts: result.alerts.length };
}

console.log(`Simulating ${active.length} devices against ${apiUrl} every ${intervalSec}s (scenario: ${args.scenario}). Ctrl+C to stop.`);
async function loop() {
  for (const d of active) {
    try {
      const r = await tick(d);
      console.log(`${new Date().toLocaleTimeString()}  ${d.deviceName}  flow ${r.flowRate} L/min  vib ${r.vibration}${r.alerts ? `  → ${r.alerts} alert(s)` : ''}`);
    } catch (err) {
      console.error(`${d.deviceName}: ${err.message}`);
    }
  }
}
await loop();
setInterval(loop, intervalSec * 1000);
