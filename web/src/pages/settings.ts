// v6 设置页：两 Tab（通用 / 数据）+ 8 卡片；所有输入框进弹窗（toolDialogs.ts）
import { append, el, safeHref } from '../lib/dom.ts';
import { api } from '../lib/api.ts';
export type IgnoreRow = { url_normalized: string; group_id: number; group_name: string | null; created_at: string };
import { button } from '../ui/button.ts';
import { ADDON_DOWNLOAD_BASE } from '../lib/api.ts';
import {
  openChangePasswordDialog,
  openDeadLinksDialog,
  openDuplicatesDialog,
  openExportConfigDialog,
  openIconRefreshDialog,
  openImportBookmarksDialog,
  openRestoreBackupDialog,
  openRestoreConfigDialog,
  openWebDavConfigDialog,
} from './toolDialogs.ts';
import { ENGINES, type EngineId } from '../ui/websearch.ts';
import { clearIconFailureCache } from './bookmarks.ts';

export type SettingsTab = 'general' | 'data';

export type SettingsProps = {
  tab: SettingsTab;
  authed: boolean;
  initialized: boolean;
  themeMode: 'system' | 'light' | 'dark';
  engineId: EngineId;
  fetchIcons: boolean;
  ignores: IgnoreRow[];
  version: string;
  onTab: (tab: SettingsTab) => void;
  onTheme: (mode: 'system' | 'light' | 'dark') => void;
  onEngine: (id: EngineId) => void;
  onFetchIcons: (value: boolean) => void;
  onChangePassword: (current: string, next: string) => Promise<boolean>;
  onUndoIgnore: (urlNormalized: string, groupId: number) => void;
  onLogin: () => void;
  onLogout: () => void;
  onHome: () => void;
  onDataChanged: () => void; // 导入/还原/备份等操作后刷新全局数据
};

type CardChildren = Array<HTMLElement | null>;

function card(title: string, subtitle: string | null, ...children: CardChildren): HTMLElement {
  const block = el('section', { class: 'border border-[var(--c-line)] bg-[var(--c-surface)] p-4' });
  const head = el('div', { class: 'mb-2 flex items-baseline gap-2' });
  append(head, [
    el('h2', { class: 'text-[15px] font-semibold text-fg', text: title }),
  ]);
  block.appendChild(head);
  if (subtitle) block.appendChild(el('p', { class: 'mb-3 text-[11px] leading-relaxed text-[var(--c-fg-soft)]', text: subtitle }));
  const body = el('div', { class: 'space-y-3' });
  for (const child of children) if (child) body.appendChild(child);
  block.appendChild(body);
  return block;
}

function segmented<T extends string>(label: string, items: Array<{ key: T; label: string; note?: string }>, current: T, onPick: (key: T) => void): HTMLElement {
  const wrap = el('div', {},
    el('p', { class: 'mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--c-fg-soft)]', text: label }),
    el('div', { class: 'flex flex-wrap gap-1.5' },
      ...items.map((item) => button({
        label: item.label,
        variant: current === item.key ? 'primary' : 'outline',
        size: 'sm',
        title: item.note,
        onClick: () => onPick(item.key),
      })),
    ),
  );
  return wrap;
}

function toolbar(...buttons: HTMLElement[]): HTMLElement {
  return el('div', { class: 'flex flex-wrap gap-1.5' }, ...buttons);
}

