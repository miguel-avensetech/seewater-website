import { db, C } from '../db/index.js';

// System-wide defaults. Units: flow in L/min, usage in liters, vibration in the
// raw piezo sensor scale (0–1023 ADC counts from the ESP32).
export const DEFAULT_SETTINGS = {
  leakAlertsEnabled: true,
  highFlowAlertsEnabled: true,
  deviceOfflineAlertsEnabled: true,
  highFlowWarningLpm: 15,
  highFlowCriticalLpm: 25,
  leakMinFlowLpm: 0.3,
  dailyUsageWarningLiters: 1000,
  alertCooldownMinutes: 15,
  autoShutoffOnCriticalLeak: false,
};

export async function getSettings() {
  const doc = await db.get(C.settings, 'system');
  return { ...DEFAULT_SETTINGS, ...(doc || {}), id: 'system' };
}

export async function saveSettings(patch, admin) {
  const current = await getSettings();
  const { id, ...rest } = { ...current, ...patch };
  return db.set(C.settings, 'system', { ...rest, updatedAt: new Date().toISOString(), updatedBy: admin?.id ?? null });
}
