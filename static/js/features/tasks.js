import { apiFetch } from '../core/api.js';
import { STATE } from '../core/state.js';
import { escapeHtml, isUrgentByDeadline, filterTasksByMode } from '../core/utils.js';
import { closeModal, openModal } from '../ui/modals.js';
import { userDisplayName, fetchAllUsers } from './users.js';

// ---- Render tasks list with pagination ----
export function renderTaskList(containerId, tasks, page, key) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const pageSize = STATE.pageSize;
  const total = (tasks || []).length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  if (key === 'home') STATE.homePage = safePage;
  if (key === 'tasks') STATE.tasksPage = safePage;
  if (key === 'group') STATE.groupTasksPage = safePage;

  container.innerHTML = '';

  const slice = (tasks || []).slice((safePage - 1) * pageSize, safePage * pageSize);
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
    div.addEventListener('click', () => openTaskModal(t.id));
    container.appendChild(div);
  });

  if (totalPages > 1) {
    const pager = document.createElement('div');
    pager.className = 'pagination';

    const prev = document.createElement('button');
    prev.className = 'pager-btn';
    prev.textContent = '←';
    prev.disabled = safePage <= 1;
    prev.addEventListener('click', (e) => {
      e.stopPropagation();
      renderTaskList(containerId, tasks, safePage - 1, key);
    });

    const next = document.createElement('button');
    next.className = 'pager-btn';
    next.textContent = '→';
    next.disabled = safePage >= totalPages;
    next.addEventListener('click', (e) => {
      e.stopPropagation();
      renderTaskList(containerId, tasks, safePage + 1, key);
    });

    const label = document.createElement('div');
    label.className = 'pager-label';
    label.textContent = `${safePage} / ${totalPages}`;

    pager.appendChild(prev);
    pager.appendChild(label);
    pager.appendChild(next);
    container.appendChild(pager);
  }
}

// ---- Data loaders ----
export async function loadPersonalTasks() {
  const groupId = Number(localStorage.getItem('default_group_id') || '1') || 1;
  const data = await apiFetch(`/api/groups/${groupId}/tasks`);
  STATE.tasksCache = data.items || [];
}

export async function loadTasks(containerId = 'all-tasks') {
  if (!STATE.tasksCache || STATE.tasksCache.length === 0) {
    await loadPersonalTasks();
  }

  // По умолчанию экран "Задачи" показывает активные задачи на выбранную дату
  const iso = STATE.selectedDate;
  const filtered = (STATE.tasksCache || []).filter(t => !t.done && t.status !== 'done' && String(t.deadline || '').slice(0, 10) === iso);
  renderTaskList(containerId, filtered, STATE.tasksPage, 'tasks');
}

// обновлять список задач при смене даты (только когда экран активен)
window.addEventListener('date:changed', () => {
  if (document.getElementById('tasks')?.classList.contains('active')) loadTasks();
});

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
export async function openTaskModal(taskId) {
  const data = await apiFetch(`/api/tasks/${taskId}`);
  const task = data.item;
  STATE.currentTask = task;

  document.getElementById('task-title').value = task.title || '';
  document.getElementById('task-description').value = task.description || '';
  document.getElementById('task-status').value = task.status || 'new';
  document.getElementById('task-done').checked = Boolean(task.done);
  document.getElementById('task-deadline').value = task.deadline || '';

  const assignedByEl = document.getElementById('task-assigned-by');
  if (assignedByEl) assignedByEl.textContent = task.assigned_by ? userDisplayName(task.assigned_by) : '—';

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

  openModal('task-modal');
}

export async function saveTaskDetails() {
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

  closeModal('task-modal');
  STATE.currentTask = null;

  // обновляем все экраны
  const { renderHomeTasks } = await import('./home.js');
  const { loadGroupTasks, loadGroupFinance } = await import('./groups.js');

  await loadPersonalTasks();
  renderHomeTasks();
  await loadTasks();

  if (STATE.selectedGroupId) {
    if (STATE.commonTab === 'finance') await loadGroupFinance();
    else await loadGroupTasks();
  }
}

// маленький helper, иногда удобно в add.js
export function getContextGroupIdForTasks() {
  return Number(localStorage.getItem('default_group_id') || '1') || 1;
}

export function getFilteredTasksForHome() {
  return filterTasksByMode(STATE.tasksCache || [], STATE.homeFilter || 'today');
}
