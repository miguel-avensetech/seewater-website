import { config } from '../config.js';

// Classifies a reading for display, so simulated data is never shown as live:
//   live      — real device reading received within the online window
//   stored    — real device reading, but historical
//   simulated — produced by the seed script or the device simulator
//   no_data   — nothing received yet
export function dataState(source, recordedAt, now = Date.now()) {
  if (!recordedAt) return 'no_data';
  if (source === 'simulated') return 'simulated';
  const ageMin = (now - Date.parse(recordedAt)) / 60000;
  return ageMin <= config.deviceOnlineWindowMinutes ? 'live' : 'stored';
}
