/* global Telegram */

const tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;

function getParams() {
  try { return new URLSearchParams(window.location.search); } catch { return new URLSearchParams(); }
}
function getUrlToken() {
  const p = getParams();
  return p.get('token') || '';
}
function getInviteToken() {
  const p = getParams();
  return p.get('invite') || '';
}
function cleanupUrlParams() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('invite');
    url.searchParams.delete('token');
    window.history.replaceState({}, '', url.toString());
  } catch {}
}

function setToken(token) {
  if (token) localStorage.setItem('access_token', token);
}
function getToken() {
  return localStorage.getItem('access_token') || '';
}
function setDefaultGroupId(defaultGroupId, { force = false } = {}) {
  if (!defaultGroupId) return;
  const current = localStorage.getItem('default_group_id');
  if (force || !current) {
    localStorage.setItem('default_group_id', String(defaultGroupId));
  }
}

function syncUserContext(user) {
  if (!user || !user.id) return;
  const storedUserId = localStorage.getItem('user_id');
  if (storedUserId !== String(user.id)) {
    localStorage.setItem('user_id', String(user.id));
    localStorage.removeItem('default_group_id');
  }
}
function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const STATE = {
  pageSize: 5,

  homePage: 1,
  tasksPage: 1,
  groupTasksPage: 1,

  tasksCache: [],
  groupTasksCache: [],

  homeFilter: 'today',

  groups: [],
  selectedGroupId: null,
  groupFilter: 'today',

  commonTab: 'tasks', // tasks | finance

  membersCacheByGroup: {},
  allUsersCache: null,
  financeMetaCacheByGroup: {},

  currentTask: null,
  manageMode: null, // 'categories'|'methods'
};

async function bootAfterLogin() {
  await loadGroups();
  loadCurrentScreen();
}

function enterApp() {
  document.getElementById('auth').classList.remove('active');
  document.getElementById('auth').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('app').classList.add('active');

  bootAfterLogin();
}

function showAuthError(msg) {
  console.error(msg);
  alert(msg);
}

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      ...authHeaders(),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const msg = data.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// ---- Auth flows ----
async function loginWithTelegramInitData() {
  if (!tg || !tg.initData) return false;

  const res = await fetch('/api/auth/telegram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData: tg.initData }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);

  setToken(data.access_token);
  localStorage.setItem('default_group_id', String(data.default_group_id || ''));
  return true;
}

async function loginWithUrlToken() {
  const token = getUrlToken();
  if (!token) return false;

  setToken(token);
  const me = await apiFetch('/api/me');
  localStorage.setItem('default_group_id', String(me.default_group_id || ''));
  return true;
}

async function loginWithStoredToken() {
  const token = getToken();
  if (!token) return false;
  try {
    const me = await apiFetch('/api/me');
    localStorage.setItem('default_group_id', String(me.default_group_id || ''));
    return true;
  } catch {
    localStorage.removeItem('access_token');
    return false;
  }
}

async function autoLogin() {
  try { if (await loginWithTelegramInitData()) { enterApp(); return; } } catch (e) { console.warn(e); }
  try { if (await loginWithUrlToken()) { enterApp(); return; } } catch (e) { console.warn(e); }
  try { if (await loginWithStoredToken()) { enterApp(); return; } } catch (e) { console.warn(e); }
}

window.loginTelegram = async function loginTelegram() {
  try { await autoLogin(); } catch (e) { showAuthError('Не удалось войти: ' + (e.message || e)); }
};

window.loginEmail = function loginEmail() {
  showAuthError('Вход по почте не реализован. Используй Telegram.');
};



// ---- Navigation ----
window.switchScreen = function switchScreen(id, title, el) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');

  document.getElementById('screen-title').textContent = title;

  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  if (el) el.classList.add('active');

  loadCurrentScreen();
};

function loadCurrentScreen() {
  const active = document.querySelector('.screen.active');
  if (!active) return;

  if (active.id === 'home') loadHome();
  if (active.id === 'tasks') loadTasks();
  if (active.id === 'finance') loadFinance();
  if (active.id === 'settings') loadNotificationSettings();

  if (active.id === 'group_tasks') {
    loadGroups().then(() => {
      if (STATE.selectedGroupId) {
        if (STATE.commonTab === 'finance') loadGroupFinance();
        else loadGroupTasks();
      }
    });
  }
}

