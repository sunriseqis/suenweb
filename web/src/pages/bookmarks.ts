import type { GroupWithLinks, Link } from '../lib/api.ts';
import { cn } from '../lib/cn.ts';
import { append, el } from '../lib/dom.ts';
import { button } from '../ui/button.ts';
import { icon } from '../ui/icons.ts';
import { tile } from '../ui/surfaces.ts';
import { webSearchBar } from '../ui/websearch.ts';

export type DisplayMode = 'grid' | 'list' | 'icon';

export type BookmarksProps = {
  groups: GroupWithLinks[];
  authed: boolean;
  editing: boolean;
  fetchIcons: boolean;
  activeTabId: number | null;
  onTab: (id: number) => void;
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
  onLayoutMode: (group: GroupWithLinks, mode: 'single' | 'multi') => void;
  onLogin: () => void;
};

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function faviconSpan(host: string, size: number, extra = ''): HTMLElement {
  const node = el('span', {
    class: 'pointer-events-none absolute bg-contain bg-center bg-no-repeat opacity-80 ' + extra,
    'aria-hidden': 'true',
  });
  node.style.width = size + 'px';
  node.style.height = size + 'px';
  node.style.backgroundImage = 'url(/api/icon?domain=' + encodeURIComponent(host) + ')';
  return node;
}

function modeOf(group: GroupWithLinks): DisplayMode {
  const mode = group.display_mode;
  if (mode === 'grid' || mode === 'list' || mode === 'icon') return mode;
  return group.type === 'fixed' ? 'grid' : 'icon';
}

