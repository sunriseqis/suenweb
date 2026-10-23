import type { GroupWithLinks, Link } from '../lib/api.ts';
import { cn } from '../lib/cn.ts';
import { append, el } from '../lib/dom.ts';
import { button } from '../ui/button.ts';
import { field } from '../ui/field.ts';
import { icon } from '../ui/icons.ts';
import { tile } from '../ui/surfaces.ts';

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
  const root = el('div', { class: 'relative z-10 mx-auto w-full max-w-[1500px] px-4 pb-24 pt-4 sm:px-6' });

  const pinned = props.groups.filter((group) => group.type === 'fixed');
  const normal = props.groups.filter((group) => group.type !== 'fixed');
  const totalLinks = props.groups.reduce((sum, group) => sum + group.links.length, 0);

  const bar = el('div', { class: 'mb-3 flex flex-wrap items-end gap-2 border-b border-[var(--c-line)] pb-3' });
  append(bar, [
    el('div', { class: 'mr-2' },
      el('h1', { class: 'text-[22px] font-light leading-none text-fg', text: '书签' }),
      el('p', { class: 'mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--c-fg-soft)]', text: props.groups.length + ' groups / ' + totalLinks + ' links' }),
    ),
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
    compact: true,
  });
  search.input.addEventListener('input', (event) => {
    props.onQuery((event.target as HTMLInputElement).value);
  });
  bar.appendChild(el('div', { class: 'ml-auto w-full max-w-[14rem]' }, search.wrapper));
  root.appendChild(bar);

  const nav = el('nav', { class: 'mb-4 flex items-center gap-1 overflow-x-auto pb-1', 'aria-label': '分组导航' });
  nav.appendChild(navChip('全部', totalLinks, props.activeGroupId === null, () => props.onActiveGroup(null)));
  props.groups.forEach((group) => {
    nav.appendChild(
      navChip(group.name, group.links.length, props.activeGroupId === group.id, () =>
        props.onActiveGroup(props.activeGroupId === group.id ? null : group.id),
      ),
    );
  });
  root.appendChild(nav);

  if (editable) {
    const hint = el('div', { class: 'mb-3 flex items-center gap-2 text-[11px] text-[var(--c-fg-soft)]' });
    hint.append(
      icon('lock-open', { size: 13, stroke: 1.8 }),
      el('span', { text: '编辑模式：磁贴可拖动排序，悬停出现编辑与删除；组标题右侧可切置顶与尺寸。' }),
    );
    root.appendChild(hint);
  }

  const showPinned = pinned.filter((group) => props.activeGroupId === null || group.id === props.activeGroupId);
  if (showPinned.length > 0) {
    const area = el('div', { class: 'mb-5 space-y-3 border border-[var(--c-line)] bg-[var(--c-surface-2)]/40 p-3', 'aria-label': '置顶组' });
    showPinned.forEach((group) => area.appendChild(renderSection(group, props, true)));
    root.appendChild(area);
  }

  const showNormal = normal.filter((group) => props.activeGroupId === null || group.id === props.activeGroupId);
  if (showNormal.length > 0) {
    const area = el('div', { class: 'space-y-4', 'aria-label': '普通组' });
    showNormal.forEach((group) => area.appendChild(renderSection(group, props, false)));
    root.appendChild(area);
  }

  if (props.groups.length === 0) {
    const empty = el('div', { class: 'border border-dashed border-[var(--c-line-strong)] p-10 text-center' });
    empty.append(
      el('h2', { class: 'text-[17px] font-light text-fg', text: props.query ? '没有匹配的结果' : '还没有书签' }),
      el('p', { class: 'mx-auto mt-2 max-w-md text-[12px] text-[var(--c-fg-soft)]', text: props.query ? '换个关键词试试。' : '点右下角胶囊的锁头进入编辑模式即可添加。' }),
    );
    root.appendChild(empty);
  }

  return root;
}

