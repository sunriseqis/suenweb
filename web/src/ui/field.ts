import { cn } from '../lib/cn.ts';
import { el } from '../lib/dom.ts';
import { accentAt } from './surfaces.ts';

export function inputClass(index = 0, extra = ''): string {
  const accent = accentAt(index);
  return cn(
    'w-full rounded-full border-4 bg-[var(--c-panel)] px-6 py-3 text-base font-bold text-fg transition-all duration-300',
    accent.border,
    'placeholder:text-fg/40 hover:brightness-110 focus:bg-[var(--c-surface)]',
    'focus:outline-none focus-visible:outline-none',
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
    index = 0,
    hint,
    textarea = false,
    rows = 3,
    autofocus = false,
  } = options;
  const accent = accentAt(index);
  const id = 'f-' + Math.random().toString(36).slice(2, 9);
  const input = textarea
    ? el('textarea', {
        id,
        name: name ?? id,
        rows: String(rows),
        class: cn(inputClass(index, 'rounded-[22px] py-4 leading-relaxed'), 'resize-y'),
        placeholder,
        required: required || undefined,
      }) as HTMLTextAreaElement
    : el('input', {
        id,
        name: name ?? id,
        type,
        class: inputClass(index),
        placeholder,
        autocomplete: autocomplete ?? 'off',
        required: required || undefined,
      }) as HTMLInputElement;
  (input as HTMLInputElement).value = value;

  const labelNode = el('label', {
    for: id,
    class: cn('mb-2 inline-block font-display text-[12px] uppercase tracking-[0.2em] text-fg/80', accent.text),
    text: label,
  });

  const wrapper = el('div', { class: 'w-full' }, labelNode, input);
  if (hint) wrapper.appendChild(el('p', { class: 'mt-2 pl-2 text-sm text-fg/60', text: hint }));
  if (autofocus) {
    queueMicrotask(() => input.focus());
  }
  return { wrapper, input };
}
