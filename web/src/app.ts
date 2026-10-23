import { api, type GroupWithLinks, type Link } from './lib/api.ts';
import { clear, el } from './lib/dom.ts';
import { createStore } from './lib/store.ts';
import {
  applyTheme,
  getThemeMode,
  isCalm,
  setCalm,
  setThemeMode,
  setTier,
  watchSystemTheme,
  type ThemeMode,
} from './lib/theme.ts';
import { renderAuth } from './pages/auth.ts';
import { renderBookmarks } from './pages/bookmarks.ts';
import { openConfirmDialog, openGroupDialog, openLinkDrawer, type LinkDraft } from './pages/dialogs.ts';
import { renderSettings, type IgnoreRow } from './pages/settings.ts';
import { button } from './ui/button.ts';
import { brandLogo } from './ui/logo.ts';
import { toast } from './ui/toast.ts';

const VERSION = '2.0.0-m2';

type Route = '#/' | '#/login' | '#/setup' | '#/settings';

type AppState = {
  route: Route;
  initialized: boolean;
  authed: boolean;
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

function renderHeader(state: AppState): HTMLElement {
  const header = el('header', {
    class: 'sticky top-0 z-30 border-b-8 border-accent',
    style: 'background:color-mix(in srgb, var(--c-bg) 84%, transparent);backdrop-filter:blur(10px);',
  });
  const inner = el('div', { class: 'mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-3 px-4 py-3 sm:px-8' });

  const brand = el('a', { href: '#/', class: 'flex items-center gap-2 font-display text-base tracking-[0.2em] text-fg' });
  brand.append(
    el('span', { class: 'flex h-9 w-9 items-center justify-center rounded-xl border-4 border-tertiary bg-riot text-ink' }, brandLogo(20)),
    el('span', { class: 'text-gradient anim-gradient', text: 'SUENWEB' }),
  );

  const actions = el('div', { class: 'ml-auto flex flex-wrap items-center gap-2' });

  const theme = getThemeMode();
  actions.appendChild(
    button({
      variant: 'icon',
      iconName: theme === 'light' ? 'sun' : theme === 'dark' ? 'moon' : 'monitor',
      title: '主题：' + (theme === 'system' ? '跟随系统' : theme === 'light' ? '浅色' : '深色'),
      onClick: () => {
        const next: ThemeMode = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
        setThemeMode(next);
        toast('主题：' + (next === 'system' ? '跟随系统' : next === 'light' ? '浅色' : '深色'));
        render();
      },
    }),
  );

  actions.appendChild(
    button({
      variant: 'icon',
      iconName: 'calm',
      title: isCalm() ? '降噪模式：开' : '降噪模式：关',
      onClick: () => {
        setCalm(!isCalm());
        toast(isCalm() ? '已开启降噪模式' : '已关闭降噪模式');
        render();
      },
    }),
  );

  actions.appendChild(
    button({
      variant: 'icon',
      iconName: state.view === 'grid' ? 'list' : 'grid',
      title: state.view === 'grid' ? '切换列表视图' : '切换网格视图',
      onClick: () => {
        store.set({ view: state.view === 'grid' ? 'list' : 'grid' });
      },
    }),
  );

  actions.appendChild(
    button({ variant: 'icon', iconName: 'settings', title: '设置', onClick: () => go('#/settings') }),
  );

  if (state.authed) {
    actions.appendChild(
      button({
        label: '退出',
        iconName: 'logout',
        variant: 'secondary',
        size: 'sm',
        onClick: async () => {
          const result = await api.logout();
          if (!result.ok) toast(result.error.message, 'error');
          await refresh();
        },
      }),
    );
  } else {
    actions.appendChild(
      button({ label: '登录', iconName: 'login', variant: 'primary', size: 'sm', onClick: () => go('#/login') }),
    );
  }

  inner.append(brand, actions);
  header.appendChild(inner);
  return header;
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
  clear(app);
  app.className = 'pattern-global relative min-h-screen';
  setTier(state.route === '#/' ? 'half' : 'full');

  if (state.route === '#/login' || state.route === '#/setup') {
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

  app.appendChild(renderHeader(state));

  if (state.loadError) {
    const box = el('div', { class: 'relative z-10 mx-auto mt-10 w-full max-w-2xl px-4' });
    box.appendChild(
      el('div', { class: 'rounded-[26px] border-8 border-dotted border-quaternary p-8 text-center' },
        el('h2', { class: 'text-3xl text-fg', text: '服务端连不上' }),
        el('p', { class: 'mt-2 text-fg/70', text: state.loadError }),
        el('p', { class: 'mt-2 text-sm text-fg/50', text: '开发期请在仓库根目录执行 npm run dev 启动后端（默认 8080），前端用 npm --prefix web run dev（5173，已代理 /api）。' }),
        el('div', { class: 'mt-5 flex justify-center' }, button({ label: '重试', iconName: 'refresh', onClick: () => void refresh() })),
      ),
    );
    app.appendChild(box);
    return;
  }

  if (state.route === '#/settings') {
    app.appendChild(
      renderSettings({
        authed: state.authed,
        initialized: state.initialized,
        themeMode: getThemeMode(),
        calm: isCalm(),
        view: state.view,
        ignores: state.ignores,
        version: VERSION,
        onTheme: (mode) => {
          setThemeMode(mode);
          render();
        },
        onCalm: (value) => {
          setCalm(value);
          render();
        },
        onView: (view) => store.set({ view }),
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
          await refresh();
          go('#/');
        },
        onHome: () => go('#/'),
      }),
    );
    return;
  }

  app.appendChild(
    renderBookmarks({
      groups: state.groups,
      authed: state.authed,
      view: state.view,
      query: state.query,
      activeGroupId: state.activeGroupId,
      onQuery: (query) => {
        store.set({ query });
        render();
        const input = document.querySelector<HTMLInputElement>('input[type="search"]');
        if (input) {
          input.value = query;
          input.focus();
        }
      },
      onActiveGroup: (id) => store.set({ activeGroupId: id }),
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
      onLogin: () => go('#/login'),
    }),
  );
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