function navChip(label: string, count: number, active: boolean, onClick: () => void): HTMLElement {
  const node = el('button', {
    class: cn(
      'pressable flex shrink-0 items-center gap-1.5 border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em]',
      active
        ? 'border-accent bg-accent text-[color:var(--c-accent-ink)]'
        : 'border-transparent text-[var(--c-fg-soft)] hover:border-[var(--c-line)] hover:bg-[var(--c-surface-2)] hover:text-fg',
    ),
    'aria-pressed': active ? 'true' : 'false',
    onClick,
  });
  node.append(
    el('span', { text: label }),
    el('span', { class: cn('text-[10px]', active ? 'text-[color:var(--c-accent-ink)]/70' : 'text-[var(--c-fg-soft)]'), text: String(count) }),
  );
  return node;
}

function renderSection(group: GroupWithLinks, props: BookmarksProps, pinned: boolean): HTMLElement {
  const editable = props.authed && props.editing;
  const mode = modeOf(group);
  const links = props.query ? group.links.filter((link) => matches(link, props.query)) : group.links;

  const section = el('section', { 'aria-label': group.name });
  const header = el('div', { class: 'mb-2 flex flex-wrap items-center gap-2' });
  append(header, [
    el('span', { class: 'h-2.5 w-2.5 shrink-0 bg-accent', 'aria-hidden': 'true' }),
    el('h2', { class: 'text-[13px] font-semibold uppercase tracking-[0.1em] text-fg', text: group.name }),
    el('span', { class: 'text-[10px] text-[var(--c-fg-soft)]', text: String(links.length) }),
    pinned ? el('span', { class: 'text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--c-fg-soft)]', text: 'pinned' }) : null,
  ]);

  if (editable) {
    const tools = el('div', { class: 'ml-auto flex items-center gap-0.5' });
    append(tools, [
      tinyAction(pinned ? '取消置顶' : '设为置顶', pinned ? 'arrow-down' : 'arrow-up', () => props.onTogglePin(group)),
      tinyAction('宽磁贴', 'grid', () => props.onDisplayMode(group, 'grid'), mode === 'grid'),
      tinyAction('行磁贴', 'list', () => props.onDisplayMode(group, 'list'), mode === 'list'),
      tinyAction('方磁贴', 'bookmark', () => props.onDisplayMode(group, 'icon'), mode === 'icon'),
      tinyAction('加一条', 'plus', () => props.onAddLink(group.id)),
      tinyAction('改名', 'edit', () => props.onEditGroup(group)),
      tinyAction('删除组', 'trash', () => props.onDeleteGroup(group)),
    ]);
    header.appendChild(tools);
  }
  section.appendChild(header);

  if (links.length === 0) {
    section.appendChild(el('p', { class: 'py-1 text-[11px] text-[var(--c-fg-soft)]', text: '空分组' }));
    return section;
  }

  if (mode === 'grid') {
    const grid = el('div', { class: 'grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]' });
    links.forEach((link) => grid.appendChild(renderWideTile(link, props, links, editable)));
    if (editable) grid.appendChild(addTile('加一条', 'min-h-[92px]', () => props.onAddLink(group.id)));
    section.appendChild(grid);
  } else if (mode === 'list') {
    const grid = el('div', { class: 'grid gap-1 [grid-template-columns:repeat(auto-fill,minmax(210px,1fr))]' });
    links.forEach((link) => grid.appendChild(renderRowTile(link, props, links, editable)));
    if (editable) grid.appendChild(addTile('加一条', 'h-9', () => props.onAddLink(group.id)));
    section.appendChild(grid);
  } else {
    const grid = el('div', { class: 'grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(88px,1fr))]' });
    links.forEach((link) => grid.appendChild(renderSquareTile(link, props, links, editable)));
    if (editable) grid.appendChild(addTile('加一条', 'aspect-square', () => props.onAddLink(group.id)));
    section.appendChild(grid);
  }

  return section;
}

function tinyAction(title: string, iconName: 'arrow-up' | 'arrow-down' | 'grid' | 'list' | 'bookmark' | 'plus' | 'edit' | 'trash', onClick: () => void, active = false): HTMLElement {
  const node = el('button', {
    type: 'button',
    class: cn(
      'pressable flex h-6 w-6 items-center justify-center',
      active ? 'bg-accent text-[color:var(--c-accent-ink)]' : 'text-[var(--c-fg-soft)] hover:bg-[var(--c-surface-2)] hover:text-fg',
    ),
    title,
    'aria-label': title,
    'aria-pressed': active ? 'true' : 'false',
    onClick,
  });
  node.append(icon(iconName, { size: 13, stroke: 1.8 }));
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
    node.classList.add('ring-1', 'ring-accent');
  });
  node.addEventListener('dragleave', () => node.classList.remove('ring-1', 'ring-accent'));
  node.addEventListener('drop', (event) => {
    event.preventDefault();
    node.classList.remove('ring-1', 'ring-accent');
    const fromId = Number(event.dataTransfer?.getData('text/plain'));
    if (!fromId || fromId === link.id) return;
    const ids = siblings.map((item) => item.id).filter((id) => id !== fromId);
    const targetIndex = ids.indexOf(link.id);
    ids.splice(targetIndex, 0, fromId);
    props.onReorder(link.group_id, ids);
  });
}

