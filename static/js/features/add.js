import { apiFetch } from '../core/api.js';
import { STATE } from '../core/state.js';
import { escapeHtml } from '../core/utils.js';
import { openModal, closeModal } from '../ui/modals.js';
import { userDisplayName } from './users.js';
import { loadPersonalTasks, loadTasks } from './tasks.js';
import { renderHomeTasks } from './home.js';
import { loadGroupFinance, loadGroupTasks, getGroupFinanceMeta } from './groups.js';
import { loadFinance } from './personal_finance.js';

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getContextGroupIdForTasks() {
  const active = document.querySelector('.screen.active')?.id;
  if (active === 'group_tasks' && STATE.selectedGroupId) return STATE.selectedGroupId;
  return Number(localStorage.getItem('default_group_id') || '1') || 1;
}

async function fetchGroupMembers(groupId) {
  if (STATE.membersCacheByGroup[groupId]) return STATE.membersCacheByGroup[groupId];
  const data = await apiFetch(`/api/groups/${groupId}/members`);
  STATE.membersCacheByGroup[groupId] = data.items || [];
  return STATE.membersCacheByGroup[groupId];
}

async function fetchAllUsers() {
  if (STATE.allUsersCache) return STATE.allUsersCache;
  const data = await apiFetch('/api/users');
  STATE.allUsersCache = data.items || [];
  return STATE.allUsersCache;
}

async function getAssigneeUniverse(groupId) {
  const [members, allUsers] = await Promise.all([fetchGroupMembers(groupId), fetchAllUsers()]);
  const map = new Map();
  (allUsers || []).forEach(u => map.set(u.id, u));
  (members || []).forEach(u => map.set(u.id, u));
  const ids = [...map.keys()].sort((a, b) => a - b);
  return ids.map(id => map.get(id));
}

function renderAssigneesPicker(containerId, users) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  (users || []).forEach(u => {
    const row = document.createElement('label');
    row.className = 'assignee-item';
    row.innerHTML = `<input type="checkbox" value="${u.id}"><span>${escapeHtml(userDisplayName(u))}</span>`;
    container.appendChild(row);
  });

  const first = container.querySelector('input[type="checkbox"]');
  if (first) first.checked = true;
}

function fillSelectOptions(selectId, items) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = '';
  (items || []).forEach(it => {
    const opt = document.createElement('option');
    opt.value = String(it.id);
    opt.textContent = it.name;
    sel.appendChild(opt);
  });
}

export async function openAddModal() {
  const active = document.querySelector('.screen.active')?.id;

  if (active === 'group_tasks' && !STATE.selectedGroupId) {
    alert('Сначала выберите общую группу (или создайте и пригласите участника).');
    return;
  }

  openModal('add-modal');

  const dt = new Date();
  const plus7 = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + 7);
  const dl = document.getElementById('add-task-deadline');
  if (dl) dl.value = toISODate(plus7);

  const groupIdForTask = getContextGroupIdForTasks();
  const universe = await getAssigneeUniverse(groupIdForTask);
  renderAssigneesPicker('add-task-assignees', universe);

  if (active === 'group_tasks' && STATE.selectedGroupId && STATE.commonTab === 'finance') {
    const meta = await getGroupFinanceMeta(STATE.selectedGroupId);
    fillSelectOptions('add-fin-category', meta.categories);
    fillSelectOptions('add-fin-method', meta.methods);
  } else {
    fillSelectOptions('add-fin-category', []);
    fillSelectOptions('add-fin-method', []);
  }

  renderAddType();
}

export function renderAddType() {
  const type = document.querySelector('input[name="add-type"]:checked')?.value || 'task';
  const taskFields = document.getElementById('add-task-fields');
  const finFields = document.getElementById('add-finance-fields');

  if (type === 'task') {
    taskFields?.classList.remove('hidden');
    finFields?.classList.add('hidden');
  } else {
    taskFields?.classList.add('hidden');
    finFields?.classList.remove('hidden');
  }
}

export async function saveAddModal() {
  const type = document.querySelector('input[name="add-type"]:checked')?.value || 'task';

  try {
    if (type === 'task') {
      const groupId = getContextGroupIdForTasks();

      const title = document.getElementById('add-task-title').value.trim();
      const description = document.getElementById('add-task-desc').value.trim();
      const deadline = document.getElementById('add-task-deadline').value;

      if (!title) { alert('Введите название'); return; }

      const assignees = [...document.querySelectorAll('#add-task-assignees input[type="checkbox"]')]
        .filter(cb => cb.checked)
        .map(cb => Number(cb.value))
        .filter(n => Number.isFinite(n));

      if (!assignees.length) { alert('Выберите хотя бы одного исполнителя'); return; }

      const responsible_id = assignees[0];
      const assignee_ids = assignees;

      await apiFetch(`/api/groups/${groupId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, deadline: deadline || null, responsible_id, assignee_ids }),
      });

      await loadPersonalTasks();
      renderHomeTasks();
      await loadTasks();

      if (STATE.selectedGroupId && groupId === STATE.selectedGroupId) {
        if (STATE.commonTab === 'finance') await loadGroupFinance();
        else await loadGroupTasks();
      }
    } else {
      const active = document.querySelector('.screen.active')?.id;

      if (active === 'group_tasks' && STATE.selectedGroupId && STATE.commonTab === 'finance') {
        const kind = type === 'income' ? 'income' : 'expense';
        const description = document.getElementById('add-fin-desc').value.trim();
        const amount = Number(document.getElementById('add-fin-amount').value);

        if (!amount || isNaN(amount) || amount <= 0) { alert('Введите корректную сумму'); return; }

        const category_id = Number(document.getElementById('add-fin-category').value || '0') || null;
        const method_id = Number(document.getElementById('add-fin-method').value || '0') || null;

        await apiFetch(`/api/groups/${STATE.selectedGroupId}/finance`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, amount: Math.trunc(amount), description, category_id, method_id }),
        });

        await loadGroupFinance();
      } else {
        const title = (document.getElementById('add-fin-desc').value || '').trim() || 'Операция';
        const amount = Number(document.getElementById('add-fin-amount').value);
        if (!amount || isNaN(amount)) { alert('Введите корректную сумму'); return; }
        const signed = Math.trunc(amount) * (type === 'income' ? 1 : -1);

        await apiFetch('/api/finance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, amount: signed }),
        });

        await loadFinance();
        // баланс подгружается на Home, тут просто не ломаем
      }
    }

    closeModal('add-modal');
    document.getElementById('add-task-title').value = '';
    document.getElementById('add-task-desc').value = '';
    document.getElementById('add-fin-desc').value = '';
    document.getElementById('add-fin-amount').value = '';
  } catch (e) {
    alert('Ошибка сохранения: ' + (e.message || e));
  }
}
