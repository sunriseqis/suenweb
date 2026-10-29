import { api, type GroupWithLinks, type Link } from './lib/api.ts';
import { clear, el } from './lib/dom.ts';
import { createStore } from './lib/store.ts';
import {
  applyTheme,
  getThemeMode,
  setThemeMode,
  setTier,
  watchSystemTheme,
} from './lib/theme.ts';
import { renderAuth } from './pages/auth.ts';
import { renderBookmarks, type DisplayMode } from './pages/bookmarks.ts';
import { openConfirmDialog, openGroupDialog, openLinkDrawer, type LinkDraft } from './pages/dialogs.ts';
import { renderSettings, type IgnoreRow, type SettingsTab } from './pages/settings.ts';
import { button } from './ui/button.ts';
import { mountCapsule, unmountCapsule, type CapsuleItem } from './ui/capsule.ts';
import { brandLogo } from './ui/logo.ts';
import { connectLive, type LiveHandle } from './lib/live.ts';
import { getEngineId, setEngineId } from './ui/websearch.ts';
import { toast } from './ui/toast.ts';

const VERSION = '2.0.0-m3';

let live: LiveHandle | null = null;
let liveRefreshQueued = false;

type Route = '#/' | '#/login' | '#/setup' | '#/settings';

type AppState = {
  route: Route;
  initialized: boolean;
  authed: boolean;
  editing: boolean;
  fetchIcons: boolean;
  tabGroupId: number | null;
  groups: GroupWithLinks[];
  query: string;
  activeGroupId: number | null;
  view: 'grid' | 'list';
  authError: string | null;
  ignores: IgnoreRow[];
  settingsTab: SettingsTab;
  loadError: string | null;
};

const store = createStore<AppState>({
  route: '#/',
  initialized: true,
  authed: false,
  editing: false,
  fetchIcons: false,
  tabGroupId: null,
  groups: [],
  query: '',
  activeGroupId: null,
  view: 'grid',
  authError: null,
  ignores: [],
  settingsTab: (window.location.hash.startsWith('#/settings/data') ? 'data' : 'general') as SettingsTab,
  loadError: null,
});

function currentRoute(): Route {
  let hash = window.location.hash || '#/';
  if (hash === '#/data') {
    window.location.hash = '#/settings/data';
    hash = '#/settings/data';
  }
  if (hash === '#/login') return '#/login';
  if (hash === '#/setup') return '#/setup';
  if (hash.startsWith('#/settings')) return '#/settings';
  return '#/';
}

function go(route: Route): void {
  if (route === '#/settings' && window.location.hash.startsWith('#/settings')) {
    render();
    return;
  }
  if (window.location.hash === route) {
    render();
    return;
  }
  window.location.hash = route;
}

// S11 并发乱序防护：每次 refresh 开始时代数 +1；响应返回时若代数已过期
// （说明期间又发起了新的 refresh），则整个响应丢弃，旧数据不会覆盖新状态。
let refreshGeneration = 0;

async function refresh(options?: { silent?: boolean }): Promise<void> {
  const generation = ++refreshGeneration;
  const [data, status] = await Promise.all([api.data(), api.authStatus()]);
  if (generation !== refreshGeneration) return; // 已有更新的 refresh 发出，丢弃过期响应
  if (!data.ok) {
    if (options?.silent) console.warn('[refresh] live 通道刷新失败（静默降级）:', data.error.message);
    else store.set({ loadError: data.error.message });
    return;
  }
  if (!status.ok) {
    if (options?.silent) console.warn('[refresh] live 通道刷新失败（静默降级）:', status.error.message);
    else store.set({ loadError: status.error.message });
    return;
  }
  store.set({
    groups: data.data.groups,
    initialized: status.data.initialized,
    authed: status.data.authenticated,
    fetchIcons: (data.data.settings as Record<string, unknown>)['ui.fetch_icons'] === true,
    editing: status.data.authenticated ? store.get().editing : false,
    loadError: null,
  });
  if (!status.data.initialized && currentRoute() === '#/') go('#/setup');
  if (status.data.authenticated) {
    void loadIgnores();
    startLive();
  } else {
    stopLive();
    store.set({ ignores: [] });
  }
}

