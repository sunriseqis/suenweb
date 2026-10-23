import { cn } from '../lib/cn.ts';
import { append, el } from '../lib/dom.ts';
import { button } from '../ui/button.ts';
import { field } from '../ui/field.ts';
import { icon } from '../ui/icons.ts';
import { ENGINES, type EngineId } from '../ui/websearch.ts';

export type IgnoreRow = { url_normalized: string; group_id: number; group_name: string | null; created_at: string };

export type SettingsProps = {
  authed: boolean;
  initialized: boolean;
  themeMode: 'system' | 'light' | 'dark';
  engineId: EngineId;
  fetchIcons: boolean;
  ignores: IgnoreRow[];
  version: string;
  onTheme: (mode: 'system' | 'light' | 'dark') => void;
  onEngine: (id: EngineId) => void;
  onFetchIcons: (value: boolean) => void;
  onChangePassword: (current: string, next: string) => void;
  onUndoIgnore: (urlNormalized: string, groupId: number) => void;
  onLogin: () => void;
  onLogout: () => void;
  onHome: () => void;
};

function section(index: number, title: string, subtitle: string, ...children: HTMLElement[]): HTMLElement {
  const block = el('section', { class: 'border-b border-[var(--c-line)] px-4 py-5 sm:px-6' });
  const head = el('div', { class: 'mb-3 flex items-baseline gap-2' });
  append(head, [
    el('span', { class: 'text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--c-fg-soft)]', text: String(index + 1).padStart(2, '0') }),
    el('h2', { class: 'text-[15px] font-semibold text-fg', text: title }),
  ]);
  block.appendChild(head);
  if (subtitle) block.appendChild(el('p', { class: 'mb-3 max-w-2xl text-[12px] leading-relaxed text-[var(--c-fg-soft)]', text: subtitle }));
  const body = el('div', { class: 'space-y-3' });
  append(body, children);
  block.appendChild(body);
  return block;
}

function segmented<T extends string>(items: Array<{ key: T; label: string; note?: string }>, current: T, onPick: (key: T) => void): HTMLElement {
  const wrap = el('div', { class: 'flex flex-wrap gap-1.5' });
  for (const item of items) {
    wrap.appendChild(
      button({
        label: item.label,
        variant: current === item.key ? 'primary' : 'outline',
        size: 'sm',
        title: item.note,
        onClick: () => onPick(item.key),
      }),
    );
  }
  return wrap;
}

