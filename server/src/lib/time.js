// Timestamps are stored as ISO-8601 UTC strings so they sort lexicographically
// and range-query identically in Firestore and the local store.

export const nowIso = () => new Date().toISOString();

export function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// Local calendar day key, e.g. "2026-10-31".
export function dayKey(date) {
  const d = new Date(date);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// ISO week start (Monday) key.
export function weekKey(date) {
  const d = startOfDay(date);
  const offset = (d.getDay() + 6) % 7;
  return dayKey(addDays(d, -offset));
}

export function monthKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
