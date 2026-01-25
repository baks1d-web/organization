import { STATE } from '../core/state.js';
import { goBack } from '../features/navigation.js';

export function initTelegramBackButton() {
  const tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
  if (!tg || !tg.BackButton) return;

  try { tg.ready(); } catch {}

  function sync() {
    const current = document.querySelector('.screen.active')?.id || 'home';
    const canBack = current !== 'home' && (STATE.navStack?.length || 0) > 0;
    try {
      if (canBack) tg.BackButton.show();
      else tg.BackButton.hide();
    } catch {}
  }

  tg.BackButton.onClick(() => {
    goBack('home');
    sync();
  });

  window.addEventListener('page:changed', sync);
  window.addEventListener('load', sync);
  sync();
}
