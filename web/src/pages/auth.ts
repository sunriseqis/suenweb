import { cn } from '../lib/cn.ts';
import { append, el } from '../lib/dom.ts';
import { button } from '../ui/button.ts';
import { field } from '../ui/field.ts';
import { icon, type IconName } from '../ui/icons.ts';

type Floater = { name: IconName; top: string; left: string; size: number; color: string; anim: string };

const FLOATERS: Floater[] = [
  { name: 'star', top: '8%', left: '6%', size: 64, color: 'text-tertiary', anim: 'anim-float' },
  { name: 'sparkle', top: '18%', left: '84%', size: 48, color: 'text-secondary', anim: 'anim-float-rev' },
  { name: 'triangle', top: '62%', left: '10%', size: 56, color: 'text-quaternary', anim: 'anim-bounce' },
  { name: 'circle', top: '74%', left: '78%', size: 72, color: 'text-accent', anim: 'anim-float' },
  { name: 'bolt', top: '38%', left: '92%', size: 40, color: 'text-quinary', anim: 'anim-wiggle' },
  { name: 'square', top: '88%', left: '40%', size: 44, color: 'text-secondary', anim: 'anim-float-rev' },
];

export type AuthProps = {
  mode: 'setup' | 'login';
  busy: boolean;
  error: string | null;
  onSubmit: (password: string) => void;
  onHome: () => void;
};

export function renderAuth(props: AuthProps): HTMLElement {
  const { mode, busy, error } = props;
  const root = el('div', { class: 'relative z-10 flex min-h-screen items-center justify-center overflow-hidden px-4 py-16' });

  root.appendChild(el('div', { class: 'pattern-mesh pointer-events-none absolute inset-0', 'aria-hidden': 'true' }));
  root.appendChild(el('div', { class: 'pattern-stripes pointer-events-none absolute inset-0', 'aria-hidden': 'true' }));
  root.appendChild(
    el('span', {
      class: 'pointer-events-none absolute -bottom-24 left-1/2 -translate-x-1/2 select-none font-heading text-[18rem] font-black leading-none text-fg/[0.06]',
      'aria-hidden': 'true',
      text: mode === 'setup' ? 'HELLO' : 'AGAIN',
    }),
  );

  for (const floater of FLOATERS) {
    root.appendChild(
      el('span', {
        class: cn('pointer-events-none absolute opacity-80', floater.color, floater.anim),
        style: 'top:' + floater.top + ';left:' + floater.left,
        'aria-hidden': 'true',
        'data-decor': 'true',
      },
        icon(floater.name, { size: floater.size, stroke: 2.2 }),
      ),
    );
  }

  const cardEl = el('div', {
    class: 'pattern-dots relative w-full max-w-lg rounded-[32px] border-8 border-accent bg-[var(--c-surface)] p-8 shadow-multi-lg sm:p-10',
    style: '--sh-1:var(--c-tertiary);--sh-2:var(--c-quinary);--sh-3:var(--c-secondary);',
  });

  append(cardEl, [
    el('p', { class: 'font-display text-[11px] uppercase tracking-[0.4em] text-secondary', text: 'SuenWeb' }),
    el('h1', { class: 'mt-3 text-5xl text-fg sm:text-6xl' },
      el('span', { class: 'text-gradient anim-gradient', text: mode === 'setup' ? 'FIRST' : 'WELCOME' }),
      el('span', { class: 'ts-cn block text-2xl sm:text-3xl', text: mode === 'setup' ? '先设一个管理密码' : '回到你的书签' }),
    ),
    el('p', { class: 'mt-4 text-sm text-fg/70', text: mode === 'setup' ? '这个密码同时是备份加密口令，最短 6 位。丢了只能靠备份文件恢复。' : '密码最短 6 位；忘了只能从备份还原。' }),
  ]);

  const pw = field({
    label: mode === 'setup' ? '设置管理密码' : '管理密码',
    type: 'password',
    placeholder: '至少 6 位',
    autocomplete: mode === 'setup' ? 'new-password' : 'current-password',
    required: true,
    index: 1,
    autofocus: true,
  });

  const submit = button({
    label: busy ? '处理中…' : mode === 'setup' ? '开始使用' : '进入书签库',
    iconName: 'login',
    variant: 'primary',
    size: 'lg',
    disabled: busy,
    class: 'mt-6 w-full',
    onClick: () => props.onSubmit((pw.input as HTMLInputElement).value),
  });

  pw.input.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Enter') submit.click();
  });

  append(cardEl, [
    el('div', { class: 'mt-6' }, pw.wrapper),
    error ? el('p', { class: 'mt-3 rounded-2xl border-4 border-quaternary px-4 py-2 text-sm font-bold text-fg', text: error }) : null,
    submit,
    el('div', { class: 'mt-6 flex items-center justify-between gap-3' },
      button({ label: '直接逛逛', variant: 'ghost', size: 'sm', onClick: props.onHome }),
      el('span', { class: 'font-display text-[10px] uppercase tracking-[0.3em] text-fg/40', text: mode === 'setup' ? 'step 1 / 1' : 'session 30d' }),
    ),
  ]);

  root.appendChild(cardEl);
  return root;
}
