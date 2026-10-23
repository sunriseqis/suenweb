import type { GroupWithLinks, Link } from '../lib/api.ts';
import { cn } from '../lib/cn.ts';
import { append, el } from '../lib/dom.ts';
import { button } from '../ui/button.ts';
import { field } from '../ui/field.ts';
import { icon } from '../ui/icons.ts';
import { accentAt, card } from '../ui/surfaces.ts';

export type BookmarksProps = {
  groups: GroupWithLinks[];
  authed: boolean;
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
  const root = el('div', { class: 'relative z-10 mx-auto w-full max-w-[1400px] px-4 pb-24 pt-8 sm:px-8' });

  if (!props.authed) {
    const banner = el('div', {
      class: 'pattern-stripes mb-8 flex flex-wrap items-center justify-between gap-3 rounded-full border-4 border-dashed border-tertiary px-6 py-3',
    });
    banner.append(
      el('p', { class: 'flex items-center gap-2 text-sm font-bold text-fg' },
        icon('lock', { size: 18 }),
        el('span', { text: '游客模式：看得到，改不了。登录后可编辑。' }),
      ),
      button({ label: '登录', iconName: 'login', variant: 'primary', size: 'sm', onClick: props.onLogin }),
    );
    root.appendChild(banner);
  }

  const totalLinks = props.groups.reduce((sum, group) => sum + group.links.length, 0);
  const hero = el('header', { class: 'pattern-mesh relative mb-10 overflow-hidden rounded-[32px] border-4 border-accent p-8' });
  hero.append(
    el('span', {
      class: 'pointer-events-none absolute -right-6 -top-16 select-none font-heading text-[10rem] font-black leading-none text-fg/10 sm:text-[16rem]',
      'aria-hidden': 'true',
      text: 'WOW',
    }),
    el('p', { class: 'font-display text-xs uppercase tracking-[0.4em] text-secondary', text: 'SuenWeb 书签库' }),
    el('h1', { class: 'mt-3 text-5xl text-fg sm:text-7xl' },
      el('span', { class: 'ts-cn', text: '我的' }),
      el('span', { class: 'text-gradient anim-gradient', text: ' BOOKMARKS ' }),
      el('span', { class: 'ts-cn', text: '都在这儿' }),
    ),
    el('div', { class: 'relative mt-6 flex flex-wrap items-center gap-3' },
      el('span', { class: 'rounded-full border-4 border-secondary px-4 py-1 text-sm font-black text-fg', text: props.groups.length + ' 个分组' }),
      el('span', { class: 'rounded-full border-4 border-quaternary px-4 py-1 text-sm font-black text-fg', text: totalLinks + ' 条书签' }),
      props.authed
        ? button({ label: '收藏一条', iconName: 'plus', variant: 'primary', size: 'sm', onClick: () => props.onAddLink(props.activeGroupId ?? undefined) })
        : button({ label: '登录后编辑', iconName: 'login', variant: 'secondary', size: 'sm', onClick: props.onLogin }),
    ),
  );
  root.appendChild(hero);

  const nav = el('nav', { class: 'mb-8 flex flex-wrap items-center gap-2', 'aria-label': '分组导航' });
  nav.appendChild(navPill('全部', totalLinks, props.activeGroupId === null, 0, () => props.onActiveGroup(null)));
  props.groups.forEach((group, index) => {
    nav.appendChild(
      navPill(group.name, group.links.length, props.activeGroupId === group.id, index + 1, () =>
        props.onActiveGroup(props.activeGroupId === group.id ? null : group.id),
      ),
    );
  });
  if (props.authed) {
    nav.appendChild(button({ label: '新建分组', iconName: 'plus', variant: 'secondary', size: 'sm', onClick: props.onAddGroup }));
  }
  root.appendChild(nav);

  const search = field({
    label: '搜索书签',
    type: 'search',
    value: props.query,
    placeholder: '按标题、网址或备注搜索',
    index: 2,
  });
  search.input.addEventListener('input', (event) => {
    props.onQuery((event.target as HTMLInputElement).value);
  });
  root.appendChild(el('div', { class: 'mb-10 max-w-2xl' }, search.wrapper));

  const visibleGroups = props.groups
    .map((group) => ({ group, links: group.links.filter((link) => matches(link, props.query)) }))
    .filter((entry) => props.activeGroupId === null || entry.group.id === props.activeGroupId)
    .filter((entry) => entry.links.length > 0 || !props.query);

  if (visibleGroups.length === 0) {
    const empty = el('div', { class: 'pattern-dots relative overflow-hidden rounded-[32px] border-8 border-dashed border-secondary p-12 text-center' });
    empty.append(
      el('div', { class: 'mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full border-4 border-accent bg-accent/20 text-accent' },
        icon(props.query ? 'search' : 'bookmark', { size: 38 }),
      ),
      el('h2', { class: 'text-3xl text-fg ts-cn', text: props.query ? '没搜到，换个词试试' : '这里很空，正好开始收藏' }),
      el('p', { class: 'mx-auto mt-3 max-w-md text-fg/70', text: props.query ? '搜索只匹配标题、网址与备注。' : '装个浏览器插件一键收藏，或手动添加第一条。' }),
    );
    if (props.authed) {
      empty.appendChild(el('div', { class: 'mt-6 flex justify-center' },
        button({ label: '收藏第一条', iconName: 'plus', variant: 'primary', onClick: () => props.onAddLink(props.activeGroupId ?? undefined) }),
      ));
    }
    root.appendChild(empty);
  }

  visibleGroups.forEach((entry, groupIndex) => {
    root.appendChild(renderGroupSection(entry.group, entry.links, groupIndex, props));
  });

  return root;
}

