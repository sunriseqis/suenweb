import type { GroupWithLinks, Link } from '../lib/api.ts';
import { cn } from '../lib/cn.ts';
import { append, el } from '../lib/dom.ts';
import { button } from '../ui/button.ts';
import { field } from '../ui/field.ts';
import { icon } from '../ui/icons.ts';
import { accentAt, card } from '../ui/surfaces.ts';

export type DisplayMode = 'grid' | 'list' | 'icon';

export type BookmarksProps = {
  groups: GroupWithLinks[];
  authed: boolean;
  editing: boolean;
  view: 'grid' | 'list';
  query: string;
  activeGroupId: number | null;
  onQuery: (value: string) => void;
  onActiveGroup: (id: number | null) => void;
  onAddLink: (groupId?: number) => void;
  onEditLink: (link: Link) => void;
  onDeleteLink: (link: Link) => void;
  onMoveLink: (link: Link, direction: -1 | 1) => void;
  onReorder: (groupId: number, ids: number[]) => void;
  onAddGroup: () => void;
  onEditGroup: (group: GroupWithLinks) => void;
  onDeleteGroup: (group: GroupWithLinks) => void;
  onTogglePin: (group: GroupWithLinks) => void;
  onDisplayMode: (group: GroupWithLinks, mode: DisplayMode) => void;
  onLogin: () => void;
};

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function matches(link: Link, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    link.title.toLowerCase().includes(q) ||
    link.url.toLowerCase().includes(q) ||
    (link.description ?? '').toLowerCase().includes(q)
  );
}

function modeOf(group: GroupWithLinks): DisplayMode {
  const mode = group.display_mode;
  if (mode === 'grid' || mode === 'list' || mode === 'icon') return mode;
  return group.type === 'fixed' ? 'grid' : 'icon';
}

/** 色彩预算：一页只有一个主色（按组轮转），卡片本身保持中性，颜色只出现在小圆点、组标题与 hover 上 */
export function renderBookmarks(props: BookmarksProps): HTMLElement {
  const editable = props.authed && props.editing;
  const root = el('div', { class: 'relative z-10 mx-auto w-full max-w-[1600px] px-3 pb-28 pt-3 sm:px-5' });

  const pinned = props.groups.filter((group) => group.type === 'fixed');
  const normal = props.groups.filter((group) => group.type !== 'fixed');
  const totalLinks = props.groups.reduce((sum, group) => sum + group.links.length, 0);

  const bar = el('div', { class: 'mb-3 flex flex-wrap items-center gap-2' });
  append(bar, [
    el('span', { class: 'text-[11px] font-bold text-fg/50', text: props.groups.length + ' 组 · ' + totalLinks + ' 条' }),
    editable
      ? button({ label: '收藏一条', iconName: 'plus', variant: 'secondary', size: 'xs', onClick: () => props.onAddLink(props.activeGroupId ?? undefined) })
      : null,
    editable
      ? button({ label: '新建分组', iconName: 'folder', variant: 'ghost', size: 'xs', onClick: props.onAddGroup })
      : null,
  ]);

  const search = field({
    label: '搜索',
    type: 'search',
    value: props.query,
    placeholder: '标题 / 网址 / 备注',
    index: 2,
    compact: true,
  });
  search.input.addEventListener('input', (event) => {
    props.onQuery((event.target as HTMLInputElement).value);
  });
  bar.appendChild(el('div', { class: 'ml-auto w-full max-w-[15rem]' }, search.wrapper));
  root.appendChild(bar);

  const nav = el('nav', {
    class: 'mb-3 flex items-center gap-1 overflow-x-auto pb-1',
    'aria-label': '分组导航',
  });
  nav.appendChild(navPill('全部', totalLinks, props.activeGroupId === null, 0, () => props.onActiveGroup(null)));
  props.groups.forEach((group, index) => {
    nav.appendChild(
      navPill(group.name, group.links.length, props.activeGroupId === group.id, index + 1, () =>
        props.onActiveGroup(props.activeGroupId === group.id ? null : group.id),
      ),
    );
  });
  root.appendChild(nav);

  if (editable) {
    const hint = el('div', { class: 'mb-3 flex flex-wrap items-center gap-2 text-[11px] text-fg/50' });
    hint.append(
      icon('lock-open', { size: 13 }),
      el('span', { text: '编辑模式：可拖动、可修改。组标题右侧可切换置顶与显示密度。' }),
    );
    root.appendChild(hint);
  }

  const showPinned = pinned.filter((group) => props.activeGroupId === null || group.id === props.activeGroupId);
  if (showPinned.length > 0) {
    const area = el('div', { class: 'mb-4 grid gap-3 xl:grid-cols-2', 'aria-label': '置顶组' });
    showPinned.forEach((group, index) => {
      area.appendChild(renderSection(group, index, props, true));
    });
    root.appendChild(area);
  }

  const showNormal = normal.filter((group) => props.activeGroupId === null || group.id === props.activeGroupId);
  if (showNormal.length > 0) {
    const area = el('div', { class: 'space-y-2', 'aria-label': '普通组' });
    showNormal.forEach((group, index) => {
      area.appendChild(renderSection(group, index + pinned.length, props, false));
    });
    root.appendChild(area);
  }

  if (props.groups.length === 0) {
    const empty = el('div', { class: 'rounded-[16px] border-2 border-dashed border-fg/15 p-8 text-center' });
    empty.append(
      el('h2', { class: 'text-lg text-fg', text: props.query ? '没搜到' : '还没有书签' }),
      el('p', { class: 'mx-auto mt-1 max-w-md text-xs text-fg/60', text: props.query ? '换个词试试。' : '点右下角胶囊的锁头进入编辑模式即可添加。' }),
    );
    root.appendChild(empty);
  }

  return root;
}

