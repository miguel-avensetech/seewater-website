// Display formatting. Units are fixed across the app: liters (L) and L/min.

const LOCALE = 'en-PH';

export function fmtNumber(v, digits = 0) {
  if (v == null || Number.isNaN(v)) return '—';
  return Number(v).toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtLiters(v, { digits } = {}) {
  if (v == null) return '—';
  const d = digits ?? (v === 0 || Math.abs(v) >= 10 ? 0 : 1);
  return `${fmtNumber(v, d)} L`;
}

export function fmtFlow(v) {
  if (v == null) return '—';
  return `${fmtNumber(v, 1)} L/min`;
}

export function fmtPct(v, digits = 1) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${fmtNumber(v, digits)}%`;
}

export function fmtDate(v, opts = {}) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString(LOCALE, { year: 'numeric', month: 'short', day: 'numeric', ...opts });
}

export function fmtDateTime(v) {
  if (!v) return '—';
  return new Date(v).toLocaleString(LOCALE, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function fmtTime(v) {
  if (!v) return '—';
  return new Date(v).toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' });
}

export function fmtRelative(v, now = Date.now()) {
  if (!v) return 'Never';
  const diff = Math.round((now - new Date(v).getTime()) / 1000);
  const future = diff < 0;
  const s = Math.abs(diff);
  const unit = s < 60 ? [s, 'sec'] : s < 3600 ? [Math.round(s / 60), 'min'] : s < 86400 ? [Math.round(s / 3600), 'hr'] : [Math.round(s / 86400), 'day'];
  if (s < 30) return 'Just now';
  const label = `${unit[0]} ${unit[1]}${unit[0] === 1 || unit[1] === 'sec' || unit[1] === 'min' || unit[1] === 'hr' ? '' : 's'}`;
  return future ? `in ${label}` : `${label} ago`;
}

// "2026-10-31" → "Oct 31"; "2026-10" → "Oct 2026"
export function fmtBucket(key, period) {
  if (period === 'monthly') {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(LOCALE, { month: 'short', year: 'numeric' });
  }
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const label = date.toLocaleDateString(LOCALE, { month: 'short', day: 'numeric' });
  return period === 'weekly' ? `Wk of ${label}` : label;
}

export function toDateInput(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

export function toDateTimeInput(d) {
  if (!d) return '';
  const x = new Date(d);
  return `${toDateInput(x)}T${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
}

export const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
