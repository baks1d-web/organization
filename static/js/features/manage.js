import { apiFetch } from '../core/api.js';
import { STATE } from '../core/state.js';
import { escapeHtml } from '../core/utils.js';
import { openModal, closeModal } from '../ui/modals.js';
import { loadGroupFinance } from './groups.js';

export async function openManageModal(ctx) {
  const mode = ctx?.dataset?.mode;
  if (!STATE.selectedGroupId) { alert('Сначала выберите общую группу'); return; }
  STATE.manageMode = (mode === 'methods') ? 'methods' : 'categories';

  const title = document.getElementById('manage-title');
  if (title) title.textContent = STATE.manageMode === 'categories' ? 'Статьи расхода' : 'Способы оплаты';

  document.getElementById('manage-new-name').value = '';
  openModal('manage-modal');

  await renderManageList();
}

async function renderManageList() {
  const list = document.getElementById('manage-items');
  if (!list) return;
  list.innerHTML = '';

  const endpoint = STATE.manageMode === 'categories'
    ? `/api/groups/${STATE.selectedGroupId}/finance/categories`
    : `/api/groups/${STATE.selectedGroupId}/finance/methods`;

  const data = await apiFetch(endpoint);
  const items = data.items || [];

  items.forEach(it => {
    const row = document.createElement('div');
    row.className = 'manage-item';
    row.innerHTML = `
      <div class="manage-name">${escapeHtml(it.name)}</div>
      <button class="mini-btn danger" data-id="${it.id}">Удалить</button>
    `;
    row.querySelector('button')?.addEventListener('click', async () => {
      try {
        await apiFetch(endpoint, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: it.id }),
        });
        delete STATE.financeMetaCacheByGroup[STATE.selectedGroupId];
        await renderManageList();
        await loadGroupFinance();
      } catch (e) {
        alert('Не удалось удалить: ' + (e.message || e));
      }
    });
    list.appendChild(row);
  });
}

export async function manageAdd() {
  const name = document.getElementById('manage-new-name').value.trim();
  if (!name) return;

  const endpoint = STATE.manageMode === 'categories'
    ? `/api/groups/${STATE.selectedGroupId}/finance/categories`
    : `/api/groups/${STATE.selectedGroupId}/finance/methods`;

  try {
    await apiFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });

    document.getElementById('manage-new-name').value = '';
    delete STATE.financeMetaCacheByGroup[STATE.selectedGroupId];

    await renderManageList();
    await loadGroupFinance();
  } catch (e) {
    alert('Не удалось добавить: ' + (e.message || e));
  }
}

export function closeManageModal() {
  closeModal('manage-modal');
}