export function renderBookmarks(props: BookmarksProps): HTMLElement {
  const editable = props.authed && props.editing;
  const root = el('div', { class: 'mx-auto w-full max-w-[1500px] px-4 pb-16 pt-3 sm:px-6' });

  const pinned = props.groups.filter((group) => group.type === 'fixed');
  const normal = props.groups.filter((group) => group.type !== 'fixed');

  const bar = el('div', {
    class: 'mb-3 grid items-center gap-3 border-b border-[var(--c-line)] pb-3 sm:grid-cols-[1fr_minmax(0,42rem)_1fr]',
  });
  bar.appendChild(el('div', { class: 'hidden sm:block', 'aria-hidden': 'true' }));

  const search = webSearchBar('搜索网页，回车开新标签');
  bar.appendChild(el('div', { class: 'mx-auto w-full' }, search.element));

  const actions = el('div', { class: 'flex items-center justify-end gap-1.5' });
  append(actions, [
    editable
      ? button({ label: '收藏', iconName: 'plus', variant: 'primary', size: 'xs', onClick: () => props.onAddLink(props.activeTabId ?? undefined) })
      : null,
    editable
      ? button({ label: '新建分组', iconName: 'folder', variant: 'secondary', size: 'xs', onClick: props.onAddGroup })
      : null,
  ]);
  bar.appendChild(actions);
  root.appendChild(bar);

  if (editable) {
    const hint = el('div', { class: 'mb-3 flex items-center gap-2 text-[11px] text-[var(--c-fg-soft)]' });
    hint.append(
      icon('lock-open', { size: 13, stroke: 1.8 }),
      el('span', { text: '编辑模式：磁贴可拖动排序，悬停出现编辑与删除；组标题右侧可切置顶与尺寸。' }),
    );
    root.appendChild(hint);
  }

  if (pinned.length > 0) {
    const area = el('div', { class: 'mb-4 border border-[var(--c-line)] bg-[var(--c-surface-2)]/40 p-3', 'aria-label': '置顶组' });
    const singles = pinned.filter((group) => group.layout_mode === 'single');
    const multis = pinned.filter((group) => group.layout_mode !== 'single');
    const singleBox = el('div', { class: 'space-y-3' });
    singles.forEach((group) => singleBox.appendChild(pinnedCard(group, props)));
    if (singles.length > 0) area.appendChild(singleBox);
    let cursor = 0;
    packMultiRows(multis.length).forEach((cols) => {
      if (cursor > 0 || singles.length > 0) {
        area.appendChild(el('div', { class: 'h-3', 'aria-hidden': 'true' }));
      }
      const slice = multis.slice(cursor, cursor + cols);
      cursor += cols;
      const row = el('div', {
        class: cols === 3 ? 'grid gap-3 md:grid-cols-2 lg:grid-cols-3' : cols === 2 ? 'grid gap-3 md:grid-cols-2' : 'grid gap-3',
      });
      slice.forEach((group) => row.appendChild(pinnedCard(group, props)));
      area.appendChild(row);
    });
    root.appendChild(area);
  }

  if (normal.length > 0) {
    const activeId = normal.some((group) => group.id === props.activeTabId) ? (props.activeTabId as number) : normal[0].id;
    const active = normal.find((group) => group.id === activeId) ?? normal[0];

    const strip = el('div', {
      class: 'sticky top-0 z-20 -mx-4 mb-3 flex items-center gap-1 overflow-x-auto border-b border-[var(--c-line)] bg-[var(--c-bg)] px-4 py-1.5 sm:-mx-6 sm:px-6',
      role: 'tablist',
      'aria-label': '普通分组',
    });
    for (const group of normal) {
      const on = group.id === activeId;
      const node = el('button', {
        type: 'button',
        class: cn(
          'pressable flex shrink-0 items-center gap-1.5 whitespace-nowrap border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em]',
          on
            ? 'border-accent bg-accent text-[color:var(--c-accent-ink)]'
            : 'border-transparent text-[var(--c-fg-soft)] hover:border-[var(--c-line)] hover:bg-[var(--c-surface-2)] hover:text-fg',
        ),
        role: 'tab',
        'aria-selected': on ? 'true' : 'false',
        onClick: () => props.onTab(group.id),
      });
      node.append(
        el('span', { text: group.name }),
        el('span', { class: cn('text-[10px]', on ? 'text-[color:var(--c-accent-ink)]/70' : 'text-[var(--c-fg-soft)]'), text: String(group.links.length) }),
      );
      strip.appendChild(node);
    }
    root.appendChild(strip);

    const panel = el('div', { role: 'tabpanel', 'aria-label': active.name });
    panel.appendChild(renderSection(active, props, false));
    root.appendChild(panel);
  }

  if (props.groups.length === 0) {
    const empty = el('div', { class: 'border border-dashed border-[var(--c-line-strong)] p-10 text-center' });
    empty.append(
      el('h2', { class: 'text-[17px] font-light text-fg', text: '还没有书签' }),
      el('p', { class: 'mx-auto mt-2 max-w-md text-[12px] text-[var(--c-fg-soft)]', text: '点右下角胶囊的锁头进入编辑模式即可添加。' }),
    );
    root.appendChild(empty);
  }

  return root;
}

function packMultiRows(count: number): number[] {
  const rows: number[] = [];
  let left = count;
  while (left > 0) {
    if (left === 1) { rows.push(1); break; }
    if (left === 2) { rows.push(2); break; }
    if (left === 4) { rows.push(2, 2); break; }
    rows.push(3);
    left -= 3;
  }
  return rows;
}

function pinnedCard(group: GroupWithLinks, props: BookmarksProps): HTMLElement {
  const box = el('div', { class: 'border border-[var(--c-line)] bg-[var(--c-bg)] p-2.5' });
  box.appendChild(renderSection(group, props, true));
  return box;
}

