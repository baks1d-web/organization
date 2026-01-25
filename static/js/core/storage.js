export function setToken(token) {
  if (token) localStorage.setItem('access_token', token);
}
export function getToken() {
  return localStorage.getItem('access_token') || '';
}
export function setDefaultGroupId(defaultGroupId, { force = false } = {}) {
  if (!defaultGroupId) return;
  const current = localStorage.getItem('default_group_id');
  if (force || !current) {
    localStorage.setItem('default_group_id', String(defaultGroupId));
  }
}

export function syncUserContext(user) {
  if (!user || !user.id) return;
  const storedUserId = localStorage.getItem('user_id');
  if (storedUserId !== String(user.id)) {
    localStorage.setItem('user_id', String(user.id));
    localStorage.removeItem('default_group_id');
  }
}