function navPill(label: string, count: number, active: boolean, index: number, onClick: () => void): HTMLElement {
  const accent = accentAt(index);
  const node = el('button', {
    class: cn(
      'pressable inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 font-heading text-[11px] font-bold transition-colors duration-200',
      active ? 'border-transparent bg-accent text-ink' : 'border-fg/15 text-fg/60 hover:border-fg/30 hover:text-fg',
    ),
    'aria-pressed': active ? 'true' : 'false',
    onClick,
  });
  node.append(
    el('span', { text: label }),
    el('span', { class: cn('text-[10px]', active ? 'text-ink/60' : 'text-fg/35'), text: String(count) }),
  );
  if (!active) node.title = label + ' · ' + accent.key;
  return node;
}

function renderSection(group: GroupWithLinks, index: number, props: BookmarksProps, pinned: boolean): HTMLElement {
  const editable = props.authed && props.editing;
  const accent = accentAt(index);
  const mode = modeOf(group);
  const links = props.query ? group.links.filter((link) => matches(link, props.query)) : group.links;

  const section = el('section', {
    class: cn(
      'rounded-[14px]',
      pinned ? 'border-2 border-fg/15 bg-[var(--c-surface)]/40 p-3' : 'border border-fg/10 px-2 py-1.5',
    ),
    'aria-label': group.name,
  });

  const header = el('div', { class: 'mb-1.5 flex flex-wrap items-center gap-2' });
  append(header, [
    el('span', { class: 'h-2 w-2 shrink-0 rounded-full', style: 'background:' + accent.cssVar, 'aria-hidden': 'true' }),
    el('h2', { class: 'text-[13px] font-black text-fg', text: group.name }),
    el('span', { class: 'text-[10px] text-fg/35', text: String(links.length) }),
    pinned ? el('span', { class: 'rounded-full border border-fg/20 px-1.5 text-[9px] font-black uppercase tracking-widest text-fg/45', text: '置顶' }) : null,
  ]);

  if (editable) {
    const tools = el('div', { class: 'ml-auto flex flex-wrap items-center gap-1' });
    tools.append(
      tinyAction(pinned ? '取消置顶' : '设为置顶', pinned ? 'arrow-down' : 'arrow-up', () => props.onTogglePin(group)),
      tinyAction('详情卡模式', 'grid', () => props.onDisplayMode(group, 'grid'), mode === 'grid'),
      tinyAction('紧凑行模式', 'list', () => props.onDisplayMode(group, 'list'), mode === 'list'),
      tinyAction('极小图标模式', 'bookmark', () => props.onDisplayMode(group, 'icon'), mode === 'icon'),
      tinyAction('加一条', 'plus', () => props.onAddLink(group.id)),
      tinyAction('改名', 'edit', () => props.onEditGroup(group)),
      tinyAction('删除组', 'trash', () => props.onDeleteGroup(group)),
    );
    header.appendChild(tools);
  }
  append(section, [header]);

  if (links.length === 0) {
    section.appendChild(el('p', { class: 'px-1 py-1 text-[11px] text-fg/35', text: '（空分组）' }));
    return section;
  }

  if (mode === 'grid') {
    const grid = el('div', { class: cn('grid gap-2', pinned ? 'grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4') });
    links.forEach((link) => grid.appendChild(renderGridCard(link, accent, props, links, editable)));
    if (editable) grid.appendChild(renderAddCard(group, props));
    section.appendChild(grid);
  } else if (mode === 'list') {
    const grid = el('div', { class: 'grid gap-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4' });
    links.forEach((link) => grid.appendChild(renderListRow(link, accent, props, links, editable)));
    if (editable) grid.appendChild(renderAddRow(group, props));
    section.appendChild(grid);
  } else {
    const wrap = el('div', { class: 'flex flex-wrap items-center gap-1' });
    links.forEach((link) => wrap.appendChild(renderChip(link, accent, props, links, editable)));
    if (editable) wrap.appendChild(renderChipAdd(group, props));
    section.appendChild(wrap);
  }

  return section;
}

