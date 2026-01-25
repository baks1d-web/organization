import { apiFetch } from '../core/api.js';
import { STATE } from '../core/state.js';
import { filterTasksByMode, isUrgentByDeadline } from '../core/utils.js';
import { renderTaskList, loadPersonalTasks } from './tasks.js';

export async function loadHome() {
  await loadPersonalTasks();
  renderHomeTasks();
  await loadBalance();
}

export function setFilter(ctx) {
  const mode = ctx?.dataset?.filter;
  if (!mode) return;
  STATE.homeFilter = mode;
  document.querySelectorAll('#home .chip').forEach(b => b.classList.remove('active'));
  ctx.el?.classList.add('active');
  STATE.homePage = 1;
  renderHomeTasks();
}

export function renderHomeTasks() {
  const tasks = STATE.tasksCache || [];
  const urgentCount = tasks.filter(t => !t.done && isUrgentByDeadline(t.deadline, 3)).length;
  const uc = document.getElementById('home-urgent-count');
  if (uc) uc.textContent = String(urgentCount);

  const filtered = filterTasksByMode(tasks, STATE.homeFilter || 'today');
  renderTaskList('home-tasks', filtered, STATE.homePage, 'home');
}

async function loadBalance() {
  try {
    const data = await apiFetch('/api/balance');
    document.getElementById('home-balance').textContent = `${data.balance} ₽`;
  } catch {
    document.getElementById('home-balance').textContent = '—';
  }
}
