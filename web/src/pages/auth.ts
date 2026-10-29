import { append, el } from '../lib/dom.ts';
import { button } from '../ui/button.ts';
import { field } from '../ui/field.ts';
import { brandLogo } from '../ui/logo.ts';

export type AuthProps = {
  mode: 'setup' | 'login';
  error: string | null;
  onSubmit: (password: string) => Promise<void> | void;
  onHome: () => void;
};

export function renderAuth(props: AuthProps): HTMLElement {
  const { mode, error } = props;
  const root = el('div', { class: 'relative z-10 flex min-h-screen items-center justify-center bg-[var(--c-bg)] px-4 py-16' });
  const panel = el('div', { class: 'w-full max-w-sm border border-[var(--c-line)] bg-[var(--c-surface)]' });
  panel.appendChild(el('div', { class: 'h-0.5 w-full bg-accent', 'aria-hidden': 'true' }));

  const body = el('div', { class: 'p-7' });
  append(body, [
    el('div', { class: 'flex items-center gap-2 text-accent' }, brandLogo(20)),
    el('h1', { class: 'mt-4 text-[26px] font-light leading-tight text-fg', text: mode === 'setup' ? '设置管理密码' : '登录' }),
    el('p', {
      class: 'mt-2 text-[12px] leading-relaxed text-[var(--c-fg-soft)]',
      text:
        mode === 'setup'
          ? '这个密码同时是备份加密口令，最短 6 位。丢失只能靠备份文件恢复。'
          : '密码最短 6 位。游客可以只读书签，登录后才能编辑。',
    }),
  ]);

  const pw = field({
    label: '管理密码',
    type: 'password',
    placeholder: '至少 6 位',
    autocomplete: mode === 'setup' ? 'new-password' : 'current-password',
    required: true,
    autofocus: true,
  });

  // busy 状态只作用于按钮本身，不进 store、不触发全量重绘（避免密码输入被清空）
  const submit = button({
    label: mode === 'setup' ? '开始使用' : '进入',
    variant: 'primary',
    class: 'mt-4 w-full justify-center',
    onClick: () => {
      if (submit.disabled) return;
      submit.disabled = true;
      void Promise.resolve(props.onSubmit((pw.input as HTMLInputElement).value)).finally(() => {
        submit.disabled = false;
      });
    },
  });

  pw.input.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Enter') submit.click();
  });

  append(body, [
    el('div', { class: 'mt-5' }, pw.wrapper),
    error
      ? el('p', { class: 'mt-3 border-l-2 border-accent bg-[var(--c-accent-soft)] px-2 py-1 text-[11px] text-fg', text: error })
      : null,
    submit,
    el('div', { class: 'mt-4 flex items-center justify-between' },
      button({ label: '先逛逛', variant: 'ghost', size: 'xs', onClick: props.onHome }),
      el('span', { class: 'text-[9px] uppercase tracking-[0.18em] text-[var(--c-fg-soft)]', text: 'session 30d' }),
    ),
  ]);

  panel.appendChild(body);
  root.appendChild(panel);
  return root;
}