function tinyAction(title: string, iconName: 'arrow-up' | 'arrow-down' | 'grid' | 'list' | 'bookmark' | 'plus' | 'edit' | 'trash', onClick: () => void, active = false): HTMLElement {
  const node = el('button', {
    type: 'button',
    class: cn(
      'pressable flex h-6 w-6 items-center justify-center rounded-md border transition-colors duration-200',
      active ? 'border-transparent bg-accent text-ink' : 'border-fg/15 text-fg/45 hover:border-fg/35 hover:text-fg',
    ),
    title,
    'aria-label': title,
    'aria-pressed': active ? 'true' : 'false',
    onClick,
  });
  node.append(icon(iconName, { size: 12 }));
  return node;
}

function dragify(node: HTMLElement, link: Link, siblings: Link[], props: BookmarksProps): void {
  node.draggable = true;
  node.addEventListener('dragstart', (event) => {
    event.dataTransfer?.setData('text/plain', String(link.id));
    node.classList.add('opacity-40');
  });
  node.addEventListener('dragend', () => node.classList.remove('opacity-40'));
  node.addEventListener('dragover', (event) => {
    event.preventDefault();
    node.classList.add('ring-2', 'ring-accent');
  });
  node.addEventListener('dragleave', () => node.classList.remove('ring-2', 'ring-accent'));
  node.addEventListener('drop', (event) => {
    event.preventDefault();
    node.classList.remove('ring-2', 'ring-accent');
    const fromId = Number(event.dataTransfer?.getData('text/plain'));
    if (!fromId || fromId === link.id) return;
    const ids = siblings.map((item) => item.id).filter((id) => id !== fromId);
    const targetIndex = ids.indexOf(link.id);
    ids.splice(targetIndex, 0, fromId);
    props.onReorder(link.group_id, ids);
  });
}

function renderGridCard(link: Link, accent: { cssVar: string }, props: BookmarksProps, siblings: Link[], editable: boolean): HTMLElement {
  const wrap = card({ quiet: true, class: 'group relative' });
  const initial = (link.title || hostOf(link.url)).slice(0, 1).toUpperCase();
  const head = el('div', { class: 'flex items-start gap-2' });
  head.append(
    el('span', { class: 'mt-1 h-1.5 w-1.5 shrink-0 rounded-full', style: 'background:' + accent.cssVar, 'aria-hidden': 'true' }),
    el('div', { class: 'min-w-0 flex-1' },
      el('a', { href: link.url, target: '_blank', rel: 'noopener noreferrer', class: 'block truncate text-[13px] font-bold leading-tight text-fg hover:text-accent', text: link.title, title: link.title }),
      el('p', { class: 'truncate text-[10px] text-fg/40', text: hostOf(link.url) }),
    ),
    el('span', { class: 'sr-only', text: initial }),
  );
  wrap.appendChild(head);
  if (link.description) {
    wrap.appendChild(el('p', { class: 'mt-1 line-clamp-2 text-[11px] leading-snug text-fg/55', text: link.description }));
  }
  if (editable) {
    const tools = el('div', { class: 'mt-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100' });
    tools.append(
      tinyAction('编辑', 'edit', () => props.onEditLink(link)),
      tinyAction('删除', 'trash', () => props.onDeleteLink(link)),
      tinyAction('上移', 'arrow-up', () => props.onMoveLink(link, -1)),
      tinyAction('下移', 'arrow-down', () => props.onMoveLink(link, 1)),
    );
    wrap.appendChild(tools);
    dragify(wrap, link, siblings, props);
  }
  return wrap;
}

