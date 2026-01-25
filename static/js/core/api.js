import { getToken } from './storage.js';

export function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      ...authHeaders(),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const msg = data.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}
