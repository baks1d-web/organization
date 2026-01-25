import { STATE } from '../core/state.js';
import { apiFetch } from '../core/api.js';
import { escapeHtml } from '../core/utils.js';

export async function loadFinance() {
  const data = await apiFetch('/api/finance');
  STATE.financeCache = data.items || [];

  renderFinanceForSelectedDate();
}

export function renderFinanceForSelectedDate() {
  const container = document.getElementById('finance-list');
  if (!container) return;
  const iso = STATE.selectedDate;
  const items = (STATE.financeCache || []).filter(i => String(i.created_at || '').slice(0, 10) === iso);

  container.innerHTML = '';

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'На эту дату финансовых записей нет.';
    container.appendChild(empty);
    return;
  }

  items.forEach(i => {
    const div = document.createElement('div');
    div.className = `finance-row ${i.amount > 0 ? 'plus' : 'minus'}`;
    div.innerHTML = `${i.amount} ₽ <span>${escapeHtml(i.title)}</span>`;
    container.appendChild(div);
  });
}


export async function loadFinanceCache() {
  try {
    const data = await apiFetch('/api/finance');
    STATE.financeCache = data.items || [];
    return STATE.financeCache;
  } catch {
    return [];
  }
}

export function getFinanceByDate(iso) {
  const items = STATE.financeCache || [];
  return items.filter(i => String(i.created_at || '').slice(0,10) === iso);
}

// обновлять финансы при смене даты (только когда экран активен)
window.addEventListener('date:changed', () => {
  if (document.getElementById('finance')?.classList.contains('active')) renderFinanceForSelectedDate();
});