export function renderSettings(props: SettingsProps): HTMLElement {
  const root = el('div', { class: 'mx-auto w-full max-w-[900px] px-2 pb-16 pt-2 sm:px-4' });

  root.appendChild(
    section(0, '外观', '深色为炭黑底 + Metro 蓝，浅色为浅灰底 + 同色系深蓝；版式与磁贴规格完全一致。',
      el('div', { class: 'space-y-1.5' },
        el('span', { class: 'block text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--c-fg-soft)]', text: '主题' }),
        segmented([
          { key: 'system' as const, label: '跟随系统' },
          { key: 'light' as const, label: '浅色' },
          { key: 'dark' as const, label: '深色' },
        ], props.themeMode, props.onTheme),
      ),
      el('p', { class: 'text-[11px] text-[var(--c-fg-soft)]', text: '偏好保存在本机浏览器，不影响其他设备。' }),
    ),
  );

  root.appendChild(
    section(1, '默认搜索引擎', '页面顶部搜索框默认用它；在搜索框里临时切换也会记住。后四个引擎主打不建用户画像。',
      segmented(ENGINES.map((engine) => ({ key: engine.id, label: engine.name, note: engine.note })), props.engineId, props.onEngine),
    ),
  );

  const iconToggle = el('div', { class: 'flex flex-wrap items-center gap-3' });
  iconToggle.append(
    button({
      label: props.fetchIcons ? '已开启' : '已关闭',
      iconName: props.fetchIcons ? 'check' : 'close',
      variant: props.fetchIcons ? 'primary' : 'outline',
      size: 'sm',
      ariaLabel: '站点图标抓取：' + (props.fetchIcons ? '已开启' : '已关闭'),
      onClick: () => props.onFetchIcons(!props.fetchIcons),
    }),
    el('span', { class: 'text-[11px] text-[var(--c-fg-soft)]', text: props.authed ? '开启后，磁贴会向目标站点取 favicon 并缓存在本机' : '登录后才能开启' }),
  );
  root.appendChild(
    section(2, '站点图标', '默认关闭：不开时磁贴只显示文字，服务端不出网。开启后按域名取 favicon，缓存到 data/icons，访客只读缓存。',
      iconToggle,
    ),
  );

  if (props.authed) {
    const current = field({ label: '当前密码', type: 'password', autocomplete: 'current-password' });
    const next = field({ label: '新密码（最短 6 位）', type: 'password', autocomplete: 'new-password' });
    const actions = el('div', { class: 'flex flex-wrap gap-1.5' });
    actions.append(
      button({
        label: '改密码',
        iconName: 'shield',
        variant: 'primary',
        size: 'sm',
        onClick: () => props.onChangePassword((current.input as HTMLInputElement).value, (next.input as HTMLInputElement).value),
      }),
      button({ label: '退出登录', iconName: 'logout', variant: 'secondary', size: 'sm', onClick: props.onLogout }),
    );
    root.appendChild(section(3, '账号与口令', '改密码后其他设备的会话立即失效；新密码同时成为新的备份口令。', current.wrapper, next.wrapper, actions));
  } else {
    root.appendChild(
      section(3, '账号与口令', '当前是游客模式：只能浏览。登录后可编辑书签、改口令、调整图标抓取。',
        el('div', { class: 'flex gap-1.5' }, button({ label: '去登录', iconName: 'login', variant: 'primary', size: 'sm', onClick: props.onLogin })),
      ),
    );
  }

  const ignoreList = el('div', { class: 'space-y-1' });
  if (props.ignores.length === 0) {
    ignoreList.appendChild(el('p', { class: 'text-[11px] text-[var(--c-fg-soft)]', text: '还没有记录。跨组重复时选「忽略并不再提示」会出现在这里。' }));
  } else {
    for (const row of props.ignores) {
      const line = el('div', { class: 'flex flex-wrap items-center justify-between gap-2 border-l-2 border-[var(--c-line-strong)] pl-2' },
        el('div', { class: 'min-w-0' },
          el('p', { class: 'truncate text-[12px] text-fg', text: row.url_normalized }),
          el('p', { class: 'text-[10px] text-[var(--c-fg-soft)]', text: '目标分组：' + (row.group_name ?? '未知') }),
        ),
        button({ label: '撤销', variant: 'ghost', size: 'xs', onClick: () => props.onUndoIgnore(row.url_normalized, row.group_id) }),
      );
      ignoreList.appendChild(line);
    }
  }
  root.appendChild(section(4, '重复提示记录', '这些网址被允许重复添加，且以后不再弹窗。撤销后重新开始提示。', ignoreList));

  const about = el('div', { class: 'flex flex-wrap items-center gap-2 text-[11px] text-[var(--c-fg-soft)]' });
  append(about, [
    el('span', { class: 'border border-[var(--c-line)] px-2 py-0.5', text: '版本 ' + props.version }),
    el('span', { class: 'border border-[var(--c-line)] px-2 py-0.5', text: props.initialized ? '已初始化' : '未初始化' }),
    el('span', { class: 'flex items-center gap-1' }, icon('lock', { size: 12, stroke: 1.8 }), el('span', { text: '写操作均需登录；备份用管理密码派生密钥加密' })),
  ]);
  root.appendChild(section(5, '关于', 'SuenWeb 2.0 自托管书签服务：插件快速收藏、加密备份、跨浏览器扩展清单还原。', about));

  const back = el('div', { class: cn('flex justify-end px-4 pt-4 sm:px-6') });
  back.appendChild(button({ label: '返回书签', iconName: 'bookmark', variant: 'secondary', size: 'sm', onClick: props.onHome }));
  root.appendChild(back);

  return root;
}
