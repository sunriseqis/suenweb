import { cn } from '../lib/cn.ts';
import { append, el, type Child } from '../lib/dom.ts';

export type Accent = {
  key: string;
  border: string;
  text: string;
  bg: string;
  soft: string;
  ring: string;
  cssVar: string;
};

export const ACCENTS: Accent[] = [
  { key: 'accent', border: 'border-accent', text: 'text-accent', bg: 'bg-accent', soft: 'bg-accent/15', ring: 'ring-accent', cssVar: 'var(--c-accent)' },
  { key: 'secondary', border: 'border-secondary', text: 'text-secondary', bg: 'bg-secondary', soft: 'bg-secondary/15', ring: 'ring-secondary', cssVar: 'var(--c-secondary)' },
  { key: 'tertiary', border: 'border-tertiary', text: 'text-tertiary', bg: 'bg-tertiary', soft: 'bg-tertiary/15', ring: 'ring-tertiary', cssVar: 'var(--c-tertiary)' },
  { key: 'quaternary', border: 'border-quaternary', text: 'text-quaternary', bg: 'bg-quaternary', soft: 'bg-quaternary/15', ring: 'ring-quaternary', cssVar: 'var(--c-quaternary)' },
  { key: 'quinary', border: 'border-quinary', text: 'text-quinary', bg: 'bg-quinary', soft: 'bg-quinary/15', ring: 'ring-quinary', cssVar: 'var(--c-quinary)' },
];

export function accentAt(index: number): Accent {
  return ACCENTS[((index % ACCENTS.length) + ACCENTS.length) % ACCENTS.length];
}

/** 撞色：边框用「下一个」颜色，永远不和本卡主色一致 */
export function clashBorder(index: number): string {
  return accentAt(index + 2).border;
}

export function shadowVars(index: number): string {
  const a = accentAt(index + 1).cssVar;
  const b = accentAt(index + 3).cssVar;
  const c = accentAt(index).cssVar;
  return '--sh-1:' + a + ';--sh-2:' + b + ';--sh-3:' + c + ';';
}

export type CardOptions = {
  index?: number;
  class?: string;
  dashed?: boolean;
  padding?: 'sm' | 'md';
  rotate?: 0 | 1 | 2 | -1 | -2;
  as?: string;
};

export function card(options: CardOptions = {}, ...children: Child[]): HTMLElement {
  const { index = 0, class: className = '', dashed = false, rotate = 0, as = 'div', padding = 'sm' } = options;
  const sides = [];
  if (rotate) sides.push(rotate === 1 || rotate === 2 ? 'rotate-' + rotate : 'rotate-' + rotate);
  const node = el(as, {
    class: cn(
      'panel rounded-[20px] border-4 transition-all duration-300 ease-out shadow-multi-sm shadow-multi-sm-hover',
      padding === 'md' ? 'p-6' : 'p-4',
      clashBorder(index),
      dashed ? 'border-dashed' : 'border-solid',
      sides.join(' '),
      className,
    ),
    style: shadowVars(index),
  });
  append(node, children);
  return node;
}

export function badge(text: string, options: { index?: number; class?: string } = {}): HTMLElement {
  const accent = accentAt(options.index ?? 0);
  return el('span', {
    class: cn(
      'inline-flex items-center gap-1.5 rounded-full border-2 px-3 py-1 font-heading text-[11px] font-black uppercase tracking-widest',
      accent.border,
      accent.soft,
      'text-fg',
      options.class ?? '',
    ),
    text,
  });
}
