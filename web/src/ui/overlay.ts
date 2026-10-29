import { cn } from '../lib/cn.ts';
import { append, el, type Child } from '../lib/dom.ts';
import { button } from './button.ts';

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

/** 模块级 overlay 栈：Esc 只关栈顶，嵌套（drawer 上开 dialog）不会穿透关闭底层 */
const overlayStack: OverlayHandle[] = [];

function removeFromStack(handle: OverlayHandle): void {
  const i = overlayStack.indexOf(handle);
  if (i >= 0) overlayStack.splice(i, 1);
}

function frame(kind: 'dialog' | 'drawer', options: OverlayOptions): OverlayHandle {
  const root = document.getElementById('overlay-root');
  if (!root) throw new Error('缺少 overlay-root');
  const { title, subtitle, onClose } = options;
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  const body = el('div', { class: 'space-y-4' });
  const panel = el('div', {
    role: kind === 'dialog' ? 'dialog' : 'complementary',
    'aria-modal': kind === 'dialog' ? 'true' : undefined,
    'aria-label': title,
    class: cn(
      'relative flex flex-col border bg-[var(--c-surface)]',
      kind === 'dialog'
        ? 'w-[min(92vw,32rem)] max-h-[86vh] border-[var(--c-line)]'
        : 'safe-bottom h-full w-full overflow-y-auto border-0 border-l border-[var(--c-line)] sm:w-[28rem]',
    ),
  });

  append(panel, [
    el('div', { class: 'h-0.5 w-full bg-accent shrink-0', 'aria-hidden': 'true' }),
    el('div', { class: 'flex items-start justify-between gap-3 px-5 pt-4' },
      el('div', {},
        el('h2', { class: 'text-[15px] font-semibold text-fg', text: title }),
        subtitle ? el('p', { class: 'mt-1 text-[11px] text-[var(--c-fg-soft)]', text: subtitle }) : null,
      ),
      button({ variant: 'icon', iconName: 'close', title: '关闭', onClick: () => close() }),
    ),
    el('div', { class: 'flex-1 overflow-y-auto px-5 py-4' }, body),
  ]);

  const backdrop = el('div', { class: 'fixed inset-0 z-40 flex bg-[var(--c-overlay)]' });
  const backdropInner = el('div', {
    class: kind === 'dialog'
      ? 'flex min-h-full w-full items-center justify-center p-4'
      : 'ml-auto flex min-h-full w-full justify-end',
  });
  backdropInner.appendChild(panel);
  backdrop.appendChild(backdropInner);

  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let closed = false;
  let handle: OverlayHandle;
  const close = (): void => {
    if (closed) return;
    closed = true;
    removeFromStack(handle);
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    document.body.style.overflow = previousOverflow;
    if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    if (onClose) onClose();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    // 只关栈顶：嵌套场景（drawer 上开 dialog）时 Esc 关最上层，底层保持打开
    if (overlayStack[overlayStack.length - 1] !== handle) return;
    close();
  };
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop || event.target === backdropInner) close();
  });
  document.addEventListener('keydown', onKey);
  handle = { close, panel, body, element: backdrop };
  overlayStack.push(handle);
  root.appendChild(backdrop);

  const focusable = panel.querySelector<HTMLElement>('input, textarea, button');
  if (focusable) queueMicrotask(() => focusable.focus());

  return handle;
}

export function openDialog(options: OverlayOptions): OverlayHandle {
  return frame('dialog', options);
}

export function openDrawer(options: OverlayOptions): OverlayHandle {
  return frame('drawer', options);
}

export function overlayActions(...children: Child[]): HTMLElement {
  return el('div', { class: 'mt-5 flex flex-wrap items-center justify-end gap-2' }, ...children);
}
