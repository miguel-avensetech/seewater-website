import { createHash } from 'node:crypto';
import { db, C } from '../db/index.js';

// Sensor settings the ESP32 applies locally: piezo sensitivity and the flow
// sensor's pulses per L/min. `version` changes whenever a value changes; the
// device echoes it back in its heartbeat (configVersion) once applied, which is
// how the dashboard knows a calibration has reached the hardware.
export function buildDeviceConfig(sensors) {
  const list = sensors
    .map((s) => ({ id: s.id, sensorType: s.sensorType, sensorLocation: s.sensorLocation, status: s.status ?? 'active', sensitivity: s.sensitivity ?? 1, calibrationFactor: s.calibrationFactor ?? 1 }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const version = createHash('sha1').update(JSON.stringify(list)).digest('hex').slice(0, 12);
  return { version, sensors: list };
}

export async function deviceConfig(deviceId) {
  return buildDeviceConfig(await db.list(C.sensors, { where: [['deviceId', '==', deviceId]] }));
}
