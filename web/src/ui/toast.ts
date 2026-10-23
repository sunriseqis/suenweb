import { cn } from '../lib/cn.ts';
import { append, el } from '../lib/dom.ts';
import { icon } from './icons.ts';

export type ToastKind = 'info' | 'success' | 'error';

const ICONS: Record<ToastKind, 'sparkle' | 'check' | 'bolt'> = {
  info: 'sparkle',
  success: 'check',
  error: 'bolt',
};

export function toast(message: string, kind: ToastKind = 'info'): void {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const node = el('div', {
    class: cn('pointer-events-auto flex items-center gap-2 border border-[var(--c-line)] bg-[var(--c-surface)] px-3 py-2 text-[12px] text-fg'),
  });
  append(node, [
    el('span', { class: kind === 'error' ? 'h-3 w-0.5 bg-[var(--c-accent)]' : 'h-3 w-0.5 bg-accent', 'aria-hidden': 'true' }),
    icon(ICONS[kind], { size: 14, stroke: 1.8 }),
    el('span', { text: message }),
  ]);
  node.style.transition = 'opacity 160ms linear, transform 160ms ease-out';
  node.style.opacity = '0';
  root.appendChild(node);
  requestAnimationFrame(() => {
    node.style.opacity = '1';
  });
  setTimeout(() => {
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 200);
  }, 2800);
}
