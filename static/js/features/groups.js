import { apiFetch } from '../core/api.js';
import { STATE } from '../core/state.js';
import { escapeHtml, filterTasksByMode, isUrgentByDeadline } from '../core/utils.js';
import { closeModal, openModal } from '../ui/modals.js';
import { renderTaskList } from './tasks.js';

export async function loadGroups() {
  const data = await apiFetch('/api/groups');
  STATE.groups = data.items || [];

  // restore last selected group if still accessible
  const saved = Number(localStorage.getItem('selected_group_id') || '0') || 0;
  const accessible = (STATE.groups || []).map(g => g.id);

  if (saved && accessible.includes(saved)) {
    STATE.selectedGroupId = saved;
  } else {
    const shared = getSharedGroups();
    STATE.selectedGroupId = shared.length ? shared[0].id : null;
    if (STATE.selectedGroupId) localStorage.setItem('selected_group_id', String(STATE.selectedGroupId));
  }

  updateCommonMode();
  renderGroupsList();
}

export async function loadGroupScreen() {
  await loadGroups();
  if (!STATE.selectedGroupId) return;
  if (STATE.commonTab === 'finance') await loadGroupFinance();
  else await loadGroupTasks();
}

function getSharedGroups() {
  return (STATE.groups || []).filter(g => (g.name || '').trim() !== 'Личная');
}

function updateCommonMode() {
  const header = document.getElementById('shared-group-header');
  const tabs = document.getElementById('shared-group-tabs');
  const tasksCard = document.getElementById('shared-group-tasks-card');
  const finCard = document.getElementById('shared-group-finance-card');

  const has = Boolean(STATE.selectedGroupId);
  if (!header || !tabs || !tasksCard || !finCard) return;

  if (!has) {
    header.classList.add('hidden');
    tabs.classList.add('hidden');
    tasksCard.classList.add('hidden');
    finCard.classList.add('hidden');
    return;
  }

  header.classList.remove('hidden');
  tabs.classList.remove('hidden');
  applyCommonTab();

  const g = (STATE.groups || []).find(x => x.id === STATE.selectedGroupId);
  const nameEl = document.getElementById('selected-group-name');
  if (nameEl) nameEl.textContent = g ? (g.name || `#${g.id}`) : `#${STATE.selectedGroupId}`;
}

