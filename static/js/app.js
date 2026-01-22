/* global Telegram */

// Telegram WebApp object
const tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;

function getUrlToken() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('token') || '';
  } catch {
    return '';
  }
}

function setToken(token) {
  if (token) localStorage.setItem('access_token', token);
}

function getToken() {
  return localStorage.getItem('access_token') || '';
}

function authHeaders() {
  const token = getToken();
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

function renderInitDataDebug() {
  const el = document.getElementById('initdata-debug');
  if (!el) return;

  const token = getUrlToken();
  const debug = {
    hasTelegramWebApp: Boolean(tg),
    initDataLength: tg && tg.initData ? tg.initData.length : 0,
    initDataUnsafe: tg ? tg.initDataUnsafe : null,
    urlTokenPresent: Boolean(token),
  };

  el.textContent = JSON.stringify(debug, null, 2);
}

// ---------------------- UI helpers ----------------------
function enterApp() {
  document.getElementById('auth').classList.remove('active');
  document.getElementById('auth').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('app').classList.add('active');
  loadHome();
}

function showAuthError(msg) {
  console.error(msg);
  alert(msg);
}

// ---------------------- Auth flows ----------------------
async function loginWithTelegramInitData() {
  if (!tg || !tg.initData) return false;

  const res = await fetch('/api/auth/telegram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData: tg.initData })
  });

  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  setToken(data.access_token);
  localStorage.setItem('default_group_id', String(data.default_group_id || ''));
  return true;
}

async function loginWithUrlToken() {
  const token = getUrlToken();
  if (!token) return false;
  setToken(token);

  // Verify token by calling /api/me
  const res = await fetch('/api/me', { headers: { ...authHeaders() } });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    localStorage.removeItem('access_token');
    throw new Error(data.error || `Token invalid (HTTP ${res.status})`);
  }
  localStorage.setItem('default_group_id', String(data.default_group_id || ''));
  return true;
}

async function loginWithStoredToken() {
  const token = getToken();
  if (!token) return false;

  const res = await fetch('/api/me', { headers: { ...authHeaders() } });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    localStorage.removeItem('access_token');
    return false;
  }
  localStorage.setItem('default_group_id', String(data.default_group_id || ''));
  return true;
}

async function autoLogin() {
  renderInitDataDebug();

  // 1) Telegram initData (primary)
  try {
    if (await loginWithTelegramInitData()) {
      enterApp();
      return;
    }
  } catch (e) {
    console.warn('Telegram initData login failed:', e);
  }

  // 2) URL token from /start (fallback)
  try {
    if (await loginWithUrlToken()) {
      enterApp();
      return;
    }
  } catch (e) {
    console.warn('URL token login failed:', e);
  }

  // 3) Stored token (fallback)
  try {
    if (await loginWithStoredToken()) {
      enterApp();
      return;
    }
  } catch (e) {
    console.warn('Stored token login failed:', e);
  }

  // Stay on auth screen
}

// Buttons on auth screen
window.loginTelegram = async function loginTelegram() {
  try {
    await autoLogin();
  } catch (e) {
    showAuthError('Не удалось войти через Telegram: ' + (e.message || e));
  }
};

window.loginEmail = function loginEmail() {
  showAuthError('Вход по почте не реализован в этой версии. Используй Telegram.');
};

// ---------------------- Navigation ----------------------
window.switchScreen = function switchScreen(id, title, el) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');

  document.getElementById('screen-title').textContent = title;

  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  el.classList.add('active');

  if (id === 'home') loadHome();
  if (id === 'tasks') loadTasks();
  if (id === 'finance') loadFinance();
};

// ---------------------- Modal ----------------------
window.openModal = function openModal() {
  document.getElementById('modal').classList.remove('hidden');
};

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
}

window.saveItem = async function saveItem() {
  const type = document.querySelector('input[name="type"]:checked').value;
  const title = document.getElementById('add-title').value.trim();
  const amount = document.getElementById('add-amount').value;

  if (!title) {
    alert('Введите название');
    return;
  }

  const groupId = Number(localStorage.getItem('default_group_id') || '1') || 1;

  let endpoint;
  let body = { title };

  if (type === 'task') {
    endpoint = `/api/groups/${groupId}/tasks`;
  } else {
    endpoint = '/api/finance';
    if (!amount || isNaN(amount)) {
      alert('Введите корректную сумму');
      return;
    }
    body.amount = Math.trunc(Number(amount)) * (type === 'income' ? 1 : -1);
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify(body)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data.ok === false)) {
    alert('Ошибка сохранения: ' + (data.error || `HTTP ${res.status}`));
    return;
  }

  closeModal();
  loadCurrentScreen();
  document.getElementById('add-title').value = '';
  document.getElementById('add-amount').value = '';
};

// ---------------------- Data loading ----------------------
function loadHome() {
  loadTasks('home-tasks');
  loadBalance();
}

async function loadTasks(containerId = 'all-tasks') {
  const groupId = Number(localStorage.getItem('default_group_id') || '1') || 1;

  const res = await fetch(`/api/groups/${groupId}/tasks`, { headers: { ...authHeaders() } });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    console.error('Ошибка загрузки задач:', data);
    return;
  }

  const tasks = data.items || [];
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  tasks.forEach(t => {
    const div = document.createElement('div');
    div.className = 'task' + (t.done ? ' done' : '');
    div.innerHTML = `${t.urgent ? '❗' : ''} ${escapeHtml(t.title)} <small>${t.deadline || ''}</small>`;
    div.onclick = () => markDone(t.id, div);
    container.appendChild(div);
  });
}

async function markDone(id, element) {
  const res = await fetch(`/api/tasks/${id}/done`, {
    method: 'POST',
    headers: { ...authHeaders() }
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.ok) element.classList.add('done');
}

async function loadFinance() {
  const res = await fetch('/api/finance', { headers: { ...authHeaders() } });
  const data = await res.json();
  const container = document.getElementById('finance-list');
  container.innerHTML = '';

  if (!res.ok || !data.ok) {
    container.innerHTML = '<p>Не удалось загрузить финансы</p>';
    return;
  }

  (data.items || []).forEach(i => {
    const div = document.createElement('div');
    div.className = `finance-row ${i.amount > 0 ? 'plus' : 'minus'}`;
    div.innerHTML = `${i.amount} ₽ <span>${escapeHtml(i.title)}</span>`;
    container.appendChild(div);
  });
}

async function loadBalance() {
  const res = await fetch('/api/balance', { headers: { ...authHeaders() } });
  const data = await res.json();

  if (res.ok && data.ok) {
    document.getElementById('home-balance').textContent = `${data.balance} ₽`;
  } else {
    document.getElementById('home-balance').textContent = '—';
  }
}

function loadCurrentScreen() {
  const active = document.querySelector('.screen.active');
  if (!active) return;
  if (active.id === 'home') loadHome();
  if (active.id === 'tasks') loadTasks();
  if (active.id === 'finance') loadFinance();
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// ---------------------- Init Telegram UI ----------------------
(function init() {
  if (tg) {
    tg.ready();
    tg.expand();
    try {
      tg.setHeaderColor(tg.themeParams.header_bg_color || tg.themeParams.bg_color);
      tg.setBackgroundColor(tg.themeParams.bg_color);
    } catch (e) {
      console.warn('Theme setup failed', e);
    }
  }

  // Try early login
  autoLogin();

  // And after full load (for slow Telegram init)
  window.addEventListener('load', () => autoLogin());
})();
