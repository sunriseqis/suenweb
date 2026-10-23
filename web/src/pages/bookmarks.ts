import type { GroupWithLinks, Link } from '../lib/api.ts';
import { cn } from '../lib/cn.ts';
import { append, el } from '../lib/dom.ts';
import { button } from '../ui/button.ts';
import { field } from '../ui/field.ts';
import { icon } from '../ui/icons.ts';
import { accentAt, card, shadowVars } from '../ui/surfaces.ts';

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

export function renderBookmarks(props: BookmarksProps): HTMLElement {
  const editable = props.authed && props.editing;
  const root = el('div', { class: 'relative z-10 mx-auto w-full max-w-[1600px] px-4 pb-28 pt-5 sm:px-6' });

  if (!props.authed) {
    const banner = el('div', {
      class: 'pattern-stripes mb-5 flex flex-wrap items-center justify-between gap-2 rounded-full border-4 border-dashed border-tertiary px-4 py-1.5',
    });
    banner.append(
      el('p', { class: 'flex items-center gap-2 text-xs font-bold text-fg' },
        icon('lock', { size: 15 }),
        el('span', { text: '只读浏览：想编辑请登录' }),
      ),
      button({ label: '登录', iconName: 'login', variant: 'primary', size: 'xs', onClick: props.onLogin }),
    );
    root.appendChild(banner);
  }

  if (editable) {
    const hint = el('div', {
      class: 'mb-5 flex flex-wrap items-center gap-2 rounded-full border-4 border-dashed border-secondary px-4 py-1.5',
    });
    hint.append(
      icon('lock-open', { size: 15 }),
      el('span', { class: 'text-xs font-bold text-fg', text: '编辑模式：可拖动排序、增删改；按右下角锁头回到只读' }),
    );
    root.appendChild(hint);
  }

  const totalLinks = props.groups.reduce((sum, group) => sum + group.links.length, 0);
  const hero = el('header', { class: 'pattern-mesh relative mb-6 overflow-hidden rounded-[24px] border-4 border-accent px-5 py-4' });
  hero.append(
    el('span', {
      class: 'pointer-events-none absolute -right-4 -top-10 select-none font-heading text-[7rem] font-black leading-none text-fg/10 sm:text-[10rem]',
      'aria-hidden': 'true',
      text: 'WOW',
    }),
    el('div', { class: 'relative flex flex-wrap items-end justify-between gap-3' },
      el('div', {},
        el('p', { class: 'font-display text-[10px] uppercase tracking-[0.4em] text-secondary', text: 'SuenWeb 书签库' }),
        el('h1', { class: 'mt-1 text-3xl text-fg sm:text-4xl' },
          el('span', { class: 'ts-cn', text: '我的' }),
          el('span', { class: 'text-gradient anim-gradient', text: ' BOOKMARKS ' }),
          el('span', { class: 'ts-cn', text: '都在这儿' }),
        ),
      ),
      el('div', { class: 'flex flex-wrap items-center gap-2' },
        el('span', { class: 'rounded-full border-4 border-secondary px-3 py-0.5 text-xs font-black text-fg', text: props.groups.length + ' 组' }),
        el('span', { class: 'rounded-full border-4 border-quaternary px-3 py-0.5 text-xs font-black text-fg', text: totalLinks + ' 条' }),
        editable
          ? button({ label: '收藏一条', iconName: 'plus', variant: 'primary', size: 'xs', onClick: () => props.onAddLink(props.activeGroupId ?? undefined) })
          : null,
      ),
    ),
  );
  root.appendChild(hero);

  const nav = el('nav', { class: 'mb-4 flex flex-wrap items-center gap-1.5', 'aria-label': '分组导航' });
  nav.appendChild(navPill('全部', totalLinks, props.activeGroupId === null, 0, () => props.onActiveGroup(null)));
  props.groups.forEach((group, index) => {
    nav.appendChild(
      navPill(group.name, group.links.length, props.activeGroupId === group.id, index + 1, () =>
        props.onActiveGroup(props.activeGroupId === group.id ? null : group.id),
      ),
    );
  });
  if (editable) {
    nav.appendChild(button({ label: '新建分组', iconName: 'plus', variant: 'secondary', size: 'xs', onClick: props.onAddGroup }));
  }
  root.appendChild(nav);

  const search = field({
    label: '搜索书签',
    type: 'search',
    value: props.query,
    placeholder: '按标题、网址或备注搜索',
    index: 2,
    compact: true,
  });
  search.input.addEventListener('input', (event) => {
    props.onQuery((event.target as HTMLInputElement).value);
  });
  root.appendChild(el('div', { class: 'mb-6 max-w-xl' }, search.wrapper));

  const visibleGroups = props.groups
    .map((group) => ({ group, links: group.links.filter((link) => matches(link, props.query)) }))
    .filter((entry) => props.activeGroupId === null || entry.group.id === props.activeGroupId)
    .filter((entry) => entry.links.length > 0 || !props.query);

  if (visibleGroups.length === 0) {
    const empty = el('div', { class: 'pattern-dots relative overflow-hidden rounded-[24px] border-8 border-dashed border-secondary p-10 text-center' });
    empty.append(
      el('div', { class: 'mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full border-4 border-accent bg-accent/20 text-accent' },
        icon(props.query ? 'search' : 'bookmark', { size: 30 }),
      ),
      el('h2', { class: 'text-2xl text-fg ts-cn', text: props.query ? '没搜到，换个词试试' : '这里很空，正好开始收藏' }),
      el('p', { class: 'mx-auto mt-2 max-w-md text-sm text-fg/70', text: props.query ? '搜索只匹配标题、网址与备注。' : '装个浏览器插件一键收藏，或手动添加第一条。' }),
    );
    root.appendChild(empty);
  }

  visibleGroups.forEach((entry, groupIndex) => {
    root.appendChild(renderGroupSection(entry.group, entry.links, groupIndex, props, editable));
  });

  return root;
}