function renderListRow(link: Link, accent: { cssVar: string }, props: BookmarksProps, siblings: Link[], editable: boolean): HTMLElement {
  const row = el('div', {
    class: 'group flex h-7 items-center gap-1.5 rounded-md border border-fg/10 bg-[var(--c-panel)] pl-2 pr-1 transition-colors hover:border-accent/50',
  });
  row.appendChild(
    el('a', { href: link.url, target: '_blank', rel: 'noopener noreferrer', class: 'flex min-w-0 flex-1 items-center gap-1.5', title: link.url },
      el('span', { class: 'h-1.5 w-1.5 shrink-0 rounded-full', style: 'background:' + accent.cssVar }),
      el('span', { class: 'truncate text-[11px] text-fg', text: link.title }),
      el('span', { class: 'shrink-0 truncate text-[9px] text-fg/30', text: hostOf(link.url) }),
    ),
  );
  if (editable) {
    const tools = el('div', { class: 'flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100' });
    tools.append(
      tinyAction('编辑', 'edit', () => props.onEditLink(link)),
      tinyAction('删除', 'trash', () => props.onDeleteLink(link)),
    );
    row.appendChild(tools);
    dragify(row, link, siblings, props);
  }
  return row;
}

function renderChip(link: Link, accent: { cssVar: string }, props: BookmarksProps, siblings: Link[], editable: boolean): HTMLElement {
  const wrap = el('div', {
    class: 'group flex h-6 items-center gap-1 rounded-md border border-fg/10 bg-[var(--c-panel)] pl-1.5 pr-1 transition-colors hover:border-accent/50 hover:bg-[var(--c-surface)]',
  });
  wrap.appendChild(
    el('a', { href: link.url, target: '_blank', rel: 'noopener noreferrer', class: 'flex min-w-0 items-center gap-1.5', title: link.title + ' · ' + link.url },
      el('span', { class: 'h-1.5 w-1.5 shrink-0 rounded-full', style: 'background:' + accent.cssVar }),
      el('span', { class: 'max-w-[8.5rem] truncate text-[11px] text-fg/85', text: link.title }),
    ),
  );
  if (editable) {
    wrap.append(
      tinyAction('编辑', 'edit', () => props.onEditLink(link)),
      tinyAction('删除', 'trash', () => props.onDeleteLink(link)),
    );
    dragify(wrap, link, siblings, props);
  }
  return wrap;
}

function renderAddCard(group: GroupWithLinks, props: BookmarksProps): HTMLElement {
  const node = el('button', {
    class: 'pressable flex min-h-[52px] items-center justify-center gap-1 rounded-[10px] border border-dashed border-fg/20 text-[10px] font-bold uppercase tracking-widest text-fg/40 transition-colors hover:border-accent/60 hover:text-fg',
    onClick: () => props.onAddLink(group.id),
  });
  append(node, [icon('plus', { size: 12 }), el('span', { text: '加一条' })]);
  return node;
}

function renderAddRow(group: GroupWithLinks, props: BookmarksProps): HTMLElement {
  const node = el('button', {
    class: 'pressable flex h-7 items-center justify-center gap-1 rounded-md border border-dashed border-fg/20 text-[10px] font-bold text-fg/40 transition-colors hover:border-accent/60 hover:text-fg',
    onClick: () => props.onAddLink(group.id),
  });
  append(node, [icon('plus', { size: 11 }), el('span', { text: '加一条' })]);
  return node;
}

function renderChipAdd(group: GroupWithLinks, props: BookmarksProps): HTMLElement {
  const node = el('button', {
    class: 'pressable flex h-6 items-center gap-1 rounded-md border border-dashed border-fg/20 px-2 text-[10px] font-bold text-fg/40 transition-colors hover:border-accent/60 hover:text-fg',
    onClick: () => props.onAddLink(group.id),
  });
  append(node, [icon('plus', { size: 10 }), el('span', { text: '加一条' })]);
  return node;
}
