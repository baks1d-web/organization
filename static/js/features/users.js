import { apiFetch } from '../core/api.js';
import { STATE } from '../core/state.js';

export async function fetchAllUsers() {
  if (STATE.allUsersCache) return STATE.allUsersCache;
  const data = await apiFetch('/api/users');
  STATE.allUsersCache = data.items || [];
  return STATE.allUsersCache;
}

export function userDisplayName(u) {
  return (u?.first_name || u?.username || `#${u?.id}`).trim();
}