function navPill(label: string, count: number, active: boolean, index: number, onClick: () => void): HTMLElement {
  const accent = accentAt(index);
  const node = el('button', {
    class: cn(
      'pressable inline-flex items-center gap-1.5 rounded-full border-4 px-3 py-1 font-heading text-[11px] font-black uppercase tracking-widest transition-all duration-300',
      active
        ? 'border-tertiary bg-riot text-ink shadow-multi-sm'
        : cn(accent.border, 'panel text-fg hover:-rotate-1 hover:scale-105'),
    ),
    style: shadowVars(index),
    'aria-pressed': active ? 'true' : 'false',
    onClick,
  });
  node.append(
    el('span', { text: label }),
    el('span', { class: cn('rounded-full px-1.5 text-[10px]', active ? 'bg-ink/20' : accent.soft), text: String(count) }),
  );
  return node;
}

function renderGroupSection(group: GroupWithLinks, links: Link[], index: number, props: BookmarksProps, editable: boolean): HTMLElement {
  const accent = accentAt(index + 1);
  const section = el('section', { class: 'mb-8', 'aria-label': group.name });
  const header = el('div', { class: 'mb-3 flex flex-wrap items-end justify-between gap-2 border-b-4 border-dashed pb-2', style: 'border-color:' + accent.cssVar });
  append(header, [
    el('div', { class: 'flex items-end gap-2' },
      el('span', { class: cn('font-display text-[10px] uppercase tracking-[0.3em]', accent.text), text: String(index + 1).padStart(2, '0') }),
      el('h2', { class: 'text-xl text-fg ts-cn sm:text-2xl', text: group.name }),
      el('span', { class: 'mb-0.5 text-xs text-fg/50', text: links.length + ' 条' }),
    ),
    editable
      ? el('div', { class: 'flex flex-wrap items-center gap-1.5' },
          button({ label: '加一条', iconName: 'plus', variant: 'secondary', size: 'xs', onClick: () => props.onAddLink(group.id) }),
          button({ variant: 'icon', iconName: 'edit', title: '重命名分组', onClick: () => props.onEditGroup(group) }),
          button({ variant: 'icon', iconName: 'trash', title: '删除分组', onClick: () => props.onDeleteGroup(group) }),
        )
      : null,
  ]);
  section.appendChild(header);

  const grid = el('div', {
    class: cn(
      props.view === 'grid'
        ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'
        : 'flex flex-col gap-2',
    ),
  });
  links.forEach((link, linkIndex) => {
    grid.appendChild(renderLinkCard(link, linkIndex, index, props, links, editable));
  });
  if (links.length === 0 && editable) {
    grid.appendChild(renderAddCard(group, props));
  }
  section.appendChild(grid);
  return section;
}