async function loadIgnores(): Promise<void> {
  const result = await api.listIgnores();
  if (result.ok) store.set({ ignores: result.data.ignores });
}

/** 变化风暴合并：500ms 内多次事件只刷一次 */
function queueLiveRefresh(): void {
  if (liveRefreshQueued) return;
  liveRefreshQueued = true;
  setTimeout(() => {
    liveRefreshQueued = false;
    // S12: SSE 触发的刷新失败时静默降级，不覆盖用户当前视图
    void refresh({ silent: true });
  }, 500);
}

function startLive(): void {
  if (live) return;
  live = connectLive(queueLiveRefresh, () => {});
}

function stopLive(): void {
  live?.close();
  live = null;
}

function renderHeader(): HTMLElement {
  const header = el('header', {
    class: 'sticky top-0 z-30 border-b border-[var(--c-line)] bg-[var(--c-bg)]',
  });
  const inner = el('div', { class: 'mx-auto flex w-full max-w-[1500px] items-center gap-2 px-4 py-2 sm:px-6' });
  const brand = el('a', { href: '#/', class: 'flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.22em] text-fg' });
  brand.append(
    el('span', { class: 'flex h-6 w-6 items-center justify-center bg-accent text-[color:var(--c-accent-ink)]' }, brandLogo(14)),
    el('span', { text: 'SuenWeb' }),
  );
  inner.appendChild(brand);
  header.appendChild(inner);
  return header;
}

function capsuleItems(state: AppState): CapsuleItem[] {
  if (!state.authed) {
    return [
      { key: 'login', label: '登录', iconName: 'login', showLabel: true, onClick: () => go('#/login') },
    ];
  }
  return [
    {
      key: 'edit',
      label: state.editing ? '编辑模式已开：点按回到只读' : '只读：点按进入编辑模式',
      iconName: state.editing ? 'lock-open' : 'lock',
      active: state.editing,
      onClick: () => {
        const next = !store.get().editing;
        store.set({ editing: next });
        toast(next ? '编辑模式已开启：可拖动、可编辑' : '已锁定：只读模式');
      },
    },
    { key: 'settings', label: '设置', iconName: 'settings', onClick: () => go('#/settings') },
    {
      key: 'logout',
      label: '登出',
      iconName: 'logout',
      onClick: async () => {
        await api.logout();
        store.set({ editing: false });
        await refresh();
        go('#/');
      },
    },
  ];
}

async function submitAuth(password: string): Promise<void> {
  const state = store.get();
  if (password.length < 6) {
    store.set({ authError: '密码至少 6 位' });
    return;
  }
  // busy 只反映在 auth 按钮的本地 disabled 上，不写 store（见 auth.ts），避免全量重绘清空密码输入
  try {
    const result = state.initialized ? await api.login(password) : await api.setup(password);
    if (!result.ok) {
      store.set({ authError: result.error.message });
      return;
    }
    await refresh();
    toast(state.initialized ? '登录成功' : '管理密码已设置', 'success');
    go('#/');
  } catch {
    // 网络异常等：静默，按钮由 auth.ts 恢复
  }
}

async function afterMutation(result: { ok: boolean; error?: { message: string } }, successText: string): Promise<void> {
  if (!result.ok) {
    toast(result.error ? result.error.message : '操作失败', 'error');
    return;
  }
  toast(successText, 'success');
  await refresh();
}

function openCreateLink(groupId?: number): void {
  const state = store.get();
  openLinkDrawer({
    mode: 'create',
    groups: state.groups,
    defaultGroupId: groupId,
    submit: (draft: LinkDraft, policy) =>
      api.createLink({
        group_id: draft.group_id,
        url: draft.url,
        title: draft.title || undefined,
        icon: draft.icon,
        icon_type: draft.icon ? 'url' : undefined,
        on_duplicate: policy,
      }),
    onDone: refresh,
  });
}

