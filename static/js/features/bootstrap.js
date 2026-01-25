import { autoLogin } from './auth.js';
import { loadCurrentScreen } from './navigation.js';

/* global Telegram */
const tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;

function initTelegramUi() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  try {
    tg.setHeaderColor(tg.themeParams.header_bg_color || tg.themeParams.bg_color);
    tg.setBackgroundColor(tg.themeParams.bg_color);
  } catch {}
}

export function initApp() {
  initTelegramUi();

  window.addEventListener('load', async () => {
    await autoLogin();
    loadCurrentScreen();
  });
}