// ---- Date helpers ----
function parseISODate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).split('-').map(x => Number(x));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function startOfDay(dt) {
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
}
function daysDiff(a, b) {
  const ms = startOfDay(b) - startOfDay(a);
  return Math.round(ms / (1000 * 60 * 60 * 24));
}
function isUrgentByDeadline(deadlineISO, days) {
  const dl = parseISODate(deadlineISO);
  if (!dl) return false;
  const today = new Date();
  const diff = daysDiff(today, dl);
  return diff <= days;
}

function filterTasksByMode(tasks, mode) {
  const today = startOfDay(new Date());
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const plus5 = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 5);

  return tasks.filter(t => {
    const dl = parseISODate(t.deadline);
    if (!dl) return mode === 'all';
    const d = startOfDay(dl).getTime();

    if (mode === 'today') return d === startOfDay(today).getTime();
    if (mode === 'tomorrow') return d === startOfDay(tomorrow).getTime();
    if (mode === '5plus') return d >= startOfDay(plus5).getTime();
    return true;
  });
}

// ---- Render tasks list with pagination ----
function renderTaskList(containerId, tasks, page, key) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const pageSize = STATE.pageSize;
  const total = tasks.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  if (key === 'home') STATE.homePage = safePage;
  if (key === 'tasks') STATE.tasksPage = safePage;
  if (key === 'group') STATE.groupTasksPage = safePage;

  container.innerHTML = '';

  const slice = tasks.slice((safePage - 1) * pageSize, safePage * pageSize);
  if (slice.length === 0) container.innerHTML = '<p class="muted">Пока нет задач</p>';

  slice.forEach(t => {
    const div = document.createElement('div');
    div.className = 'task' + (t.done ? ' done' : '');

    const deadlineText = t.deadline ? `до ${escapeHtml(t.deadline)}` : 'без срока';
    const flame = isUrgentByDeadline(t.deadline, 3) && !t.done ? '🔥 ' : '';
    div.innerHTML = `
      <div class="task-row">
        <div class="task-meta">
          <div class="task-title">${flame}${escapeHtml(t.title)}</div>
          <div class="task-sub">${deadlineText}</div>
        </div>
        <div class="status-badge">${escapeHtml(t.status_label || 'Новая')}</div>
      </div>
    `;
    div.onclick = () => openTaskModal(t.id);
    container.appendChild(div);
  });

  if (totalPages > 1) {
    const pager = document.createElement('div');
    pager.className = 'pagination';

    const prev = document.createElement('button');
    prev.className = 'pager-btn';
    prev.textContent = '←';
    prev.disabled = safePage <= 1;
    prev.onclick = (e) => {
      e.stopPropagation();
      renderTaskList(containerId, tasks, safePage - 1, key);
    };

    const next = document.createElement('button');
    next.className = 'pager-btn';
    next.textContent = '→';
    next.disabled = safePage >= totalPages;
    next.onclick = (e) => {
      e.stopPropagation();
      renderTaskList(containerId, tasks, safePage + 1, key);
    };

    const label = document.createElement('div');
    label.className = 'pager-label';
    label.textContent = `${safePage} / ${totalPages}`;

    pager.appendChild(prev);
    pager.appendChild(label);
    pager.appendChild(next);
    container.appendChild(pager);
  }
}

// ---- HOME ----
window.setHomeFilter = function setHomeFilter(mode, btn) {
  STATE.homeFilter = mode;
  document.querySelectorAll('#home .chip').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  STATE.homePage = 1;
  renderHomeTasks();
};

async function loadHome() {
  await loadPersonalTasks();
  renderHomeTasks();
  loadBalance();
}

async function loadPersonalTasks() {
  const groupId = Number(localStorage.getItem('default_group_id') || '1') || 1;
  const data = await apiFetch(`/api/groups/${groupId}/tasks`);
  STATE.tasksCache = data.items || [];
}

function renderHomeTasks() {
  const tasks = STATE.tasksCache || [];
  const urgentCount = tasks.filter(t => !t.done && isUrgentByDeadline(t.deadline, 3)).length;
  const uc = document.getElementById('home-urgent-count');
  if (uc) uc.textContent = String(urgentCount);

  const filtered = filterTasksByMode(tasks, STATE.homeFilter || 'today');
  renderTaskList('home-tasks', filtered, STATE.homePage, 'home');
}

