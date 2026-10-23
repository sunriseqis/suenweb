import { cn } from '../lib/cn.ts';
import { el } from '../lib/dom.ts';
import { button } from '../ui/button.ts';
import { field } from '../ui/field.ts';
import { icon } from '../ui/icons.ts';
import { card } from '../ui/surfaces.ts';

export type IgnoreRow = { url_normalized: string; group_id: number; group_name: string | null; created_at: string };

export type SettingsProps = {
  authed: boolean;
  initialized: boolean;
  themeMode: 'system' | 'light' | 'dark';
  ignores: IgnoreRow[];
  version: string;
  onTheme: (mode: 'system' | 'light' | 'dark') => void;
  onChangePassword: (current: string, next: string) => void;
  onUndoIgnore: (urlNormalized: string, groupId: number) => void;
  onLogin: () => void;
  onLogout: () => void;
  onHome: () => void;
};

function section(index: number, title: string, subtitle: string, ...children: HTMLElement[]): HTMLElement {
  const wrap = card({ index, class: 'mb-6', dashed: index % 2 === 1, padding: 'md' });
  wrap.append(
    el('p', { class: 'font-display text-[11px] uppercase tracking-[0.3em] text-fg/50', text: String(index + 1).padStart(2, '0') }),
    el('h2', { class: 'mt-1 text-3xl text-fg ts-cn', text: title }),
    el('p', { class: 'mt-2 text-sm text-fg/60', text: subtitle }),
    el('div', { class: 'mt-5 space-y-4' }, ...children),
  );
  return wrap;
}

export function renderSettings(props: SettingsProps): HTMLElement {
  const root = el('div', { class: 'relative z-10 mx-auto w-full max-w-4xl px-4 pb-24 pt-10 sm:px-8' });

  const hero = el('header', { class: 'pattern-mesh relative mb-10 overflow-hidden rounded-[32px] border-4 border-tertiary p-8' });
  hero.append(
    el('span', {
      class: 'pointer-events-none absolute -bottom-10 -right-4 select-none font-display text-[8rem] leading-none text-fg/10',
      'aria-hidden': 'true',
      text: 'TUNE',
    }),
    el('p', { class: 'font-display text-[11px] uppercase tracking-[0.4em] text-quaternary', text: 'Settings' }),
    el('h1', { class: 'mt-2 text-5xl text-fg' },
      el('span', { class: 'ts-cn', text: '把界面' }),
      el('span', { class: 'text-gradient anim-gradient', text: ' 调成你的 ' }),
      el('span', { class: 'ts-cn', text: '样子' }),
    ),
    el('div', { class: 'mt-5 flex flex-wrap gap-2' },
      button({ label: '回书签库', iconName: 'bookmark', variant: 'secondary', size: 'sm', onClick: props.onHome }),
    ),
  );
  root.appendChild(hero);

  const themeButtons = el('div', { class: 'flex flex-wrap gap-2' });
  const themes: Array<{ key: 'system' | 'light' | 'dark'; label: string; iconName: 'monitor' | 'sun' | 'moon' }> = [
    { key: 'system', label: '跟随系统', iconName: 'monitor' },
    { key: 'light', label: '浅色', iconName: 'sun' },
    { key: 'dark', label: '深色', iconName: 'moon' },
  ];
  for (const theme of themes) {
    themeButtons.appendChild(
      button({
        label: theme.label,
        iconName: theme.iconName,
        variant: props.themeMode === theme.key ? 'primary' : 'outline',
        size: 'sm',
        onClick: () => props.onTheme(theme.key),
      }),
    );
  }

  root.appendChild(
    section(0, '外观', '深色为炭黑底 + Metro 蓝，浅色为浅灰底 + 同色系深蓝；版式与磁贴尺寸完全一致。',
      el('div', { class: 'space-y-2' },
        el('span', { class: 'font-display text-[11px] uppercase tracking-[0.25em] text-fg/60', text: '主题' }),
        themeButtons,
      ),
      el('p', { class: 'text-xs text-fg/50', text: '主题偏好保存在本机浏览器；书签数据与备份口令才在服务端。' }),
    ),
  );

  if (props.authed) {
    const current = field({ label: '当前密码', type: 'password', autocomplete: 'current-password', index: 2 });
    const next = field({ label: '新密码（最短 6 位）', type: 'password', autocomplete: 'new-password', index: 3 });
    root.appendChild(
      section(1, '账号与口令', '改密码后其他设备的会话会立即失效；新密码同时成为新的备份口令。',
        current.wrapper,
        next.wrapper,
        el('div', { class: 'flex flex-wrap gap-2' },
          button({
            label: '改密码',
            iconName: 'shield',
            variant: 'primary',
            size: 'sm',
            onClick: () => props.onChangePassword(
              (current.input as HTMLInputElement).value,
              (next.input as HTMLInputElement).value,
            ),
          }),
          button({ label: '退出登录', iconName: 'logout', variant: 'secondary', size: 'sm', onClick: props.onLogout }),
        ),
      ),
    );
  } else {
    root.appendChild(
      section(1, '账号与口令', '当前是游客模式：只能浏览。登录后可编辑书签、改口令。',
        button({ label: '去登录', iconName: 'login', variant: 'primary', size: 'sm', onClick: props.onLogin }),
      ),
    );
  }

  const ignoreList = el('div', { class: 'space-y-2' });
  if (props.ignores.length === 0) {
    ignoreList.appendChild(el('p', { class: 'text-sm text-fg/50', text: '还没有记录。跨组重复时选「忽略并不再提示」会出现在这里。' }));
  } else {
    for (const row of props.ignores) {
      const line = el('div', { class: 'flex flex-wrap items-center justify-between gap-2 rounded-2xl border-4 border-dashed border-quinary px-4 py-2' },
        el('div', { class: 'min-w-0' },
          el('p', { class: 'truncate text-sm font-bold text-fg', text: row.url_normalized }),
          el('p', { class: 'text-xs text-fg/50', text: '目标分组：' + (row.group_name ?? '未知') }),
        ),
        button({ label: '撤销', iconName: 'refresh', variant: 'secondary', size: 'sm', onClick: () => props.onUndoIgnore(row.url_normalized, row.group_id) }),
      );
      ignoreList.appendChild(line);
    }
  }
  root.appendChild(
    section(2, '重复提示记录', '这些网址被允许重复添加，且以后不再弹窗。撤销后重新开始提示。', ignoreList),
  );

  root.appendChild(
    section(3, '关于', 'SuenWeb 2.0 自托管书签服务：插件快速收藏、加密备份、跨浏览器扩展清单还原。',
      el('div', { class: 'flex flex-wrap items-center gap-3' },
        el('span', { class: 'rounded-full border-4 border-secondary px-4 py-1 text-sm font-black text-fg', text: '版本 ' + props.version }),
        el('span', { class: 'rounded-full border-4 border-accent px-4 py-1 text-sm font-black text-fg', text: '设计系统 Maximalism / Dopamine' }),
        el('span', { class: cn('rounded-full border-4 border-tertiary px-4 py-1 text-sm font-black text-fg'), text: props.initialized ? '已初始化' : '未初始化' }),
      ),
      el('p', { class: 'flex items-center gap-2 text-xs text-fg/50' },
        icon('lock', { size: 14 }),
        el('span', { text: '所有写操作都需要登录；备份文件使用管理密码派生的密钥加密。' }),
      ),
    ),
  );

  return root;
}
