import { STATE } from '../core/state.js';
import { isoDate, ruDateParts } from '../core/utils.js';
import { loadFinanceCache } from './personal_finance.js';

function todayIso() {
  return isoDate(new Date());
}

function addDays(iso, delta) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return isoDate(d);
}

function setSelectedDate(iso) {
  STATE.selectedDate = iso;
  updateHeaderDate();
  window.dispatchEvent(new CustomEvent('date:changed', { detail: { iso } }));
}

export function initDatebar() {
  if (!STATE.selectedDate) STATE.selectedDate = todayIso();
  if (!STATE.topFilter) STATE.topFilter = 'tasks';

  updateHeaderDate();
  updateFilterUi();

  // preload caches so calendar can mark days even before screens are opened
  loadFinanceCache().catch(() => {});

  // tasks cache is needed for calendar markers too (without forcing user to open Tasks/Home first)
  import('./tasks.js')
    .then((m) => m.loadPersonalTasks())
    .catch(() => {});
}

export function prevDay() {
  setSelectedDate(addDays(STATE.selectedDate || todayIso(), -1));
}

export function nextDay() {
  setSelectedDate(addDays(STATE.selectedDate || todayIso(), +1));
}

export function openCalendar() {
  const ov = document.getElementById('calendar-overlay');
  if (!ov) return;
  ov.classList.add('open');
  renderCalendarMonth();
}

export function closeCalendar() {
  const ov = document.getElementById('calendar-overlay');
  if (!ov) return;
  ov.classList.remove('open');
}

export function setTopFilter(ctx) {
  const f = ctx?.dataset?.filter;
  if (!f) return;
  STATE.topFilter = f;
  updateFilterUi();
  window.dispatchEvent(new CustomEvent('date:filterChanged', { detail: { filter: f } }));
  renderCalendarMonth();
}

export function pickDate(ctx) {
  const iso = ctx?.dataset?.iso;
  if (!iso) return;
  closeCalendar();
  setSelectedDate(iso);
}

function updateFilterUi() {
  document.querySelectorAll('[data-date-filter]').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('[data-date-filter]').forEach(btn => {
    if (btn.dataset.filter === STATE.topFilter) btn.classList.add('active');
  });
}

function updateHeaderDate() {
  const iso = STATE.selectedDate || todayIso();
  const parts = ruDateParts(iso);

  const titleEl = document.getElementById('date-title');
  const subEl = document.getElementById('date-subtitle');

  if (titleEl) titleEl.textContent = parts.relative;
  if (subEl) subEl.textContent = parts.pretty;

  const open = document.getElementById('calendar-overlay')?.classList.contains('open');
  if (open) renderCalendarMonth();
}

function getActivityIsoSetForMonth(year, monthIndex) {
  const set = new Set();

  const mode = STATE.topFilter || 'tasks';

  const taskDays = (mode === 'tasks' || mode === 'all')
    ? (STATE.tasksCache || [])
      .filter(t => !t.done && t.status !== 'done' && t.deadline)
      .map(t => String(t.deadline).slice(0, 10))
    : [];

  const financeDays = (mode === 'finance' || mode === 'all')
    ? (STATE.financeCache || [])
      .filter(i => i.created_at)
      .map(i => String(i.created_at).slice(0, 10))
    : [];

  const prefix = `${year}-${String(monthIndex + 1).padStart(2, '0')}-`;
  [...taskDays, ...financeDays].forEach(iso => {
    if (iso && iso.startsWith(prefix)) set.add(iso);
  });

  return set;
}

function renderCalendarMonth() {
  const ov = document.getElementById('calendar-overlay');
  if (!ov) return;

  const base = new Date((STATE.selectedDate || todayIso()) + 'T00:00:00');
  const year = base.getFullYear();
  const month = base.getMonth();

  const monthLabel = ov.querySelector('[data-cal-month]');
  if (monthLabel) {
    const ru = base.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    monthLabel.textContent = ru.charAt(0).toUpperCase() + ru.slice(1);
  }

  const grid = ov.querySelector('[data-cal-grid]');
  if (!grid) return;

  grid.innerHTML = '';

  const weekdays = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  weekdays.forEach(w => {
    const d = document.createElement('div');
    d.className = 'cal-weekday';
    d.textContent = w;
    grid.appendChild(d);
  });

  const first = new Date(year, month, 1);
  const firstDow = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const activeSet = getActivityIsoSetForMonth(year, month);

  for (let i = 0; i < firstDow; i++) {
    const cell = document.createElement('div');
    cell.className = 'cal-empty';
    grid.appendChild(cell);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${year}-${String(month + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cal-day';
    btn.dataset.action = 'date.pick';
    btn.dataset.iso = iso;
    btn.textContent = String(day);

    if (activeSet.has(iso)) btn.classList.add('has-items');
    else btn.classList.add('no-items');

    if (iso === STATE.selectedDate) btn.classList.add('selected');

    grid.appendChild(btn);
  }
}
