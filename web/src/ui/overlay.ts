import { cn } from '../lib/cn.ts';
import { append, el, type Child } from '../lib/dom.ts';
import { button } from './button.ts';
import { accentAt, shadowVars } from './surfaces.ts';

export type OverlayHandle = {
  close: () => void;
  panel: HTMLElement;
  body: HTMLElement;
  element: HTMLElement;
};

type OverlayOptions = {
  title: string;
  subtitle?: string;
  index?: number;
  onClose?: () => void;
};

function frame(kind: 'dialog' | 'drawer', options: OverlayOptions): OverlayHandle {
  const root = document.getElementById('overlay-root');
  if (!root) throw new Error('缺少 overlay-root');
  const { title, subtitle, index = 0, onClose } = options;
  const accent = accentAt(index);
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  const body = el('div', { class: 'space-y-5' });

  const panel = el('div', {
    role: kind === 'dialog' ? 'dialog' : 'complementary',
    'aria-modal': kind === 'dialog' ? 'true' : undefined,
    'aria-label': title,
    class: cn(
      'relative pattern-dots border-4 bg-[var(--c-surface)]',
      accent.border,
      kind === 'dialog'
        ? 'w-[min(92vw,40rem)] rounded-[26px] p-7 shadow-multi-lg'
        : 'safe-bottom h-full w-full overflow-y-auto rounded-none border-y-0 border-r-0 border-l-8 p-6 sm:w-[34rem] shadow-multi-lg',
    ),
    style: shadowVars(index),
  });

  append(panel, [
    el('div', { class: 'mb-4 flex items-start justify-between gap-4' },
      el('div', {},
        el('p', {
          class: cn('font-display text-[11px] uppercase tracking-[0.3em]', accent.text),
          text: kind === 'dialog' ? '需要你确认' : '编辑',
        }),
        el('h2', { class: 'mt-1 text-3xl text-fg ts-cn', text: title }),
        subtitle ? el('p', { class: 'mt-2 text-sm text-fg/70', text: subtitle }) : null,
      ),
      button({ variant: 'icon', iconName: 'close', title: '关闭', onClick: () => close() }),
    ),
    body,
  ]);

  const backdrop = el('div', { class: 'fixed inset-0 z-40 flex bg-black/70 backdrop-blur-sm', on: {}, });
  panel.style.marginTop = '';
  const backdropInner = el('div', {
    class: kind === 'dialog'
      ? 'flex min-h-full w-full items-center justify-center p-4'
      : 'ml-auto flex min-h-full w-full justify-end',
  });
  if (kind === 'dialog') panel.classList.add('my-auto');
  backdropInner.appendChild(panel);
  backdrop.appendChild(backdropInner);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    document.body.style.overflow = previousOverflow;
    if (onClose) onClose();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') close();
  };
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop || event.target === backdropInner) close();
  });
  document.addEventListener('keydown', onKey);
  root.appendChild(backdrop);

  const focusable = panel.querySelector<HTMLElement>('input, textarea, button');
  if (focusable) queueMicrotask(() => focusable.focus());

  return { close, panel, body, element: backdrop };
}

export function openDialog(options: OverlayOptions): OverlayHandle {
  return frame('dialog', options);
}

export function openDrawer(options: OverlayOptions): OverlayHandle {
  return frame('drawer', options);
}

export function overlayActions(...children: Child[]): HTMLElement {
  return el('div', { class: 'mt-6 flex flex-wrap items-center justify-end gap-3' }, ...children);
}