// ---- TASKS screen ----
async function loadTasks(containerId = 'all-tasks') {
  if (!STATE.tasksCache || STATE.tasksCache.length === 0) {
    await loadPersonalTasks();
  }
  renderTaskList(containerId, STATE.tasksCache || [], STATE.tasksPage, 'tasks');
}

// ---- Finance (personal) ----
async function loadFinance() {
  const data = await apiFetch('/api/finance');
  const container = document.getElementById('finance-list');
  container.innerHTML = '';

  (data.items || []).forEach(i => {
    const div = document.createElement('div');
    div.className = `finance-row ${i.amount > 0 ? 'plus' : 'minus'}`;
    div.innerHTML = `${i.amount} ₽ <span>${escapeHtml(i.title)}</span>`;
    container.appendChild(div);
  });
}

async function loadBalance() {
  try {
    const data = await apiFetch('/api/balance');
    document.getElementById('home-balance').textContent = `${data.balance} ₽`;
  } catch {
    document.getElementById('home-balance').textContent = '—';
  }
}

// ---- Users ----
async function fetchAllUsers() {
  if (STATE.allUsersCache) return STATE.allUsersCache;
  const data = await apiFetch('/api/users');
  STATE.allUsersCache = data.items || [];
  return STATE.allUsersCache;
}
function userDisplayName(u) {
  return (u.first_name || u.username || `#${u.id}`).trim();
}

// ---- Groups/common ----
async function loadGroups() {
  const data = await apiFetch('/api/groups');
  STATE.groups = data.items || [];

  // restore last selected group if still accessible
  const saved = Number(localStorage.getItem('selected_group_id') || '0') || 0;
  const accessible = STATE.groups.map(g => g.id);

  if (saved && accessible.includes(saved)) {
    STATE.selectedGroupId = saved;
  } else {
    // pick first shared group if exists, else null
    const shared = getSharedGroups();
    STATE.selectedGroupId = shared.length ? shared[0].id : null;
    if (STATE.selectedGroupId) localStorage.setItem('selected_group_id', String(STATE.selectedGroupId));
  }

  updateCommonMode();
  renderGroupsList();
}

function getSharedGroups() {
  // Показываем все группы кроме личной ("Личная"),
  // чтобы можно было пригласить пользователя до того, как группа станет "общей".
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
    item.onclick = async () => {
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
    };
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

window.setCommonTab = async function setCommonTab(tab) {
  STATE.commonTab = (tab === 'finance') ? 'finance' : 'tasks';
  applyCommonTab();

  if (!STATE.selectedGroupId) return;
  if (STATE.commonTab === 'finance') await loadGroupFinance();
  else await loadGroupTasks();
};

window.setGroupFilter = function setGroupFilter(mode, btn) {
  STATE.groupFilter = mode;
  document.querySelectorAll('#group_tasks #shared-group-tasks-card .chip').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  STATE.groupTasksPage = 1;
  loadGroupTasks();
};

async function loadGroupTasks() {
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

// ---- Create group flow (separate menu) ----
window.openCreateGroupModal = function openCreateGroupModal() {
  document.getElementById('create-group-name').value = '';
  document.getElementById('create-group-modal').classList.remove('hidden');
};

window.closeCreateGroupModal = function closeCreateGroupModal() {
  document.getElementById('create-group-modal').classList.add('hidden');
};

window.createGroup = async function createGroup() {
  const name = (document.getElementById('create-group-name').value || '').trim();
  if (!name) { alert('Введите название группы'); return; }

  try {
    const g = await apiFetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });

    closeCreateGroupModal();

    await loadGroups();

    // select newly created group only if it becomes shared later;
    // but owner is already member, members_count will be 1 until invite accepted.
    // We'll still allow selecting it once it becomes shared; for now it's in groups, but not shared.
    alert('Группа создана ✅\nТеперь нажмите “Пригласить” после того как добавите участника (ссылка одноразовая).');

  } catch (e) {
    alert('Не удалось создать группу: ' + (e.message || e));
  }
};

