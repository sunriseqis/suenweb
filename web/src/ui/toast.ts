import { cn } from '../lib/cn.ts';
import { append, el } from '../lib/dom.ts';
import { icon } from './icons.ts';

export type ToastKind = 'info' | 'success' | 'error';

const KINDS: Record<ToastKind, { border: string; iconName: 'sparkle' | 'check' | 'bolt' }> = {
  info: { border: 'border-secondary', iconName: 'sparkle' },
  success: { border: 'border-tertiary', iconName: 'check' },
  error: { border: 'border-quaternary', iconName: 'bolt' },
};

export function toast(message: string, kind: ToastKind = 'info'): void {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const style = KINDS[kind];
  const node = el('div', {
    class: cn(
      'pointer-events-auto flex items-center gap-3 rounded-full border-4 bg-[var(--c-surface)] px-6 py-3 shadow-multi',
      style.border,
      'text-sm font-bold text-fg',
    ),
  });
  append(node, [icon(style.iconName, { size: 18 }), el('span', { text: message })]);
  node.style.transition = 'transform 300ms ease-out, opacity 300ms ease-out';
  node.style.transform = 'translateY(16px)';
  node.style.opacity = '0';
  root.appendChild(node);
  requestAnimationFrame(() => {
    node.style.transform = 'translateY(0)';
    node.style.opacity = '1';
  });
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transform = 'translateY(12px)';
    setTimeout(() => node.remove(), 300);
  }, 3200);
}
