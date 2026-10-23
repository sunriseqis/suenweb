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
import { renderSettings, type IgnoreRow } from './pages/settings.ts';
import { button } from './ui/button.ts';
import { mountCapsule, unmountCapsule, type CapsuleItem } from './ui/capsule.ts';
import { brandLogo } from './ui/logo.ts';
import { toast } from './ui/toast.ts';

const VERSION = '2.0.0-m2';

type Route = '#/' | '#/login' | '#/setup' | '#/settings';

type AppState = {
  route: Route;
  initialized: boolean;
  authed: boolean;
  editing: boolean;
  tabGroupId: number | null;
  groups: GroupWithLinks[];
  query: string;
  activeGroupId: number | null;
  view: 'grid' | 'list';
  busy: boolean;
  authError: string | null;
  ignores: IgnoreRow[];
  loadError: string | null;
};

const store = createStore<AppState>({
  route: '#/',
  initialized: true,
  authed: false,
  editing: false,
  tabGroupId: null,
  groups: [],
  query: '',
  activeGroupId: null,
  view: 'grid',
  busy: false,
  authError: null,
  ignores: [],
  loadError: null,
});

function currentRoute(): Route {
  const hash = window.location.hash || '#/';
  if (hash === '#/login' || hash === '#/setup' || hash === '#/settings') return hash;
  return '#/';
}

function go(route: Route): void {
  if (window.location.hash === route) {
    render();
    return;
  }
  window.location.hash = route;
}

async function refresh(): Promise<void> {
  const [data, status] = await Promise.all([api.data(), api.authStatus()]);
  if (!data.ok) {
    store.set({ loadError: data.error.message });
    return;
  }
  if (!status.ok) {
    store.set({ loadError: status.error.message });
    return;
  }
  store.set({
    groups: data.data.groups,
    initialized: status.data.initialized,
    authed: status.data.authenticated,
    editing: status.data.authenticated ? store.get().editing : false,
    loadError: null,
  });
  if (!status.data.initialized && currentRoute() === '#/') go('#/setup');
  if (status.data.authenticated) void loadIgnores();
  else store.set({ ignores: [] });
}

async function loadIgnores(): Promise<void> {
  const result = await api.listIgnores();
  if (result.ok) store.set({ ignores: result.data.ignores });
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
  store.set({ busy: true, authError: null });
  try {
    const result = state.initialized ? await api.login(password) : await api.setup(password);
    if (!result.ok) {
      store.set({ authError: result.error.message });
      return;
    }
    await refresh();
    toast(state.initialized ? '登录成功' : '管理密码已设置', 'success');
    go('#/');
  } finally {
    store.set({ busy: false });
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
        busy: state.busy,
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
        authed: state.authed,
        initialized: state.initialized,
        themeMode: getThemeMode(),
          ignores: state.ignores,
        version: VERSION,
        onTheme: (mode) => {
          setThemeMode(mode);
          render();
        },
        onChangePassword: async (currentPassword, next) => {
          if (next.length < 6) {
            toast('新密码至少 6 位', 'error');
            return;
          }
          await afterMutation(await api.changePassword(currentPassword, next), '密码已更新，其他设备已下线');
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
        await api.reorderLinks(group.id, ids);
        await refresh();
      },
      onReorder: async (groupId, ids) => {
        await api.reorderLinks(groupId, ids);
        await refresh();
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
    store.set({ route: currentRoute(), authError: null });
  });
  store.set({ route: currentRoute() });
  void refresh();
}
