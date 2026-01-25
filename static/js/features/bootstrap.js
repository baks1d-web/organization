import { autoLogin } from './auth.js';
import { loadCurrentScreen, initRouting } from './navigation.js';
import { initTelegramBackButton } from '../integrations/telegram_back.js';
import { initDatebar } from './datebar.js';

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
  initRouting('home');
  initTelegramBackButton();
  initDatebar();

  window.addEventListener('load', async () => {
    await autoLogin();
    loadCurrentScreen();
  });
}