function hoverTools(link: Link, props: BookmarksProps, withMove = false): HTMLElement {
  const tools = el('div', {
    class: 'absolute right-0.5 top-0.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100',
  });
  append(tools, [
    tinyAction('编辑', 'edit', () => props.onEditLink(link)),
    tinyAction('删除', 'trash', () => props.onDeleteLink(link)),
    withMove ? tinyAction('上移', 'arrow-up', () => props.onMoveLink(link, -1)) : null,
    withMove ? tinyAction('下移', 'arrow-down', () => props.onMoveLink(link, 1)) : null,
  ]);
  return tools;
}

function renderWideTile(link: Link, props: BookmarksProps, siblings: Link[], editable: boolean): HTMLElement {
  const wrap = tile({ class: 'min-h-[92px] p-3' });
  wrap.append(
    el('a', { href: link.url, target: '_blank', rel: 'noopener noreferrer', class: 'flex h-full flex-col justify-between', title: link.title + ' · ' + link.url },
      el('span', { class: 'line-clamp-2 text-[13px] font-semibold leading-snug text-fg', text: link.title }),
      el('span', { class: 'mt-2 block truncate text-[10px] uppercase tracking-[0.08em] text-[var(--c-fg-soft)]', text: hostOf(link.url) }),
    ),
  );
  if (link.description) {
    wrap.appendChild(el('p', { class: 'mt-1 line-clamp-1 text-[10px] text-[var(--c-fg-soft)]', text: link.description }));
  }
  if (editable) {
    wrap.appendChild(hoverTools(link, props, true));
    dragify(wrap, link, siblings, props);
  }
  return wrap;
}

function renderRowTile(link: Link, props: BookmarksProps, siblings: Link[], editable: boolean): HTMLElement {
  const wrap = tile({ class: 'flex h-9 items-center gap-2 px-2.5' });
  wrap.appendChild(
    el('a', { href: link.url, target: '_blank', rel: 'noopener noreferrer', class: 'flex min-w-0 flex-1 items-baseline gap-2', title: link.url },
      el('span', { class: 'truncate text-[12px] text-fg', text: link.title }),
      el('span', { class: 'shrink-0 truncate text-[9px] uppercase tracking-[0.06em] text-[var(--c-fg-soft)]', text: hostOf(link.url) }),
    ),
  );
  if (editable) {
    wrap.appendChild(hoverTools(link, props));
    dragify(wrap, link, siblings, props);
  }
  return wrap;
}

function renderSquareTile(link: Link, props: BookmarksProps, siblings: Link[], editable: boolean): HTMLElement {
  const wrap = tile({ class: 'flex aspect-square items-center justify-center p-1.5', square: true });
  wrap.appendChild(
    el('a', { href: link.url, target: '_blank', rel: 'noopener noreferrer', class: 'flex h-full w-full items-center justify-center text-center', title: link.title + ' · ' + link.url },
      el('span', { class: 'line-clamp-3 text-[11px] font-medium leading-tight text-fg', text: link.title }),
    ),
  );
  if (editable) {
    wrap.appendChild(hoverTools(link, props));
    dragify(wrap, link, siblings, props);
  }
  return wrap;
}

function addTile(label: string, sizeClass: string, onClick: () => void): HTMLElement {
  const node = el('button', {
    class: cn(
      'pressable flex items-center justify-center gap-1 border border-dashed border-[var(--c-line-strong)] text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--c-fg-soft)] hover:border-accent hover:text-fg',
      sizeClass,
    ),
    onClick,
  });
  append(node, [icon('plus', { size: 12, stroke: 1.8 }), el('span', { text: label })]);
  return node;
}
