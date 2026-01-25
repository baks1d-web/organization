import { apiFetch } from '../core/api.js';

export async function loadNotificationSettings() {
  try {
    const data = await apiFetch('/api/settings/notifications');
    const s = data.item || {};
    const a = document.getElementById('notify-new-task');
    const b = document.getElementById('notify-task-updates');
    if (a) a.checked = Boolean(s.notify_new_task);
    if (b) b.checked = Boolean(s.notify_task_updates);
  } catch (e) {
    console.warn('Failed to load notification settings', e);
  }
}

export async function saveNotificationSettings() {
  const a = document.getElementById('notify-new-task')?.checked;
  const b = document.getElementById('notify-task-updates')?.checked;

  try {
    await apiFetch('/api/settings/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notify_new_task: Boolean(a),
        notify_task_updates: Boolean(b),
      }),
    });
    alert('Сохранено');
  } catch (e) {
    alert('Не удалось сохранить: ' + (e.message || e));
  }
}