window.openInviteUserModal = function openInviteUserModal() {
  if (!STATE.selectedGroupId) { alert('Сначала выберите группу'); return; }
  document.getElementById('invite-username-input').value = '';
  document.getElementById('invite-user-modal').classList.remove('hidden');
};

window.closeInviteUserModal = function closeInviteUserModal() {
  document.getElementById('invite-user-modal').classList.add('hidden');
};

window.sendInviteByUsername = async function sendInviteByUsername() {
  if (!STATE.selectedGroupId) return;

  const raw = (document.getElementById('invite-username-input').value || '').trim();
  if (!raw) { alert('Введите @username'); return; }

  try {
    await apiFetch(`/api/groups/${STATE.selectedGroupId}/invites/username`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: raw }),
    });

    closeInviteUserModal();

    const box = document.getElementById('invite-by-username-box');
    const res = document.getElementById('invite-username-result');
    if (res) res.textContent = raw;
    if (box) box.classList.remove('hidden');

    alert('Приглашение создано ✅\nПользователь должен принять его в боте.');
  } catch (e) {
    alert('Не удалось пригласить: ' + (e.message || e));
  }
};



// ---- Members + all users as assignees ----
async function fetchGroupMembers(groupId) {
  if (STATE.membersCacheByGroup[groupId]) return STATE.membersCacheByGroup[groupId];
  const data = await apiFetch(`/api/groups/${groupId}/members`);
  STATE.membersCacheByGroup[groupId] = data.items || [];
  return STATE.membersCacheByGroup[groupId];
}

async function getAssigneeUniverse(groupId) {
  const [members, allUsers] = await Promise.all([fetchGroupMembers(groupId), fetchAllUsers()]);
  const map = new Map();
  (allUsers || []).forEach(u => map.set(u.id, u));
  (members || []).forEach(u => map.set(u.id, u));
  const ids = [...map.keys()].sort((a, b) => a - b);
  return ids.map(id => map.get(id));
}

// ---- Task details modal ----
window.closeTaskModal = function closeTaskModal() {
  document.getElementById('task-modal').classList.add('hidden');
  STATE.currentTask = null;
};

window.openTaskModal = async function openTaskModal(taskId) {
  const data = await apiFetch(`/api/tasks/${taskId}`);
  const task = data.item;
  STATE.currentTask = task;

  document.getElementById('task-title').value = task.title || '';
  document.getElementById('task-description').value = task.description || '';
  document.getElementById('task-status').value = task.status || 'new';
  document.getElementById('task-done').checked = Boolean(task.done);
  document.getElementById('task-deadline').value = task.deadline || '';

  const assignedByEl = document.getElementById('task-assigned-by');
  assignedByEl.textContent = task.assigned_by ? userDisplayName(task.assigned_by) : '—';

  const groupId = Number(task.group_id || localStorage.getItem('default_group_id') || '1') || 1;
  const universe = await getAssigneeUniverse(groupId);

  const selectedIds = new Set((task.additional_assignees || []).map(u => u.id));
  const container = document.getElementById('task-assignees');
  container.innerHTML = '';

  const responsibleId = task.responsible ? task.responsible.id : null;

  (universe || []).forEach(u => {
    if (responsibleId && u.id === responsibleId) return;

    const row = document.createElement('label');
    row.className = 'assignee-item';
    row.innerHTML = `<input type="checkbox" value="${u.id}"><span>${escapeHtml(userDisplayName(u))}</span>`;
    const cb = row.querySelector('input');
    cb.checked = selectedIds.has(u.id);
    container.appendChild(row);
  });

  document.getElementById('task-modal').classList.remove('hidden');
};

