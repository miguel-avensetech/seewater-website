import { db, C } from '../db/index.js';

// THRESHOLD_PROFILE and VIBRATION_BASELINE documents are keyed by sensorId
// (one active profile/baseline per sensor), which keeps lookups index-free.

export async function getThresholdProfile(sensor, settings) {
  const profile = await db.get(C.thresholdProfiles, sensor.id);
  if (profile) return profile;
  if (sensor.sensorType === 'flow') {
    return {
      id: sensor.id,
      sensorId: sensor.id,
      minValue: 0,
      maxValue: 60,
      warningLevel: settings.highFlowWarningLpm,
      criticalLevel: settings.highFlowCriticalLpm,
      isDefault: true,
    };
  }
  return null;
}

export const getVibrationBaseline = (sensorId) => db.get(C.vibrationBaselines, sensorId);

// normal | high | critical, used by Live Monitoring and the usage tables.
export function classifyFlow(flowRate, profile) {
  if (flowRate == null || !profile) return 'unknown';
  if (flowRate >= profile.criticalLevel) return 'critical';
  if (flowRate >= profile.warningLevel) return 'high';
  return 'normal';
}

// Vibration is abnormal when it exceeds the stored baseline by more than the
// acceptable range (or the explicit detection threshold, when configured).
export function vibrationLimit(baseline) {
  if (!baseline) return null;
  return baseline.detectionThreshold ?? baseline.baselineValue + baseline.acceptableRange;
}