function renderSection(group: GroupWithLinks, props: BookmarksProps, pinned: boolean): HTMLElement {
  const editable = props.authed && props.editing;
  const mode = modeOf(group);
  const links = group.links;

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
      pinned
        ? tinyAction(
            group.layout_mode === 'single' ? '改为并排分栏' : '改为独占整行',
            'grid',
            () => props.onLayoutMode(group, group.layout_mode === 'single' ? 'multi' : 'single'),
            group.layout_mode === 'single',
          )
        : null,
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
    const grid = el('div', { class: 'grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(232px,1fr))]' });
    links.forEach((link) => grid.appendChild(renderWideTile(link, props, links, editable)));
    if (editable) grid.appendChild(addTile('min-h-[104px]', () => props.onAddLink(group.id)));
    section.appendChild(grid);
  } else if (mode === 'list') {
    const grid = el('div', { class: 'grid gap-1 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]' });
    links.forEach((link) => grid.appendChild(renderRowTile(link, props, links, editable)));
    if (editable) grid.appendChild(addTile('h-10', () => props.onAddLink(group.id)));
    section.appendChild(grid);
  } else {
    const grid = el('div', { class: 'grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(116px,1fr))]' });
    links.forEach((link) => grid.appendChild(renderSquareTile(link, props, links, editable)));
    if (editable) grid.appendChild(addTile('aspect-square', () => props.onAddLink(group.id)));
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
  const wrap = tile({ class: 'relative min-h-[104px] p-3.5' });
  if (props.fetchIcons) wrap.appendChild(faviconSpan(hostOf(link.url), 13, 'right-2 top-2'));
  wrap.append(
    el('a', { href: link.url, target: '_blank', rel: 'noopener noreferrer', class: 'flex h-full flex-col justify-between', title: link.title + ' · ' + link.url },
      el('span', { class: 'line-clamp-2 text-[14px] font-semibold leading-snug text-fg', text: link.title }),
      el('span', { class: 'mt-2 block truncate text-[11px] uppercase tracking-[0.06em] text-[var(--c-fg-soft)]', text: hostOf(link.url) }),
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
  const wrap = tile({ class: 'relative flex h-10 items-center gap-2 px-2.5' });
  if (props.fetchIcons) wrap.appendChild(faviconSpan(hostOf(link.url), 12, 'right-1.5 top-1.5'));
  wrap.appendChild(
    el('a', { href: link.url, target: '_blank', rel: 'noopener noreferrer', class: 'flex min-w-0 flex-1 items-baseline gap-2', title: link.url },
      el('span', { class: 'truncate text-[13px] text-fg', text: link.title }),
      el('span', { class: 'shrink-0 truncate text-[10px] uppercase tracking-[0.04em] text-[var(--c-fg-soft)]', text: hostOf(link.url) }),
    ),
  );
  if (editable) {
    wrap.appendChild(hoverTools(link, props));
    dragify(wrap, link, siblings, props);
  }
  return wrap;
}

function renderSquareTile(link: Link, props: BookmarksProps, siblings: Link[], editable: boolean): HTMLElement {
  const wrap = tile({ class: 'relative flex aspect-square items-center justify-center p-1.5', square: true });
  if (props.fetchIcons) wrap.appendChild(faviconSpan(hostOf(link.url), 12, 'right-1 top-1'));
  wrap.appendChild(
    el('a', { href: link.url, target: '_blank', rel: 'noopener noreferrer', class: 'flex h-full w-full items-center justify-center text-center', title: link.title + ' · ' + link.url },
      el('span', { class: 'line-clamp-3 text-[12px] font-medium leading-snug text-fg', text: link.title }),
    ),
  );
  if (editable) {
    wrap.appendChild(hoverTools(link, props));
    dragify(wrap, link, siblings, props);
  }
  return wrap;
}

function addTile(sizeClass: string, onClick: () => void): HTMLElement {
  const node = el('button', {
    class: cn(
      'pressable flex items-center justify-center gap-1 border border-dashed border-[var(--c-line-strong)] text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--c-fg-soft)] hover:border-accent hover:text-fg',
      sizeClass,
    ),
    onClick,
  });
  append(node, [icon('plus', { size: 12, stroke: 1.8 })]);
  return node;
}