window.saveTaskDetails = async function saveTaskDetails() {
  const task = STATE.currentTask;
  if (!task) return;

  const title = document.getElementById('task-title').value.trim();
  const description = document.getElementById('task-description').value.trim();
  const status = document.getElementById('task-status').value;
  const deadline = document.getElementById('task-deadline').value;
  const done = document.getElementById('task-done').checked;

  const assigneeIds = [...document.querySelectorAll('#task-assignees input[type="checkbox"]')]
    .filter(cb => cb.checked)
    .map(cb => Number(cb.value))
    .filter(n => Number.isFinite(n));

  await apiFetch(`/api/tasks/${task.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, description, status, deadline: deadline || null, done, assignee_ids: assigneeIds }),
  });

  closeTaskModal();

  await loadPersonalTasks();
  renderHomeTasks();
  await loadTasks();
  if (STATE.selectedGroupId) {
    if (STATE.commonTab === 'finance') await loadGroupFinance();
    else await loadGroupTasks();
  }
};

// ---- Group finance ----
async function getGroupFinanceMeta(groupId) {
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

async function loadGroupFinance() {
  if (!STATE.selectedGroupId) return;

  const data = await apiFetch(`/api/groups/${STATE.selectedGroupId}/finance`);
  document.getElementById('group-balance').textContent = `${data.balance} ₽`;

  const list = document.getElementById('group-finance-list');
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

// ---- Add modal ----
window.openAddModal = async function openAddModal() {
  const active = document.querySelector('.screen.active')?.id;

  if (active === 'group_tasks' && !STATE.selectedGroupId) {
    alert('Сначала выберите общую группу (или создайте и пригласите участника).');
    return;
  }

  document.getElementById('add-modal').classList.remove('hidden');

  const dt = new Date();
  const plus7 = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + 7);
  document.getElementById('add-task-deadline').value = toISODate(plus7);

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
};

window.closeAddModal = function closeAddModal() {
  document.getElementById('add-modal').classList.add('hidden');
};

window.renderAddType = function renderAddType() {
  const type = document.querySelector('input[name="add-type"]:checked')?.value || 'task';
  const taskFields = document.getElementById('add-task-fields');
  const finFields = document.getElementById('add-finance-fields');

  if (type === 'task') {
    taskFields.classList.remove('hidden');
    finFields.classList.add('hidden');
  } else {
    taskFields.classList.add('hidden');
    finFields.classList.remove('hidden');
  }
};

function getContextGroupIdForTasks() {
  const active = document.querySelector('.screen.active')?.id;
  if (active === 'group_tasks' && STATE.selectedGroupId) return STATE.selectedGroupId;
  return Number(localStorage.getItem('default_group_id') || '1') || 1;
}

function renderAssigneesPicker(containerId, users) {
  const container = document.getElementById(containerId);
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
  items.forEach(it => {
    const opt = document.createElement('option');
    opt.value = String(it.id);
    opt.textContent = it.name;
    sel.appendChild(opt);
  });
}

window.saveAddModal = async function saveAddModal() {
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
        body: JSON.stringify({
          title,
          description,
          deadline: deadline || null,
          responsible_id,
          assignee_ids,
        }),
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
        await loadBalance();
      }
    }

    closeAddModal();
    document.getElementById('add-task-title').value = '';
    document.getElementById('add-task-desc').value = '';
    document.getElementById('add-fin-desc').value = '';
    document.getElementById('add-fin-amount').value = '';
  } catch (e) {
    alert('Ошибка сохранения: ' + (e.message || e));
  }
};

// ---- Manage categories/methods ----
window.openManageModal = async function openManageModal(mode) {
  if (!STATE.selectedGroupId) { alert('Сначала выберите общую группу'); return; }
  STATE.manageMode = mode;

  const title = document.getElementById('manage-title');
  title.textContent = mode === 'categories' ? 'Статьи расхода' : 'Способы оплаты';

  document.getElementById('manage-new-name').value = '';
  document.getElementById('manage-modal').classList.remove('hidden');

  await renderManageList();
};

window.closeManageModal = function closeManageModal() {
  document.getElementById('manage-modal').classList.add('hidden');
};

async function renderManageList() {
  const list = document.getElementById('manage-items');
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
    row.querySelector('button').onclick = async () => {
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
    };
    list.appendChild(row);
  });
}

window.manageAdd = async function manageAdd() {
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
};

// ---- Notification settings ----
async function loadNotificationSettings() {
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

window.saveNotificationSettings = async function saveNotificationSettings() {
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
};

// ---- Helpers ----
function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// ---- Init ----
(function init() {
  if (tg) {
    tg.ready();
    tg.expand();
    try {
      tg.setHeaderColor(tg.themeParams.header_bg_color || tg.themeParams.bg_color);
      tg.setBackgroundColor(tg.themeParams.bg_color);
    } catch {}
  }

  autoLogin();
  window.addEventListener('load', () => autoLogin());
})();
