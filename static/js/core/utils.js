export function getParams() {
  try { return new URLSearchParams(window.location.search); } catch { return new URLSearchParams(); }
}
export function getUrlToken() {
  const p = getParams();
  return p.get('token') || '';
}
export function getInviteToken() {
  const p = getParams();
  return p.get('invite') || '';
}
export function cleanupUrlParams() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('invite');
    url.searchParams.delete('token');
    window.history.replaceState({}, '', url.toString());
  } catch {}
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function parseISODate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).split('-').map(x => Number(x));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
export function startOfDay(dt) {
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
}
export function daysDiff(a, b) {
  const ms = startOfDay(b) - startOfDay(a);
  return Math.round(ms / (1000 * 60 * 60 * 24));
}
export function isUrgentByDeadline(deadlineISO, days) {
  const dl = parseISODate(deadlineISO);
  if (!dl) return false;
  const today = new Date();
  const diff = daysDiff(today, dl);
  return diff <= days;
}

export function filterTasksByMode(tasks, mode) {
  const today = startOfDay(new Date());
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const plus5 = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 5);

  return (tasks || []).filter(t => {
    const dl = parseISODate(t.deadline);
    if (!dl) return mode === 'all';
    const d = startOfDay(dl).getTime();

    if (mode === 'today') return d === startOfDay(today).getTime();
    if (mode === 'tomorrow') return d === startOfDay(tomorrow).getTime();
    if (mode === '5plus') return d >= startOfDay(plus5).getTime();
    return true;
  });
}


export function isoDate(d) {
  // YYYY-MM-DD in local time
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function ruDateParts(iso) {
  const d = new Date(iso + 'T00:00:00');
  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.round((d - t0) / (24 * 3600 * 1000));

  let relative = '';
  if (diffDays === -1) relative = 'Вчера';
  else if (diffDays === 0) relative = 'Сегодня';
  else if (diffDays === 1) relative = 'Завтра';
  else relative = d.toLocaleDateString('ru-RU', { weekday: 'short' }).replace('.', '');

  const pretty = d.toLocaleDateString('ru-RU', { weekday: 'short', day: '2-digit', month: 'short' })
    .replace('.', '');
  // e.g. "сб, 24 янв"
  const capPretty = pretty.charAt(0).toUpperCase() + pretty.slice(1);

  return { relative, pretty: capPretty };
}

export function isoFromCreatedAt(value) {
  if (!value) return null;
  try {
    return String(value).slice(0, 10);
  } catch {
    return null;
  }
}
