import type { GroupWithLinks, Link } from '../lib/api.ts';
import { cn } from '../lib/cn.ts';
import { append, el } from '../lib/dom.ts';
import { button } from '../ui/button.ts';
import { field } from '../ui/field.ts';
import { icon } from '../ui/icons.ts';
import { accentAt, card, shadowVars } from '../ui/surfaces.ts';

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

export function renderBookmarks(props: BookmarksProps): HTMLElement {
  const editable = props.authed && props.editing;
  const root = el('div', { class: 'relative z-10 mx-auto w-full max-w-[1600px] px-3 pb-28 pt-3 sm:px-5' });

  const pinned = props.groups.filter((group) => group.type === 'fixed');
  const normal = props.groups.filter((group) => group.type !== 'fixed');
  const totalLinks = props.groups.reduce((sum, group) => sum + group.links.length, 0);

  const bar = el('div', { class: 'mb-3 flex flex-wrap items-center gap-2' });
  append(bar, [
    el('span', { class: 'rounded-full border-2 border-secondary px-2.5 py-0.5 text-[11px] font-black text-fg', text: props.groups.length + ' 组' }),
    el('span', { class: 'rounded-full border-2 border-quaternary px-2.5 py-0.5 text-[11px] font-black text-fg', text: totalLinks + ' 条' }),
    editable
      ? button({ label: '收藏一条', iconName: 'plus', variant: 'primary', size: 'xs', onClick: () => props.onAddLink(props.activeGroupId ?? undefined) })
      : null,
    editable
      ? button({ label: '新建分组', iconName: 'folder', variant: 'secondary', size: 'xs', onClick: props.onAddGroup })
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
  bar.appendChild(el('div', { class: 'ml-auto w-full max-w-[16rem]' }, search.wrapper));
  root.appendChild(bar);

  const nav = el('nav', {
    class: 'mb-4 flex items-center gap-1.5 overflow-x-auto pb-1',
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
    const hint = el('div', { class: 'mb-3 flex flex-wrap items-center gap-2 rounded-full border-2 border-dashed border-secondary px-3 py-1' });
    hint.append(
      icon('lock-open', { size: 14 }),
      el('span', { class: 'text-[11px] font-bold text-fg', text: '编辑模式：可拖动、可改。组标题右侧能切「置顶 / 显示密度」；点右下角锁头回只读。' }),
    );
    root.appendChild(hint);
  }

  const showPinned = pinned.filter((group) => props.activeGroupId === null || group.id === props.activeGroupId);
  if (showPinned.length > 0) {
    const area = el('div', { class: 'mb-5 grid gap-3 xl:grid-cols-2', 'aria-label': '置顶组' });
    showPinned.forEach((group, index) => {
      area.appendChild(renderSection(group, index, props, true));
    });
    root.appendChild(area);
  }

  const showNormal = normal.filter((group) => props.activeGroupId === null || group.id === props.activeGroupId);
  if (showNormal.length > 0) {
    const area = el('div', { class: 'space-y-2.5', 'aria-label': '普通组' });
    showNormal.forEach((group, index) => {
      area.appendChild(renderSection(group, index + pinned.length, props, false));
    });
    root.appendChild(area);
  }

  if (props.groups.length === 0) {
    const empty = el('div', { class: 'pattern-dots relative overflow-hidden rounded-[20px] border-4 border-dashed border-secondary p-8 text-center' });
    empty.append(
      el('h2', { class: 'text-xl text-fg ts-cn', text: props.query ? '没搜到' : '还没有书签' }),
      el('p', { class: 'mx-auto mt-1 max-w-md text-xs text-fg/70', text: props.query ? '换个词试试。' : '登录后点右下角胶囊的锁头进入编辑模式即可添加。' }),
    );
    root.appendChild(empty);
  }

  return root;
}

function navPill(label: string, count: number, active: boolean, index: number, onClick: () => void): HTMLElement {
  const accent = accentAt(index);
  const node = el('button', {
    class: cn(
      'pressable inline-flex shrink-0 items-center gap-1 rounded-full border-2 px-2.5 py-0.5 font-heading text-[11px] font-black tracking-wide transition-all duration-200',
      active
        ? 'border-tertiary bg-riot text-ink shadow-multi-sm'
        : cn(accent.border, 'panel text-fg hover:scale-105'),
    ),
    style: shadowVars(index),
    'aria-pressed': active ? 'true' : 'false',
    onClick,
  });
  node.append(
    el('span', { text: label }),
    el('span', { class: cn('rounded-full px-1 text-[10px]', active ? 'bg-ink/20' : accent.soft), text: String(count) }),
  );
  return node;
}

function renderSection(group: GroupWithLinks, index: number, props: BookmarksProps, pinned: boolean): HTMLElement {
  const editable = props.authed && props.editing;
  const accent = accentAt(index + 1);
  const mode = modeOf(group);
  const links = props.query ? group.links.filter((link) => matches(link, props.query)) : group.links;

  const section = el('section', {
    class: cn(pinned ? 'pattern-dots rounded-[20px] border-4 bg-[var(--c-surface)]/60 p-3' : 'rounded-[16px] border-2 px-2.5 py-2', accent.border),
    'aria-label': group.name,
  });

  const header = el('div', { class: 'mb-2 flex flex-wrap items-center gap-1.5' });
  header.append(
    el('span', { class: cn('font-display text-[10px] uppercase tracking-[0.25em]', accent.text), text: pinned ? 'PIN' : String(index + 1).padStart(2, '0') }),
    el('h2', { class: 'text-sm font-black text-fg ts-cn', text: group.name }),
    el('span', { class: 'text-[10px] text-fg/45', text: String(links.length) }),
  );

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
  section.appendChild(header);

  if (links.length === 0) {
    section.appendChild(el('p', { class: 'px-1 py-1 text-[11px] text-fg/45', text: '（空分组）' }));
    return section;
  }

  if (mode === 'grid') {
    const grid = el('div', { class: cn('grid gap-2.5', pinned ? 'grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4') });
    links.forEach((link, i) => grid.appendChild(renderGridCard(link, i + index, props, links, editable)));
    if (editable) grid.appendChild(renderAddCard(group, props));
    section.appendChild(grid);
  } else if (mode === 'list') {
    const grid = el('div', { class: 'grid gap-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4' });
    links.forEach((link, i) => grid.appendChild(renderListRow(link, i + index, props, links, editable)));
    if (editable) grid.appendChild(renderAddRow(group, props));
    section.appendChild(grid);
  } else {
    const wrap = el('div', { class: 'flex flex-wrap items-center gap-1.5' });
    links.forEach((link, i) => wrap.appendChild(renderChip(link, i + index, props, links, editable)));
    if (editable) wrap.appendChild(renderChipAdd(group, props));
    section.appendChild(wrap);
  }

  return section;
}

function tinyAction(title: string, iconName: 'arrow-up' | 'arrow-down' | 'grid' | 'list' | 'bookmark' | 'plus' | 'edit' | 'trash', onClick: () => void, active = false): HTMLElement {
  const node = el('button', {
    type: 'button',
    class: cn(
      'pressable flex h-6 w-6 items-center justify-center rounded-md border-2 transition-all duration-200',
      active ? 'border-tertiary bg-riot text-ink' : 'border-quaternary/70 text-fg/70 hover:border-accent hover:text-fg',
    ),
    title,
    'aria-label': title,
    'aria-pressed': active ? 'true' : 'false',
    onClick,
  });
  node.append(icon(iconName, { size: 13 }));
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
    node.classList.add('ring-2', 'ring-tertiary');
  });
  node.addEventListener('dragleave', () => node.classList.remove('ring-2', 'ring-tertiary'));
  node.addEventListener('drop', (event) => {
    event.preventDefault();
    node.classList.remove('ring-2', 'ring-tertiary');
    const fromId = Number(event.dataTransfer?.getData('text/plain'));
    if (!fromId || fromId === link.id) return;
    const ids = siblings.map((item) => item.id).filter((id) => id !== fromId);
    const targetIndex = ids.indexOf(link.id);
    ids.splice(targetIndex, 0, fromId);
    props.onReorder(link.group_id, ids);
  });
}

function renderGridCard(link: Link, index: number, props: BookmarksProps, siblings: Link[], editable: boolean): HTMLElement {
  const accent = accentAt(index);
  const wrap = card({ index, class: 'group relative overflow-hidden', padding: 'sm' });
  const initial = (link.title || hostOf(link.url)).slice(0, 1).toUpperCase();
  const head = el('div', { class: 'relative flex items-start gap-2' });
  head.append(
    el('span', {
      class: cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 font-heading text-[11px] font-black text-ink', accent.border, accent.bg),
      'aria-hidden': 'true',
      text: initial,
    }),
    el('div', { class: 'min-w-0 flex-1' },
      el('a', { href: link.url, target: '_blank', rel: 'noopener noreferrer', class: 'ts-cn block truncate font-heading text-sm font-black leading-tight text-fg hover:text-accent', text: link.title }),
      el('p', { class: 'truncate text-[10px] text-fg/50', text: hostOf(link.url) }),
    ),
  );
  wrap.appendChild(head);
  if (link.description) {
    wrap.appendChild(el('p', { class: 'relative mt-1.5 line-clamp-2 text-[11px] leading-snug text-fg/65', text: link.description }));
  }
  if (editable) {
    const tools = el('div', { class: 'relative mt-1.5 flex items-center gap-1' });
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

function renderListRow(link: Link, index: number, props: BookmarksProps, siblings: Link[], editable: boolean): HTMLElement {
  const accent = accentAt(index);
  const row = el('div', {
    class: 'group flex h-8 items-center gap-1.5 rounded-md border-2 bg-[var(--c-panel)] pl-1 pr-1 transition-colors hover:border-accent',
    style: 'border-color:' + accent.cssVar,
  });
  const initial = (link.title || hostOf(link.url)).slice(0, 1).toUpperCase();
  row.append(
    el('a', { href: link.url, target: '_blank', rel: 'noopener noreferrer', class: 'flex min-w-0 flex-1 items-center gap-1.5', title: link.url },
      el('span', { class: cn('flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 text-[9px] font-black text-ink', accent.border, accent.bg), text: initial }),
      el('span', { class: 'min-w-0 flex-1' },
        el('span', { class: 'block truncate text-[11px] font-bold leading-none text-fg', text: link.title }),
        el('span', { class: 'block truncate text-[9px] leading-none text-fg/45', text: hostOf(link.url) }),
      ),
    ),
  );
  if (editable) {
    const tools = el('div', { class: 'flex items-center gap-0.5' });
    tools.append(
      tinyAction('编辑', 'edit', () => props.onEditLink(link)),
      tinyAction('删除', 'trash', () => props.onDeleteLink(link)),
    );
    row.appendChild(tools);
    dragify(row, link, siblings, props);
  }
  return row;
}

function renderChip(link: Link, index: number, props: BookmarksProps, siblings: Link[], editable: boolean): HTMLElement {
  const accent = accentAt(index);
  const wrap = el('div', {
    class: 'group flex h-6 items-center gap-0.5 rounded-full border-2 bg-[var(--c-panel)] pl-0.5 pr-1 transition-all duration-200 hover:scale-[1.04]',
    style: 'border-color:' + accent.cssVar,
  });
  const initial = (link.title || hostOf(link.url)).slice(0, 1).toUpperCase();
  wrap.appendChild(
    el('a', { href: link.url, target: '_blank', rel: 'noopener noreferrer', class: 'flex min-w-0 items-center gap-1', title: link.title + ' · ' + link.url },
      el('span', { class: cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-black text-ink', accent.bg), text: initial }),
      el('span', { class: 'max-w-[8.5rem] truncate text-[11px] font-bold leading-none text-fg', text: link.title }),
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
    class: 'pressable flex min-h-[64px] items-center justify-center gap-1.5 rounded-[14px] border-2 border-dotted border-quaternary p-2 font-heading text-[10px] font-black uppercase tracking-widest text-fg/60 transition-all hover:border-solid hover:text-fg',
    onClick: () => props.onAddLink(group.id),
  });
  append(node, [icon('plus', { size: 14 }), el('span', { text: '加一条' })]);
  return node;
}

function renderAddRow(group: GroupWithLinks, props: BookmarksProps): HTMLElement {
  const node = el('button', {
    class: 'pressable flex h-8 items-center justify-center gap-1 rounded-md border-2 border-dotted border-quaternary text-[10px] font-black uppercase text-fg/60 hover:border-solid hover:text-fg',
    onClick: () => props.onAddLink(group.id),
  });
  append(node, [icon('plus', { size: 12 }), el('span', { text: '加一条' })]);
  return node;
}

function renderChipAdd(group: GroupWithLinks, props: BookmarksProps): HTMLElement {
  const node = el('button', {
    class: 'pressable flex h-6 items-center gap-1 rounded-full border-2 border-dotted border-quaternary px-2 text-[10px] font-black uppercase text-fg/60 hover:border-solid hover:text-fg',
    onClick: () => props.onAddLink(group.id),
  });
  append(node, [icon('plus', { size: 11 }), el('span', { text: '加一条' })]);
  return node;
}
