import { loadHome } from './home.js';
import { loadTasks } from './tasks.js';
import { loadFinance } from './personal_finance.js';
import { loadGroupScreen } from './groups.js';
import { loadNotificationSettings } from './settings.js';

export function switchScreen(ctx) {
  const id = ctx?.dataset?.screen;
  const title = ctx?.dataset?.title || '';
  const el = ctx?.el;
  if (!id) return;

  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');

  document.getElementById('screen-title').textContent = title;

  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  if (el) el.classList.add('active');

  loadCurrentScreen();
}

export function loadCurrentScreen() {
  const active = document.querySelector('.screen.active');
  if (!active) return;

  if (active.id === 'home') loadHome();
  if (active.id === 'tasks') loadTasks();
  if (active.id === 'finance') loadFinance();
  if (active.id === 'settings') loadNotificationSettings();
  if (active.id === 'group_tasks') loadGroupScreen();
}
