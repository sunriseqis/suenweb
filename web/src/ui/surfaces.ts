import { cn } from '../lib/cn.ts';
import { append, el, type Child } from '../lib/dom.ts';

export type TileOptions = {
  class?: string;
  as?: string;
  square?: boolean;
};

/** 磁贴：直角细边，hover 变底色 + 左侧 2px 强调条 */
export function tile(options: TileOptions = {}, ...children: Child[]): HTMLElement {
  const { class: className = '', as = 'div', square = false } = options;
  const node = el(as, {
    class: cn('tile tile-mark group', square ? 'aspect-square' : '', className),
  });
  append(node, children);
  return node;
}

export type CardOptions = {
  index?: number;
  class?: string;
  dashed?: boolean;
  rotate?: number;
  as?: string;
  padding?: 'sm' | 'md';
  quiet?: boolean;
};

/** 面板（弹窗 / 设置分区用）：白底细边，无阴影 */
export function card(options: CardOptions = {}, ...children: Child[]): HTMLElement {
  const { class: className = '', as = 'div', padding = 'md' } = options;
  const node = el(as, {
    class: cn(
      'border border-[var(--c-line)] bg-[var(--c-surface)]',
      padding === 'md' ? 'p-5' : 'p-3',
      className,
    ),
  });
  append(node, children);
  return node;
}

export function badge(text: string, options: { index?: number; class?: string } = {}): HTMLElement {
  return el('span', {
    class: cn('inline-flex items-center border border-[var(--c-line)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--c-fg-soft)]', options.class ?? ''),
    text,
  });
}
