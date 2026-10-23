import { cn } from '../lib/cn.ts';
import { clear, el } from '../lib/dom.ts';
import { icon, type IconName } from './icons.ts';

export type CapsuleItem = {
  key: string;
  label: string;
  iconName: IconName;
  onClick: () => void;
  active?: boolean;
  showLabel?: boolean;
};

const HIDE_DELAY = 2600;
const CORNER_X = 320;
const CORNER_Y = 200;

let hideTimer: number | undefined;
let cleanup: (() => void) | null = null;

function host(): HTMLElement | null {
  return document.getElementById('capsule-root');
}

function inCorner(x: number, y: number): boolean {
  return y > window.innerHeight - CORNER_Y && x > window.innerWidth - CORNER_X;
}

export function mountCapsule(items: CapsuleItem[]): void {
  const root = host();
  if (!root) return;
  if (cleanup) cleanup();
  root.className = 'pointer-events-none fixed bottom-3 right-3 z-30 flex justify-end';
  clear(root);

  const bar = el('div', {
    class: 'capsule pointer-events-auto flex items-center gap-0.5 border border-[var(--c-line)] bg-[var(--c-surface)] p-0.5',
    role: 'toolbar',
    'aria-label': '页面操作',
    dataset: { hidden: 'false' },
  });

  for (const item of items) {
    const node = el('button', {
      type: 'button',
      class: cn(
        'pressable flex h-8 items-center justify-center gap-1.5 px-2 text-[11px] font-semibold uppercase tracking-[0.06em]',
        item.active
          ? 'bg-accent text-[color:var(--c-accent-ink)]'
          : 'text-[var(--c-fg-soft)] hover:bg-[var(--c-surface-2)] hover:text-fg',
        item.showLabel ? '' : 'w-8',
      ),
      title: item.label,
      'aria-label': item.label,
      'aria-pressed': item.active ? 'true' : 'false',
      onClick: () => item.onClick(),
    });
    node.append(icon(item.iconName, { size: 16, stroke: 1.8 }));
    if (item.showLabel) node.append(el('span', { text: item.label }));
    bar.appendChild(node);
  }

  root.appendChild(bar);

  const show = (): void => {
    bar.dataset.hidden = 'false';
    schedule();
  };
  const hide = (): void => {
    bar.dataset.hidden = 'true';
  };
  const schedule = (): void => {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hide, HIDE_DELAY);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (inCorner(event.clientX, event.clientY)) show();
  };
  const onTouch = (event: TouchEvent): void => {
    const touch = event.touches[0];
    if (touch && inCorner(touch.clientX, touch.clientY)) show();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Tab') show();
  };

  bar.addEventListener('pointerenter', show);
  bar.addEventListener('pointerleave', schedule);
  bar.addEventListener('focusin', show);
  document.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('touchstart', onTouch, { passive: true });
  document.addEventListener('keydown', onKeyDown);

  cleanup = () => {
    window.clearTimeout(hideTimer);
    bar.removeEventListener('pointerenter', show);
    bar.removeEventListener('pointerleave', schedule);
    bar.removeEventListener('focusin', show);
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('touchstart', onTouch);
    document.removeEventListener('keydown', onKeyDown);
  };

  schedule();
}

export function unmountCapsule(): void {
  if (cleanup) cleanup();
  cleanup = null;
  const root = host();
  if (root) clear(root);
}
