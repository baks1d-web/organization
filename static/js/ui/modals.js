import { qs } from './dom.js';

export function openModal(id) {
  const el = qs(`#${CSS.escape(id)}`);
  if (!el) return;
  el.classList.remove('hidden');
}

export function closeModal(id) {
  const el = qs(`#${CSS.escape(id)}`);
  if (!el) return;
  el.classList.add('hidden');
}
