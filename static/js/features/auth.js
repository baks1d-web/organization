import { apiFetch } from '../core/api.js';
import { setToken } from '../core/storage.js';
import { getToken } from '../core/storage.js';
import { getUrlToken, cleanupUrlParams } from '../core/utils.js';
import { loadGroups } from './groups.js';
import { loadCurrentScreen } from './navigation.js';

/* global Telegram */
const tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;

function showAuthError(msg) {
  console.error(msg);
  alert(msg);
}

function enterApp() {
  document.getElementById('auth')?.classList.remove('active');
  document.getElementById('auth')?.classList.add('hidden');
  document.getElementById('app')?.classList.remove('hidden');
  document.getElementById('app')?.classList.add('active');
}

async function bootAfterLogin() {
  await loadGroups();
  loadCurrentScreen();
}

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
  cleanupUrlParams();
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

export async function autoLogin() {
  try { if (await loginWithTelegramInitData()) { enterApp(); await bootAfterLogin(); return true; } } catch (e) { console.warn(e); }
  try { if (await loginWithUrlToken()) { enterApp(); await bootAfterLogin(); return true; } } catch (e) { console.warn(e); }
  try { if (await loginWithStoredToken()) { enterApp(); await bootAfterLogin(); return true; } } catch (e) { console.warn(e); }
  return false;
}

// actions
export async function loginTelegram() {
  try {
    const ok = await autoLogin();
    if (!ok) throw new Error('Нет данных Telegram/токена');
  } catch (e) {
    showAuthError('Не удалось войти: ' + (e.message || e));
  }
}

export function loginEmail() {
  showAuthError('Вход по почте не реализован. Используй Telegram.');
}
