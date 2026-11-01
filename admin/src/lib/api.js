// Thin fetch wrapper for the SeeWater API (proxied same-origin under /api).

export class ApiError extends Error {
  constructor(status, message, fields = {}) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

export function toQuery(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export async function api(path, { method = 'GET', body, query, signal } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}${toQuery(query)}`, {
      method,
      signal,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'Cannot reach the SeeWater server. Check your connection and try again.');
  }

  if (res.status === 204) return null;
  const json = await res.json().catch(() => null);

  if (!res.ok) {
    // An expired session anywhere in the app sends the admin back to sign in.
    if (res.status === 401 && !path.startsWith('/auth/login') && typeof window !== 'undefined') {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.assign(`/login?next=${next}&expired=1`);
    }
    const message =
      json?.error?.message ||
      (res.status >= 500 ? 'The server ran into a problem. Please try again.' : `Request failed (${res.status})`);
    throw new ApiError(res.status, message, json?.error?.fields || {});
  }
  return json;
}
