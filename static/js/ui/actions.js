import { closestActionEl } from './dom.js';
import { ACTIONS } from '../features/actions_registry.js';

function buildCtx(el, evt) {
  return {
    el,
    evt,
    // удобные alias
    dataset: el?.dataset || {},
    value: (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) ? el.value : undefined,
  };
}

async function dispatchAction(evt) {
  const el = closestActionEl(document.activeElement instanceof Element ? evt.target : evt.target);
  if (!el) return;

  const actionName = el.dataset.action;
  const fn = ACTIONS[actionName];
  if (!fn) {
    console.warn(`[actions] Unknown action: ${actionName}`);
    return;
  }

  // по умолчанию кнопки не должны отправлять формы
  if (evt.type === 'click') evt.preventDefault();

  try {
    const ctx = buildCtx(el, evt);
    await fn(ctx);
  } catch (e) {
    console.error(e);
    alert(e?.message || String(e));
  }
}

export function initActions() {
  document.addEventListener('click', (evt) => {
    const el = closestActionEl(evt.target);
    if (!el) return;
    dispatchAction(evt);
  });

  // change: для radio/select/checkbox
  document.addEventListener('change', (evt) => {
    const el = closestActionEl(evt.target);
    if (!el) return;
    dispatchAction(evt);
  });
}