function renderAddCard(group: GroupWithLinks, props: BookmarksProps): HTMLElement {
  const node = el('button', {
    class: 'pressable flex min-h-[92px] items-center justify-center gap-2 rounded-[18px] border-4 border-dotted border-quaternary p-4 font-heading text-xs font-black uppercase tracking-widest text-fg/70 transition-all duration-300 hover:-rotate-1 hover:border-solid hover:text-fg',
    onClick: () => props.onAddLink(group.id),
  });
  append(node, [icon('plus', { size: 18 }), el('span', { text: '往「' + group.name + '」加一条' })]);
  return node;
}

function renderLinkCard(link: Link, linkIndex: number, groupIndex: number, props: BookmarksProps, siblings: Link[], editable: boolean): HTMLElement {
  const accent = accentAt(linkIndex + groupIndex);
  const wrap = card({
    index: linkIndex + groupIndex,
    rotate: linkIndex % 2 === 1 ? 1 : 0,
    class: cn('group relative overflow-hidden', editable ? 'cursor-grab active:cursor-grabbing' : ''),
  });
  wrap.appendChild(
    el('div', {
      class: 'pattern-checker pointer-events-none absolute inset-0 opacity-30 transition-opacity duration-500 group-hover:opacity-60',
      'aria-hidden': 'true',
    }),
  );

  const initial = (link.title || hostOf(link.url)).slice(0, 1).toUpperCase();
  const head = el('div', { class: 'relative flex items-start gap-2.5' });
  head.append(
    el('span', {
      class: cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-4 font-heading text-sm font-black text-ink', accent.border, accent.bg),
      'aria-hidden': 'true',
      text: initial,
    }),
    el('div', { class: 'min-w-0 flex-1' },
      el('a', {
        href: link.url,
        target: '_blank',
        rel: 'noopener noreferrer',
        class: 'ts-cn block truncate font-heading text-base font-black leading-tight text-fg hover:text-accent',
        text: link.title,
      }),
      el('p', { class: 'truncate text-[11px] text-fg/50', text: hostOf(link.url) }),
    ),
  );
  wrap.appendChild(head);

  if (link.description) {
    wrap.appendChild(el('p', { class: 'relative mt-2 line-clamp-2 text-xs leading-snug text-fg/70', text: link.description }));
  }

  const actions = el('div', { class: 'relative mt-2.5 flex flex-wrap items-center gap-1.5' });
  actions.append(
    el('a', {
      href: link.url,
      target: '_blank',
      rel: 'noopener noreferrer',
      class: 'inline-flex h-7 items-center gap-1 rounded-full border-2 border-secondary px-2.5 text-[10px] font-black uppercase tracking-widest text-fg hover:bg-secondary hover:text-ink',
    },
      icon('external', { size: 12 }),
      el('span', { text: '打开' }),
    ),
  );
  if (editable) {
    actions.append(
      button({ variant: 'icon', iconName: 'edit', title: '编辑', onClick: () => props.onEditLink(link) }),
      button({ variant: 'icon', iconName: 'trash', title: '删除', onClick: () => props.onDeleteLink(link) }),
      button({ variant: 'icon', iconName: 'arrow-up', title: '上移', onClick: () => props.onMoveLink(link, -1) }),
      button({ variant: 'icon', iconName: 'arrow-down', title: '下移', onClick: () => props.onMoveLink(link, 1) }),
    );
  }
  wrap.appendChild(actions);

  if (editable) {
    wrap.draggable = true;
    wrap.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('text/plain', String(link.id));
      wrap.classList.add('opacity-40');
    });
    wrap.addEventListener('dragend', () => wrap.classList.remove('opacity-40'));
    wrap.addEventListener('dragover', (event) => {
      event.preventDefault();
      wrap.classList.add('ring-4', 'ring-tertiary');
    });
    wrap.addEventListener('dragleave', () => wrap.classList.remove('ring-4', 'ring-tertiary'));
    wrap.addEventListener('drop', (event) => {
      event.preventDefault();
      wrap.classList.remove('ring-4', 'ring-tertiary');
      const fromId = Number(event.dataTransfer?.getData('text/plain'));
      if (!fromId || fromId === link.id) return;
      const ids = siblings.map((item) => item.id).filter((id) => id !== fromId);
      const targetIndex = ids.indexOf(link.id);
      ids.splice(targetIndex, 0, fromId);
      props.onReorder(link.group_id, ids);
    });
  }

  return wrap;
}
