import { apiFetch } from '../core/api.js';
import { escapeHtml } from '../core/utils.js';

export async function loadFinance() {
  const data = await apiFetch('/api/finance');
  const container = document.getElementById('finance-list');
  if (!container) return;
  container.innerHTML = '';

  (data.items || []).forEach(i => {
    const div = document.createElement('div');
    div.className = `finance-row ${i.amount > 0 ? 'plus' : 'minus'}`;
    div.innerHTML = `${i.amount} ₽ <span>${escapeHtml(i.title)}</span>`;
    container.appendChild(div);
  });
}
