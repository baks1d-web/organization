import { apiFetch } from '../core/api.js';
import { STATE } from '../core/state.js';
import { isUrgentByDeadline } from '../core/utils.js';
import { renderTaskList, loadPersonalTasks } from './tasks.js';

export async function loadHome() {
  await loadPersonalTasks();
  // finance cache for calendar + daily view
  try { const mod = await import('./personal_finance.js'); await mod.loadFinanceCache(); } catch {}
  renderDayItems();
  await loadBalance();
}

export function setFilter() { /* deprecated: day-based header */ }



export function renderDayItems() {
  const iso = STATE.selectedDate;
  const tasks = (STATE.tasksCache || []).filter(t => !t.done && t.status !== 'done' && String(t.deadline || '').slice(0,10) === iso);
  const urgentCount = tasks.filter(t => isUrgentByDeadline(t.deadline, 3)).length;

  let financeItems = [];
  try {
    // finance cache comes from personal_finance module
    financeItems = (STATE.financeCache || []).filter(i => String(i.created_at || '').slice(0,10) === iso);
  } catch {}

  const summary = document.getElementById('day-summary');
  if (summary) summary.textContent = `Задач: ${tasks.length} (срочных: ${urgentCount}) • Записей: ${financeItems.length}`;

  const container = document.getElementById('home-day-items');
  if (!container) return;
  container.innerHTML = '';

  const mode = STATE.topFilter || 'tasks';

  if (mode === 'tasks' || mode === 'all') {
    const h = document.createElement('h3');
    h.textContent = 'Активные задачи';
    container.appendChild(h);
    if (tasks.length) {
      const wrap = document.createElement('div');
      wrap.id = 'home-day-tasks';
      container.appendChild(wrap);
      renderTaskList('home-day-tasks', tasks, 1, 'home');
    } else {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'На эту дату задач нет.';
      container.appendChild(empty);
    }
  }

  if (mode === 'finance' || mode === 'all') {
    const h = document.createElement('h3');
    h.textContent = 'Финансы';
    container.appendChild(h);

    if (financeItems.length) {
      financeItems.forEach(i => {
        const row = document.createElement('div');
        row.className = `finance-row ${i.amount > 0 ? 'plus' : 'minus'}`;
        row.innerHTML = `${i.amount} ₽ <span>${(i.title || '').replace(/[&<>"']/g, (c)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))}</span>`;
        container.appendChild(row);
      });
    } else {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'На эту дату финансовых записей нет.';
      container.appendChild(empty);
    }
  }
}

window.addEventListener('date:changed', () => {
  // re-render only when home is active
  if (document.getElementById('home')?.classList.contains('active')) renderDayItems();
});
window.addEventListener('date:filterChanged', () => {
  if (document.getElementById('home')?.classList.contains('active')) renderDayItems();
});

async function loadBalance() {
  try {
    const data = await apiFetch('/api/balance');
    document.getElementById('home-balance').textContent = `${data.balance} ₽`;
  } catch {
    document.getElementById('home-balance').textContent = '—';
  }
}