function openEditLink(link: Link): void {
  const state = store.get();
  openLinkDrawer({
    mode: 'edit',
    groups: state.groups,
    link,
    submit: (draft: LinkDraft) =>
      api.updateLink(link.id, {
        title: draft.title || undefined,
        url: draft.url,
        description: draft.description,
        icon: draft.icon ?? null,
        icon_type: draft.icon ? 'url' : 'auto',
      }),
    remove: () => api.deleteLink(link.id),
    onDone: refresh,
  });
}

function render(): void {
  const state = store.get();
  const app = document.getElementById('app');
  if (!app) return;
  const isAuth = state.route === '#/login' || state.route === '#/setup';
  clear(app);
  app.className = isAuth ? 'relative min-h-screen bg-[var(--c-bg)]' : 'app-shell relative bg-[var(--c-bg)]';
  setTier(state.route === '#/' ? 'half' : 'full');

  if (isAuth) {
    unmountCapsule();
    app.appendChild(
      renderAuth({
        mode: state.route === '#/setup' ? 'setup' : 'login',
        error: state.authError,
        onSubmit: (password) => void submitAuth(password),
        onHome: () => go('#/'),
      }),
    );
    return;
  }

  app.appendChild(renderHeader());
  const scroll = el('div', { class: 'app-scroll' });
  app.appendChild(scroll);

  if (state.loadError) {
    const box = el('div', { class: 'relative z-10 mx-auto mt-10 w-full max-w-2xl px-4' });
    box.appendChild(
      el('div', { class: 'rounded-[26px] border-8 border-dotted border-quaternary p-8 text-center' },
        el('h2', { class: 'text-3xl text-fg', text: '服务端连不上' }),
        el('p', { class: 'mt-2 text-fg/70', text: state.loadError }),
        el('p', { class: 'mt-2 text-sm text-fg/50', text: '开发期请在仓库根目录执行 npm run dev 启动后端，前端用 npm run web。' }),
        el('div', { class: 'mt-5 flex justify-center' }, button({ label: '重试', iconName: 'refresh', onClick: () => void refresh() })),
      ),
    );
    scroll.appendChild(box);
    mountCapsule(capsuleItems(state));
    return;
  }

  if (state.route === '#/settings') {
    scroll.appendChild(
      renderSettings({
        tab: state.settingsTab,
        authed: state.authed,
        initialized: state.initialized,
        themeMode: getThemeMode(),
        engineId: getEngineId(),
        fetchIcons: state.fetchIcons,
        ignores: state.ignores,
        version: VERSION,
        onTab: (tab) => {
          window.location.hash = tab === 'data' ? '#/settings/data' : '#/settings/general';
          store.set({ settingsTab: tab });
        },
        onTheme: (mode) => {
          setThemeMode(mode);
          render();
        },
        onEngine: (id) => {
          setEngineId(id);
          render();
        },
        onFetchIcons: async (value) => {
          if (!store.get().authed) {
            toast('登录后才能修改图标抓取', 'error');
            return;
          }
          await afterMutation(await api.updateSettings({ 'ui.fetch_icons': value }), value ? '已开启站点图标' : '已关闭站点图标');
        },
        onChangePassword: async (currentPassword, next) => {
          if (next.length < 6) {
            toast('新密码至少 6 位', 'error');
            return false;
          }
          const result = await api.changePassword(currentPassword, next);
          if (!result.ok) {
            toast(result.error.message, 'error');
            return false;
          }
          toast('密码已更新，其他设备已下线', 'success');
          await refresh();
          return true;
        },
        onUndoIgnore: async (urlNormalized, groupId) => {
          await afterMutation(await api.forgetIgnore(urlNormalized, groupId), '已撤销，之后会重新提示');
        },
        onLogin: () => go('#/login'),
        onLogout: async () => {
          await api.logout();
          store.set({ editing: false });
          await refresh();
          go('#/');
        },
        onHome: () => go('#/'),
        onDataChanged: () => void refresh(),
      }),
    );
    mountCapsule(capsuleItems(state));
    return;
  }

  scroll.appendChild(
    renderBookmarks({
      groups: state.groups,
      authed: state.authed,
      editing: state.editing,
      fetchIcons: state.fetchIcons,
      activeTabId: state.tabGroupId,
      onTab: (id) => store.set({ tabGroupId: id }),
      onAddLink: (groupId) => openCreateLink(groupId),
      onEditLink: (link) => openEditLink(link),
      onDeleteLink: (link) => {
        openConfirmDialog({
          title: '删除这条书签',
          message: link.title,
          onConfirm: async () => {
            await afterMutation(await api.deleteLink(link.id), '已删除');
          },
        });
      },
      onMoveLink: async (link, direction) => {
        const group = store.get().groups.find((item) => item.id === link.group_id);
        if (!group) return;
        const ids = group.links.map((item) => item.id);
        const from = ids.indexOf(link.id);
        const to = from + direction;
        if (from < 0 || to < 0 || to >= ids.length) return;
        ids.splice(from, 1);
        ids.splice(to, 0, link.id);
        await afterMutation(await api.reorderLinks(group.id, ids), '已移动');
      },
      onReorder: async (groupId, ids) => {
        await afterMutation(await api.reorderLinks(groupId, ids), '已调整顺序');
      },
      onAddGroup: () => {
        openGroupDialog({
          mode: 'create',
          onSubmit: (name) => api.createGroup(name),
          onDone: refresh,
        });
      },
      onEditGroup: (group) => {
        openGroupDialog({
          mode: 'rename',
          group,
          onSubmit: (name) => api.renameGroup(group.id, name),
          onDone: refresh,
        });
      },
      onDeleteGroup: (group) => {
        openConfirmDialog({
          title: '删除分组「' + group.name + '」',
          message: '分组内 ' + group.links.length + ' 条书签会一起删除',
          onConfirm: async () => {
            await afterMutation(await api.deleteGroup(group.id), '分组已删除');
          },
        });
      },
      onTogglePin: async (group: GroupWithLinks) => {
        const nextType: 'fixed' | 'tab' = group.type === 'fixed' ? 'tab' : 'fixed';
        const patch: { type: 'fixed' | 'tab'; display_mode?: DisplayMode } = { type: nextType };
        if (nextType === 'fixed' && group.display_mode === 'icon') patch.display_mode = 'grid';
        if (nextType === 'tab' && (group.display_mode === 'grid' || group.display_mode === 'list')) patch.display_mode = 'icon';
        await afterMutation(await api.updateGroup(group.id, patch), nextType === 'fixed' ? '已置顶' : '已取消置顶');
      },
      onDisplayMode: async (group: GroupWithLinks, mode: DisplayMode) => {
        await afterMutation(await api.updateGroup(group.id, { display_mode: mode }), '显示模式已切换');
      },
      onLayoutMode: async (group: GroupWithLinks, mode: 'single' | 'multi') => {
        await afterMutation(
          await api.updateGroup(group.id, { layout_mode: mode }),
          mode === 'single' ? '已改为独占整行' : '已改为并排分栏',
        );
      },
      onLogin: () => go('#/login'),
    }),
  );
  mountCapsule(capsuleItems(state));
}

export function boot(): void {
  applyTheme();
  setTier(currentRoute() === '#/' ? 'half' : 'full');
  watchSystemTheme(() => {
    if (getThemeMode() === 'system') render();
  });
  store.subscribe(() => render());
  window.addEventListener('hashchange', () => {
    store.set({
      route: currentRoute(),
      authError: null,
      settingsTab: (window.location.hash.startsWith('#/settings/data') ? 'data' : 'general') as SettingsTab,
    });
  });
  store.set({
    route: currentRoute(),
    settingsTab: (window.location.hash.startsWith('#/settings/data') ? 'data' : 'general') as SettingsTab,
  });
  void refresh();
}