function navPill(label: string, count: number, active: boolean, index: number, onClick: () => void): HTMLElement {
  const accent = accentAt(index);
  const node = el('button', {
    class: cn(
      'tap inline-flex items-center gap-2 rounded-full border-4 px-5 py-2 font-heading text-sm font-black uppercase tracking-widest transition-all duration-300',
      active ? 'scale-105 border-tertiary bg-riot text-ink' : cn(accent.border, 'panel text-fg hover:-rotate-1 hover:scale-105'),
    ),
    'aria-pressed': active ? 'true' : 'false',
    onClick,
  });
  node.append(
    el('span', { text: label }),
    el('span', { class: cn('rounded-full px-2 py-0.5 text-[11px]', active ? 'bg-ink/20' : accent.soft), text: String(count) }),
  );
  return node;
}

function renderGroupSection(group: GroupWithLinks, links: Link[], index: number, props: BookmarksProps): HTMLElement {
  const accent = accentAt(index + 1);
  const section = el('section', { class: 'mb-14', 'aria-label': group.name });
  const header = el('div', { class: 'mb-5 flex flex-wrap items-end justify-between gap-3 border-b-4 border-dashed pb-3', style: 'border-color:' + accent.cssVar });
  append(header, [
    el('div', { class: 'flex items-end gap-3' },
      el('span', { class: cn('font-display text-[11px] uppercase tracking-[0.3em]', accent.text), text: String(index + 1).padStart(2, '0') }),
      el('h2', { class: 'text-3xl text-fg ts-cn sm:text-4xl', text: group.name }),
      el('span', { class: 'mb-1 text-sm text-fg/50', text: links.length + ' 条' }),
    ),
    props.authed
      ? el('div', { class: 'flex flex-wrap items-center gap-2' },
          button({ label: '加一条', iconName: 'plus', variant: 'secondary', size: 'sm', onClick: () => props.onAddLink(group.id) }),
          button({ variant: 'icon', iconName: 'edit', title: '重命名分组', onClick: () => props.onEditGroup(group) }),
          button({ variant: 'icon', iconName: 'trash', title: '删除分组', onClick: () => props.onDeleteGroup(group) }),
        )
      : null,
  ]);
  section.appendChild(header);

  const grid = el('div', {
    class: cn(
      props.view === 'grid'
        ? 'grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3'
        : 'flex flex-col gap-4',
    ),
  });
  links.forEach((link, linkIndex) => {
    grid.appendChild(renderLinkCard(link, linkIndex, index, props, links));
  });
  if (links.length === 0 && props.authed) {
    grid.appendChild(renderAddCard(group, props));
  }
  section.appendChild(grid);
  return section;
}

