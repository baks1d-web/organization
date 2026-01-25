import { loadHome } from './home.js';
import { loadTasks } from './tasks.js';
import { loadFinance } from './personal_finance.js';
import { loadGroupScreen } from './groups.js';
import { loadNotificationSettings } from './settings.js';
import { STATE } from '../core/state.js';

function setHash(id) {
  try {
    if (location.hash !== `#${id}`) location.hash = `#${id}`;
  } catch {}
}

function setActiveScreen(id, title = '', navEl = null) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');

  document.getElementById('screen-title').textContent = title;

  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  if (navEl) navEl.classList.add('active');

  setHash(id);
  window.dispatchEvent(new CustomEvent('page:changed', { detail: { id } }));
}

export function goToScreen(id, { title = '', navEl = null, push = true } = {}) {
  const current = document.querySelector('.screen.active')?.id;
  if (push && current && current !== id) STATE.navStack.push(current);
  setActiveScreen(id, title, navEl);
  loadCurrentScreen();
}

export function goBack(fallback = 'home') {
  const prev = STATE.navStack.pop();
  const id = prev || fallback;
  // keep title from header data if possible
  const navItem = document.querySelector(`.nav-item[data-screen="${id}"]`);
  const title = navItem?.dataset?.title || (id === 'add' ? 'Добавить' : '');
  setActiveScreen(id, title, navItem);
  loadCurrentScreen();
}

export function switchScreen(ctx) {
  const id = ctx?.dataset?.screen;
  const title = ctx?.dataset?.title || '';
  const el = ctx?.el;
  if (!id) return;

  goToScreen(id, { title, navEl: el, push: true });
}

export function initRouting(defaultId = 'home') {
  const initial = (location.hash || '').replace('#', '') || defaultId;
  // Don't push initial to stack
  const navItem = document.querySelector(`.nav-item[data-screen="${initial}"]`);
  const title = navItem?.dataset?.title || (initial === 'add' ? 'Добавить' : '');
  setActiveScreen(initial, title, navItem);

  window.addEventListener('hashchange', () => {
    const id = (location.hash || '').replace('#', '') || defaultId;
    const navEl = document.querySelector(`.nav-item[data-screen="${id}"]`);
    const t = navEl?.dataset?.title || (id === 'add' ? 'Добавить' : '');
    // hash navigation shouldn't push into stack
    setActiveScreen(id, t, navEl);
    loadCurrentScreen();
  });
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