function renderGroupsList() {
  const listEl = document.getElementById('groups-list');
  if (!listEl) return;

  const shared = getSharedGroups();
  listEl.innerHTML = '';

  if (!shared.length) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="muted">У вас нет общих групп.</div>
        <div class="muted small">Нажмите “Создать” и пригласите участника одноразовой ссылкой.</div>
      </div>
    `;
    return;
  }

  shared.forEach(g => {
    const item = document.createElement('div');
    item.className = 'group-item' + (g.id === STATE.selectedGroupId ? ' active' : '');
    item.innerHTML = `
      <div class="group-left">
        <div class="group-name">${escapeHtml(g.name || `#${g.id}`)}</div>
        <div class="group-sub muted">${g.members_count || 0} участн.</div>
      </div>
      <div class="group-right">Открыть →</div>
    `;
    item.addEventListener('click', async () => {
      STATE.selectedGroupId = g.id;
      localStorage.setItem('selected_group_id', String(g.id));
      document.getElementById('invite-box')?.classList.add('hidden');
      STATE.groupTasksPage = 1;
      STATE.membersCacheByGroup = {};
      STATE.financeMetaCacheByGroup = {};
      updateCommonMode();
      renderGroupsList();

      if (STATE.commonTab === 'finance') await loadGroupFinance();
      else await loadGroupTasks();
    });
    listEl.appendChild(item);
  });
}

function applyCommonTab() {
  const tasksCard = document.getElementById('shared-group-tasks-card');
  const finCard = document.getElementById('shared-group-finance-card');
  const tabTasks = document.getElementById('tab-tasks');
  const tabFin = document.getElementById('tab-finance');

  if (!tasksCard || !finCard || !tabTasks || !tabFin) return;

  if (STATE.commonTab === 'finance') {
    tasksCard.classList.add('hidden');
    finCard.classList.remove('hidden');
    tabTasks.classList.remove('active');
    tabFin.classList.add('active');
  } else {
    finCard.classList.add('hidden');
    tasksCard.classList.remove('hidden');
    tabFin.classList.remove('active');
    tabTasks.classList.add('active');
  }
}

export async function setTab(ctx) {
  const tab = ctx?.dataset?.tab;
  STATE.commonTab = (tab === 'finance') ? 'finance' : 'tasks';
  applyCommonTab();

  if (!STATE.selectedGroupId) return;
  if (STATE.commonTab === 'finance') await loadGroupFinance();
  else await loadGroupTasks();
}

export function setFilter(ctx) {
  const mode = ctx?.dataset?.filter;
  if (!mode) return;
  STATE.groupFilter = mode;
  document.querySelectorAll('#group_tasks #shared-group-tasks-card .chip').forEach(b => b.classList.remove('active'));
  ctx.el?.classList.add('active');
  STATE.groupTasksPage = 1;
  loadGroupTasks();
}

export async function loadGroupTasks() {
  updateCommonMode();
  if (!STATE.selectedGroupId) return;

  const data = await apiFetch(`/api/groups/${STATE.selectedGroupId}/tasks`);
  const tasks = data.items || [];
  STATE.groupTasksCache = tasks;

  const urgentCount = tasks.filter(t => !t.done && isUrgentByDeadline(t.deadline, 3)).length;
  const uc = document.getElementById('urgent-count');
  if (uc) uc.textContent = String(urgentCount);

  const filtered = filterTasksByMode(tasks, STATE.groupFilter || 'today');
  renderTaskList('group-tasks-list', filtered, STATE.groupTasksPage, 'group');
}

// ---- Group finance ----
export async function getGroupFinanceMeta(groupId) {
  if (STATE.financeMetaCacheByGroup[groupId]) return STATE.financeMetaCacheByGroup[groupId];
  const [cats, methods] = await Promise.all([
    apiFetch(`/api/groups/${groupId}/finance/categories`),
    apiFetch(`/api/groups/${groupId}/finance/methods`),
  ]);
  STATE.financeMetaCacheByGroup[groupId] = {
    categories: cats.items || [],
    methods: methods.items || [],
  };
  return STATE.financeMetaCacheByGroup[groupId];
}

export async function loadGroupFinance() {
  if (!STATE.selectedGroupId) return;

  const data = await apiFetch(`/api/groups/${STATE.selectedGroupId}/finance`);
  const balEl = document.getElementById('group-balance');
  if (balEl) balEl.textContent = `${data.balance} ₽`;

  const list = document.getElementById('group-finance-list');
  if (!list) return;
  list.innerHTML = '';

  (data.items || []).forEach(it => {
    const div = document.createElement('div');
    div.className = `finance-row ${it.kind === 'income' ? 'plus' : 'minus'}`;
    const cat = it.category ? it.category.name : '—';
    const met = it.method ? it.method.name : '—';
    const sign = it.kind === 'income' ? '+' : '-';
    div.innerHTML = `
      <div class="fin-left">
        <div class="fin-title">${escapeHtml(it.description || 'Без описания')}</div>
        <div class="fin-sub muted">${escapeHtml(cat)} • ${escapeHtml(met)}</div>
      </div>
      <div class="fin-amount">${sign}${it.amount} ₽</div>
    `;
    list.appendChild(div);
  });

  await getGroupFinanceMeta(STATE.selectedGroupId);
}

// ---- Create group modal ----
export function openCreateModal() {
  document.getElementById('create-group-name').value = '';
  openModal('create-group-modal');
}

export async function createGroup() {
  const name = (document.getElementById('create-group-name').value || '').trim();
  if (!name) { alert('Введите название группы'); return; }

  try {
    await apiFetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });

    closeModal('create-group-modal');
    await loadGroups();

    alert('Группа создана ✅\nТеперь нажмите “Пригласить” после того как добавите участника.');
  } catch (e) {
    alert('Не удалось создать группу: ' + (e.message || e));
  }
}

// ---- Invite by username ----
export function openInviteModal() {
  if (!STATE.selectedGroupId) { alert('Сначала выберите группу'); return; }
  document.getElementById('invite-username-input').value = '';
  openModal('invite-user-modal');
}

export async function sendInviteByUsername() {
  if (!STATE.selectedGroupId) return;

  const raw = (document.getElementById('invite-username-input').value || '').trim();
  if (!raw) { alert('Введите @username'); return; }

  try {
    await apiFetch(`/api/groups/${STATE.selectedGroupId}/invites/username`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: raw }),
    });

    closeModal('invite-user-modal');

    const box = document.getElementById('invite-by-username-box');
    const res = document.getElementById('invite-username-result');
    if (res) res.textContent = raw;
    if (box) box.classList.remove('hidden');

    alert('Приглашение создано ✅\nПользователь должен принять его в боте.');
  } catch (e) {
    alert('Не удалось пригласить: ' + (e.message || e));
  }
}

export async function copyInvite() {
  const input = document.getElementById('invite-link');
  if (!input) return;
  try {
    await navigator.clipboard.writeText(input.value || '');
    alert('Скопировано ✅');
  } catch {
    input.select();
    document.execCommand('copy');
    alert('Скопировано ✅');
  }
}
