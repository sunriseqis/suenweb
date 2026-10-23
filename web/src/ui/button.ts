import { cn } from '../lib/cn.ts';
import { append, el, type Child } from '../lib/dom.ts';
import { icon, type IconName } from './icons.ts';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'icon';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex select-none items-center justify-center gap-2 rounded-full font-heading font-black uppercase tracking-widest transition-all duration-300 ease-out disabled:pointer-events-none disabled:opacity-50';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-riot border-4 border-tertiary text-ink shadow-multi glow hover:-rotate-1 hover:scale-105 active:scale-95 active:shadow-none',
  secondary:
    'border-4 border-dashed border-accent bg-transparent text-fg hover:border-solid hover:bg-accent hover:text-ink hover:scale-105',
  outline:
    'border-4 border-secondary bg-[var(--c-panel)] text-fg shadow-multi hover:-translate-x-1 hover:-translate-y-1 hover:scale-[1.02] active:translate-x-0 active:translate-y-0 active:shadow-none',
  ghost:
    'border-0 bg-transparent text-fg underline decoration-4 decoration-accent underline-offset-4 hover:scale-105 hover:decoration-secondary',
  icon:
    'h-12 w-12 border-4 border-quaternary bg-[var(--c-panel)] text-fg hover:rotate-6 hover:scale-110 hover:border-accent',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-10 px-5 text-[11px]',
  md: 'h-14 px-8 text-sm',
  lg: 'h-16 px-12 text-base tracking-[0.2em]',
};

export function buttonClass(options: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  class?: string;
} = {}): string {
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
  if (iconName) append(node, [icon(iconName, { size: variant === 'icon' ? 22 : 18 })]);
  if (label) append(node, [el('span', { text: label })]);
  append(node, children);
  if (onClick) node.addEventListener('click', (event) => onClick(event as MouseEvent));
  return node;
}
