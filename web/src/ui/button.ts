import { cn } from '../lib/cn.ts';
import { append, el, type Child } from '../lib/dom.ts';
import { icon, type IconName } from './icons.ts';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'icon';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

const BASE =
  'pressable inline-flex select-none items-center justify-center gap-1.5 rounded-none border text-[11px] font-semibold uppercase tracking-[0.08em] disabled:pointer-events-none disabled:opacity-40';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-accent text-[color:var(--c-accent-ink)] hover:brightness-110',
  secondary:
    'border-[var(--c-line)] bg-transparent text-fg hover:border-[var(--c-line-strong)] hover:bg-[var(--c-accent-soft)]',
  outline: 'border-[var(--c-line-strong)] bg-transparent text-fg hover:bg-[var(--c-accent-soft)]',
  ghost: 'border-transparent bg-transparent text-[var(--c-fg-soft)] hover:bg-[var(--c-surface-2)] hover:text-fg',
  icon:
    'h-8 w-8 border-transparent bg-transparent text-[var(--c-fg-soft)] hover:bg-[var(--c-surface-2)] hover:text-fg',
};

const SIZES: Record<ButtonSize, string> = {
  xs: 'h-7 px-2.5',
  sm: 'h-8 px-3',
  md: 'h-9 px-4',
  lg: 'h-11 px-6 text-[12px]',
};

export function buttonClass(options: { variant?: ButtonVariant; size?: ButtonSize; class?: string } = {}): string {
  const { variant = 'primary', size = 'md', class: className = '' } = options;
  return cn(BASE, VARIANTS[variant], variant === 'icon' ? '' : SIZES[size], className);
}

export type ButtonOptions = {
  label?: string;
  iconName?: IconName;
  variant?: ButtonVariant;
  size?: ButtonSize;
  class?: string;
  type?: 'button' | 'submit';
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  onClick?: (event: MouseEvent) => void;
};

export function button(options: ButtonOptions = {}, ...children: Child[]): HTMLButtonElement {
  const {
    label,
    iconName,
    variant = 'primary',
    size = 'md',
    class: className = '',
    type = 'button',
    disabled = false,
    title,
    ariaLabel,
    onClick,
  } = options;
  const node = el('button', {
    type,
    class: buttonClass({ variant, size, class: className }),
    disabled: disabled || undefined,
    title: title ?? undefined,
    'aria-label': ariaLabel ?? (variant === 'icon' ? title : undefined),
  }) as HTMLButtonElement;
  if (iconName) append(node, [icon(iconName, { size: variant === 'icon' ? 16 : 13, stroke: 1.8 })]);
  if (label) append(node, [el('span', { text: label })]);
  append(node, children);
  if (onClick) node.addEventListener('click', (event) => onClick(event as MouseEvent));
  return node;
}