function renderAddCard(group: GroupWithLinks, props: BookmarksProps): HTMLElement {
  const node = el('button', {
    class: 'flex min-h-[150px] items-center justify-center gap-3 rounded-[26px] border-8 border-dotted border-quaternary p-6 font-heading text-lg font-black uppercase tracking-widest text-fg/70 transition-all duration-300 hover:-rotate-1 hover:border-solid hover:text-fg',
    onClick: () => props.onAddLink(group.id),
  });
  append(node, [icon('plus', { size: 24 }), el('span', { text: '往「' + group.name + '」加一条' })]);
  return node;
}

function renderLinkCard(link: Link, linkIndex: number, groupIndex: number, props: BookmarksProps, siblings: Link[]): HTMLElement {
  const accent = accentAt(linkIndex + groupIndex);
  const wrap = card({
    index: linkIndex + groupIndex,
    rotate: linkIndex % 2 === 1 ? 1 : 0,
    class: cn('group relative overflow-hidden', props.authed ? 'cursor-grab active:cursor-grabbing' : '', props.view === 'list' ? 'flex flex-wrap items-center gap-4' : ''),
  });
  wrap.appendChild(
    el('div', {
      class: 'pattern-checker pointer-events-none absolute inset-0 opacity-40 transition-opacity duration-500 group-hover:opacity-70',
      'aria-hidden': 'true',
    }),
  );

  const initial = (link.title || hostOf(link.url)).slice(0, 1).toUpperCase();
  const head = el('div', { class: 'relative flex items-start gap-4' });
  head.append(
    el('span', {
      class: cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-4 font-heading text-xl font-black text-ink', accent.border, accent.bg),
      'aria-hidden': 'true',
      text: initial,
    }),
    el('div', { class: 'min-w-0 flex-1' },
      el('a', {
        href: link.url,
        target: '_blank',
        rel: 'noopener noreferrer',
        class: 'ts-cn block truncate font-heading text-xl font-black text-fg hover:text-accent',
        text: link.title,
      }),
      el('p', { class: 'mt-1 truncate text-sm text-fg/50', text: hostOf(link.url) }),
    ),
  );
  wrap.appendChild(head);

  if (link.description) {
    wrap.appendChild(el('p', { class: 'relative mt-3 line-clamp-2 text-sm text-fg/70', text: link.description }));
  }

  const actions = el('div', { class: 'relative mt-4 flex flex-wrap items-center gap-2' });
  actions.append(
    el('a', {
      href: link.url,
      target: '_blank',
      rel: 'noopener noreferrer',
      class: 'tap inline-flex h-10 items-center gap-2 rounded-full border-2 border-secondary px-4 text-xs font-black uppercase tracking-widest text-fg hover:bg-secondary hover:text-ink',
    },
      icon('external', { size: 15 }),
      el('span', { text: '打开' }),
    ),
  );
  if (props.authed) {
    actions.append(
      button({ variant: 'icon', iconName: 'edit', title: '编辑', onClick: () => props.onEditLink(link) }),
      button({ variant: 'icon', iconName: 'trash', title: '删除', onClick: () => props.onDeleteLink(link) }),
      button({ variant: 'icon', iconName: 'arrow-up', title: '上移', onClick: () => props.onMoveLink(link, -1) }),
      button({ variant: 'icon', iconName: 'arrow-down', title: '下移', onClick: () => props.onMoveLink(link, 1) }),
    );
  }
  wrap.appendChild(actions);

  if (props.authed) {
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