export function renderSettings(props: SettingsProps): HTMLElement {
  const root = el('div', { class: 'mx-auto flex w-full max-w-[1000px] flex-col gap-3 px-2 pb-16 pt-2 sm:flex-row sm:px-4' });

  // ===== 左侧 Tab 导航（窄屏顶部横滚）=====
  const tabs: Array<{ key: SettingsTab; label: string }> = [
    { key: 'general', label: '通用' },
    { key: 'data', label: '数据' },
  ];
  const nav = el('nav', {
    class: 'flex shrink-0 gap-1 overflow-x-auto sm:sticky sm:top-14 sm:w-28 sm:flex-col sm:overflow-visible',
    role: 'tablist',
    'aria-label': '设置分区',
  });
  for (const tab of tabs) {
    const active = props.tab === tab.key;
    nav.appendChild(
      button({
        label: tab.label,
        variant: active ? 'primary' : 'ghost',
        size: 'sm',
        ariaLabel: tab.label + ' 设置',
        onClick: () => props.onTab(tab.key),
      }),
    );
  }
  root.appendChild(nav);

  // ===== 右侧内容 =====
  const content = el('div', { class: 'min-w-0 flex-1 space-y-3' });
  root.appendChild(content);

  const done = (message: string): void => {
    import('../ui/toast.ts').then(({ toast }) => toast(message, 'success'));
    props.onDataChanged();
  };
  const fail = (message: string): void => {
    import('../ui/toast.ts').then(({ toast }) => toast(message, 'error'));
  };

  if (props.tab === 'general') {
    // ---------- 卡片 ① 设置（全内联零弹窗） ----------
    content.appendChild(
      card('设置', '全部即时生效，点一下就完。',
        segmented('主题', [
          { key: 'system' as const, label: '跟随系统' },
          { key: 'light' as const, label: '浅色' },
          { key: 'dark' as const, label: '深色' },
        ], props.themeMode, props.onTheme),
        segmented('默认搜索引擎', ENGINES.map((engine) => ({ key: engine.id, label: engine.name, note: engine.note })), props.engineId, props.onEngine),
        segmented('站点图标', [
          { key: 'on' as const, label: '已开启' },
          { key: 'off' as const, label: '已关闭' },
        ], props.fetchIcons ? 'on' : 'off', (key) => {
          if (!props.authed) { fail('登录后才能修改图标抓取'); return; }
          void props.onFetchIcons(key === 'on');
        }),
      ),
    );

    // ---------- 卡片 ② 账号 ----------
    const accountButtons = toolbar();
    accountButtons.append(
      button({
        label: '修改密码', iconName: 'shield', variant: 'secondary', size: 'sm',
        onClick: () => {
          if (!props.authed) { fail('游客模式下没有密码可改，请先登录'); return; }
          openChangePasswordDialog(fail, async (current, next) => {
            await props.onChangePassword(current, next);
            return true;
          });
        },
      }),
      props.authed
        ? button({ label: '登出', iconName: 'logout', variant: 'ghost', size: 'sm', onClick: props.onLogout })
        : button({ label: '登录', iconName: 'login', variant: 'primary', size: 'sm', onClick: props.onLogin }),
    );
    content.appendChild(
      card('账号', props.authed ? '改密后其他设备的会话立即失效；新密码同时成为新的备份口令。' : '当前是游客模式：只能浏览。',
        accountButtons,
      ),
    );

    // ---------- 卡片 ③ 功能（治理 + 插件状态 + 插件下载 + 扩展清单） ----------
    const iconRefreshBtn = button({
      label: '刷新站点图标', iconName: 'refresh', variant: 'secondary', size: 'sm',
      onClick: () => openIconRefreshDialog((message) => {
        clearIconFailureCache();
        done(message);
      }, fail),
    });

    const pluginStatus = el('div', { class: 'space-y-0.5 text-[12px] text-fg' });
    void (async () => {
      if (!props.authed) {
        pluginStatus.appendChild(el('p', { class: 'text-[11px] text-[var(--c-fg-soft)]', text: '登录后显示插件同步状态。' }));
        return;
      }
      const status = await api.syncStatus();
      pluginStatus.textContent = '';
      if (!status.ok) {
        pluginStatus.appendChild(el('p', { class: 'text-[11px] text-[var(--c-fg-soft)]', text: '读取失败：' + status.error.message }));
        return;
      }
      const s = status.data;
      const last = s.lastHeartbeat ? new Date(s.lastHeartbeat).toLocaleString() : '从未';
      const online = s.lastHeartbeat ? Date.now() - new Date(s.lastHeartbeat).getTime() < 11 * 60 * 1000 : false;
      pluginStatus.appendChild(el('p', { class: 'text-[12px]', text: '上次心跳 ' + last + ' · 待同步 ' + s.pending + ' · 失败 ' + s.failed + ' · ' + (online ? '在线' : '离线') }));
    })();

    const addonBox = el('div', { class: 'space-y-1 text-[12px] text-fg' });
    void (async () => {
      const result = await api.addonList();
      addonBox.textContent = '';
      if (!result.ok || !result.data.available) {
        addonBox.appendChild(el('p', { class: 'text-[11px] text-[var(--c-fg-soft)]', text: (result.ok ? result.data.hint : result.error.message) ?? '服务端还没有插件包构建产物。' }));
        return;
      }
      const names = el('div', { class: 'flex flex-wrap gap-1.5' });
      for (const file of result.data.files) {
        names.appendChild(
          el('a', {
            href: ADDON_DOWNLOAD_BASE + file,
            class: 'border border-[var(--c-line)] bg-[var(--c-bg)] px-2.5 py-1 text-[11px] text-fg hover:border-[var(--c-accent)] hover:text-[var(--c-accent)]',
            text: file.endsWith('.xpi')
              ? (file.includes('-signed') ? 'Firefox 签名版 (.xpi)' : 'Firefox 调试版 (.xpi)')
              : file.endsWith('.crx') ? 'Chrome (.crx)' : 'Chrome/Edge 加载包 (.zip)',
          }),
        );
      }
      addonBox.appendChild(names);
      addonBox.appendChild(el('p', { class: 'text-[11px] text-[var(--c-fg-soft)]', text: 'Firefox 装 .xpi（MV2 包，站点权限安装即授予）；Chrome/Edge 解压 .zip 后开发者模式「加载已解压」；装后在插件设置里填本站地址并登录。' }));
    })();

    const extBox = el('div', { class: 'space-y-2 text-[12px] text-fg' });
    const BROWSER_NAMES: Record<string, string> = { firefox: 'Firefox', chrome: 'Chrome / Chromium', edge: 'Edge', other: '其他' };
    function storeHref(entry: { ext_id: string; name: string; url: string | null }, browser: string): string {
      const name = encodeURIComponent(entry.name);
      const id = entry.ext_id;
      if (browser === 'firefox') {
        if (/^[a-z0-9.@-]+$/i.test(id) && !id.startsWith('{')) return 'https://addons.mozilla.org/firefox/addon/' + id + '/';
        return 'https://addons.mozilla.org/firefox/search/?q=' + name;
      }
      if (browser === 'edge') return 'https://microsoftedge.microsoft.com/addons/search/' + name;
      return 'https://chromewebstore.google.com/detail/' + id;
    }
    void (async () => {
      if (!props.authed) {
        extBox.appendChild(el('p', { class: 'text-[11px] text-[var(--c-fg-soft)]', text: '登录后显示已备份的扩展清单。' }));
        return;
      }
      const result = await api.extensionList();
      extBox.textContent = '';
      if (!result.ok) { extBox.appendChild(el('p', { class: 'text-[11px] text-[var(--c-fg-soft)]', text: '读取失败：' + result.error.message })); return; }
      const inv = result.data;
      if (inv.total === 0) {
        extBox.appendChild(el('p', { class: 'text-[11px] text-[var(--c-fg-soft)]', text: '还没有清单。装好插件后等一次自动同步，或在插件设置里点「备份扩展清单」。' }));
        return;
      }
      for (const browser of Object.keys(inv.byBrowser).sort()) {
        const entries = inv.byBrowser[browser];
        extBox.appendChild(el('p', { class: 'text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--c-fg-soft)]', text: BROWSER_NAMES[browser] + '（' + entries.length + '）' }));
        for (const entry of entries) {
          const line = el('div', { class: 'flex flex-wrap items-center justify-between gap-2 border-l-2 border-[var(--c-line-strong)] pl-2' });
          line.appendChild(el('p', { class: 'min-w-0 truncate text-[12px] text-fg', text: entry.name + (entry.version ? ' · ' + entry.version : '') }));
          const actions = el('div', { class: 'flex items-center gap-1' });
          const storeUrl = safeHref(entry.url || storeHref(entry, browser));
          actions.appendChild(el(storeUrl ? 'a' : 'span', {
            ...(storeUrl ? { href: storeUrl, target: '_blank', rel: 'noopener noreferrer' } : {}),
            class: 'text-[11px] text-[var(--c-accent)] underline',
            text: '商店页',
            title: entry.url || storeHref(entry, browser),
          }));
          actions.appendChild(button({
            label: '删除', variant: 'ghost', size: 'xs',
            onClick: async () => {
              const del = await api.extensionDelete(entry.id);
              if (del.ok) { done('已删除 ' + entry.name); }
              else fail(del.error.message);
            },
          }));
          extBox.appendChild(line);
        }
      }
    })();

    content.appendChild(
      card('功能', '站点图标维护、插件同步状态、插件下载与扩展清单。',
        toolbar(iconRefreshBtn),
        el('div', {},
          el('p', { class: 'mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--c-fg-soft)]', text: '插件状态' }),
          pluginStatus,
        ),
        el('div', {},
          el('p', { class: 'mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--c-fg-soft)]', text: '浏览器插件下载' }),
          addonBox,
        ),
        el('div', {},
          el('p', { class: 'mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--c-fg-soft)]', text: '扩展清单' }),
          extBox,
        ),
      ),
    );

    // ---------- 卡片 ④ 关于 ----------
    content.appendChild(
      card('关于', null,
        el('p', { class: 'text-[12px] text-fg', text: 'SuenWeb ' + props.version }),
        el('p', { class: 'text-[11px] text-[var(--c-fg-soft)]', text: '自托管书签服务：插件快速收藏、加密备份、跨浏览器扩展清单还原。' }),
      ),
    );
  } else {
    // ================= Tab 2 · 数据 =================
    // ---------- 卡片 ① 书签 ----------
    content.appendChild(
      card('书签', '导入浏览器导出的 HTML（同名文件夹自动合并、归一化去重）；导出可直接被任意浏览器导入。',
        toolbar(
          button({ label: '导入', iconName: 'plus', variant: 'secondary', size: 'sm', onClick: () => openImportBookmarksDialog(done, fail) }),
          button({ label: '导出', iconName: 'external', variant: 'secondary', size: 'sm', onClick: () => { window.location.href = api.exportBookmarksUrl; } }),
        ),
      ),
    );

    // ---------- 卡片 ② 配置 ----------
    content.appendChild(
      card('配置', '加密全量配置（分组 + 链接 + 扩展清单）；密钥由管理密码派生，导出文件不含任何明文。',
        toolbar(
          button({ label: '导入', iconName: 'refresh', variant: 'secondary', size: 'sm', onClick: () => openRestoreConfigDialog(done, fail) }),
          button({ label: '导出', iconName: 'shield', variant: 'secondary', size: 'sm', onClick: () => openExportConfigDialog(done, fail) }),
        ),
      ),
    );

    // ---------- 卡片 ③ 链接 ----------
    content.appendChild(
      card('链接', '重复清理与失效检测，全在弹窗里完成。',
        toolbar(
          button({ label: '检查重复', iconName: 'search', variant: 'secondary', size: 'sm', onClick: () => openDuplicatesDialog(done, fail) }),
          button({ label: '检查失效', iconName: 'bolt', variant: 'secondary', size: 'sm', onClick: () => openDeadLinksDialog(done, fail) }),
        ),
      ),
    );

    // ---------- 卡片 ④ 备份 ----------
    const statusLine = el('p', { class: 'text-[12px] text-fg' });
    void (async () => {
      const status = await api.backupStatus();
      statusLine.textContent = '';
      if (!status.ok) { statusLine.textContent = '读取备份状态失败：' + status.error.message; return; }
      const s = status.data;
      statusLine.textContent = s.configured
        ? '已配置 ' + s.address + ' · 保留 ' + s.keepCount + ' 份 · 上次备份 ' + (s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : '从未')
        : '未配置 WebDAV：不执行任何自动备份';
    })();

    async function uploadBackup(): Promise<void> {
      const result = await api.backupRun('manual');
      if (!result.ok) { fail(result.error.message); return; }
      done('已上传 ' + result.data.file + '（' + Math.round(result.data.size / 1024) + ' KB）');
      await props.onDataChanged();
    }

    content.appendChild(
      card('备份', '配置 WebDAV 后每日自动加密上传并按份数轮转；未配置则不做任何备份。',
        statusLine,
        toolbar(
          button({ label: '配置', iconName: 'settings', variant: 'secondary', size: 'sm', onClick: () => openWebDavConfigDialog(done, fail, () => props.onDataChanged()) }),
          button({ label: '上传备份', iconName: 'bolt', variant: 'secondary', size: 'sm', onClick: () => void uploadBackup() }),
          button({ label: '还原备份', iconName: 'refresh', variant: 'secondary', size: 'sm', onClick: () => openRestoreBackupDialog(done, fail, () => props.onDataChanged()) }),
        ),
      ),
    );
  }

  return root;
}
