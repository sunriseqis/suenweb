import { cn } from '../lib/cn.ts';
import { el } from '../lib/dom.ts';

export function inputClass(_index = 0, extra = ''): string {
  return cn(
    'w-full rounded-none border border-[var(--c-line)] bg-[var(--c-surface)] px-3 py-2 text-[13px] text-fg transition-colors',
    'placeholder:text-[var(--c-fg-soft)] hover:border-[var(--c-line-strong)] focus:border-accent focus:outline-none',
    extra,
  );
}

export type FieldOptions = {
  label: string;
  value?: string;
  type?: 'text' | 'password' | 'url' | 'search';
  placeholder?: string;
  autocomplete?: string;
  required?: boolean;
  name?: string;
  index?: number;
  hint?: string;
  textarea?: boolean;
  rows?: number;
  autofocus?: boolean;
  compact?: boolean;
};

export type FieldHandle = {
  wrapper: HTMLElement;
  input: HTMLInputElement | HTMLTextAreaElement;
};

export function field(options: FieldOptions): FieldHandle {
  const {
    label,
    value = '',
    type = 'text',
    placeholder = '',
    autocomplete,
    required = false,
    name,
    hint,
    textarea = false,
    rows = 3,
    autofocus = false,
    compact = false,
  } = options;
  const id = 'f-' + Math.random().toString(36).slice(2, 9);
  const input = textarea
    ? (el('textarea', {
        id,
        name: name ?? id,
        rows: String(rows),
        class: cn(inputClass(0), 'resize-y'),
        placeholder,
        required: required || undefined,
      }) as HTMLTextAreaElement)
    : (el('input', {
        id,
        name: name ?? id,
        type,
        class: compact ? inputClass(0, 'h-8 py-1 text-[12px]') : inputClass(0),
        placeholder,
        autocomplete: autocomplete ?? 'off',
        required: required || undefined,
      }) as HTMLInputElement);
  (input as HTMLInputElement).value = value;

  const labelNode = el('label', {
    for: id,
    class: compact
      ? 'mb-1 block text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--c-fg-soft)]'
      : 'mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--c-fg-soft)]',
    text: label,
  });

  const wrapper = el('div', { class: 'w-full' }, labelNode, input);
  if (hint) wrapper.appendChild(el('p', { class: 'mt-1 text-[11px] text-[var(--c-fg-soft)]', text: hint }));
  if (autofocus) queueMicrotask(() => input.focus());
  return { wrapper, input };
}
