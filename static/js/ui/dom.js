export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function closestActionEl(target) {
  if (!(target instanceof Element)) return null;
  return target.closest('[data-action]');
}

export function show(el) {
  if (!el) return;
  el.classList.remove('hidden');
}
export function hide(el) {
  if (!el) return;
  el.classList.add('hidden');
}
