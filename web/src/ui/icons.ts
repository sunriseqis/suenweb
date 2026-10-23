import { svg } from '../lib/dom.ts';

export type IconName =
  | 'star' | 'sparkle' | 'circle' | 'square' | 'triangle' | 'bolt'
  | 'search' | 'plus' | 'edit' | 'trash' | 'external' | 'grip' | 'lock'
  | 'lock-open' | 'sun' | 'moon' | 'monitor' | 'calm' | 'settings' | 'close' | 'check'
  | 'chevron-up' | 'chevron-down' | 'bookmark' | 'folder' | 'login' | 'logout'
  | 'grid' | 'list' | 'refresh' | 'arrow-up' | 'arrow-down' | 'user' | 'shield' | 'link';

const PATHS: Record<IconName, string> = {
  star: '<path d="M12 2.6 15 9l6.9 1-5 4.9 1.2 6.9L12 18.6 5.9 21.8 7.1 14.9l-5-4.9L9 9z"/>',
  sparkle: '<path d="M12 2.5 14.2 9.8 21.5 12l-7.3 2.2L12 21.5l-2.2-7.3L2.5 12l7.3-2.2z"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  square: '<rect x="4" y="4" width="16" height="16" rx="2"/>',
  triangle: '<path d="M12 3.5 21.5 20H2.5z"/>',
  bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16.2 16.2 4.3 4.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4L20.5 7.5 16.5 3.5 4 16z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6.5 7 7.5 20h9L17.5 7"/>',
  external: '<path d="M14 4h6v6M20 4 11 13M18 14v5.5H5V6h5.5"/>',
  grip: '<circle cx="9.5" cy="7" r="1.3"/><circle cx="14.5" cy="7" r="1.3"/><circle cx="9.5" cy="12" r="1.3"/><circle cx="14.5" cy="12" r="1.3"/><circle cx="9.5" cy="17" r="1.3"/><circle cx="14.5" cy="17" r="1.3"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2.5"/><path d="M8.5 10V7a3.5 3.5 0 0 1 7 0v3"/>',
  'lock-open': '<rect x="5" y="11" width="14" height="9.5" rx="2.5"/><path d="M8.5 11V7.5a3.5 3.5 0 0 1 6.7-1.4"/>',
  sun: '<circle cx="12" cy="12" r="4.3"/><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.9 1.9M16.8 16.8l1.9 1.9M18.7 5.3l-1.9 1.9M7.2 16.8l-1.9 1.9"/>',
  moon: '<path d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5 8.8 8.8 0 1 0 20.5 14.6z"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2.5"/><path d="M9 20h6M12 16v4"/>',
  calm: '<path d="M2.5 12c2.6-4.2 5.2-4.2 7.8 0s5.2 4.2 7.8 0"/><path d="M4 20.5 20 3.5"/>',
  settings: '<path d="M4 7h8M16 7h4"/><circle cx="14" cy="7" r="2.4"/><path d="M4 12h4M12 12h8"/><circle cx="10" cy="12" r="2.4"/><path d="M4 17h10M18 17h2"/><circle cx="16" cy="17" r="2.4"/>',
  close: '<path d="M6 6 18 18M18 6 6 18"/>',
  check: '<path d="m4.5 12.5 5 5L19.5 6.5"/>',
  "chevron-up": '<path d="m6 15 6-6 6 6"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  bookmark: '<path d="M6 3h12v18l-6-4.5L6 21z"/>',
  folder: '<path d="M3 6h6l2 2.5h10V20H3z"/>',
  login: '<path d="M14 4h6v16h-6"/><path d="M4 12h10M11 8l4 4-4 4"/>',
  logout: '<path d="M9 4h11v16H9"/><path d="M13 12H3M6 8l-3 4 3 4"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.6"/><rect x="4" y="13" width="7" height="7" rx="1.6"/><rect x="13" y="13" width="7" height="7" rx="1.6"/>',
  list: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 4v5h-5"/>',
  "arrow-up": '<path d="M12 4v16M6 10l6-6 6 6"/>',
  "arrow-down": '<path d="M12 4v16M6 14l6 6 6-6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.6-4.2 4.6-6.2 8-6.2s6.4 2 8 6.2"/>',
  shield: '<path d="M12 3 20 6v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  link: '<path d="M9.5 14.5 14.5 9.5"/><path d="M7 12 4.8 14.2a3.6 3.6 0 0 0 5 5L12 17"/><path d="M17 12l2.2-2.2a3.6 3.6 0 0 0-5-5L12 7"/>',
};

export type IconOptions = { size?: number; class?: string; stroke?: number; label?: string };

export function icon(name: IconName, options: IconOptions = {}): SVGSVGElement {
  const { size = 24, class: className = '', stroke = 2.6, label } = options;
  const node = svg('0 0 24 24', {
    inner: PATHS[name],
    width: String(size),
    height: String(size),
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    "stroke-width": String(stroke),
    "stroke-linecap": 'round',
    "stroke-linejoin": 'round',
    class: className,
    'vector-effect': 'non-scaling-stroke',
  });
  if (label) {
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', label);
  } else {
    node.setAttribute('aria-hidden', 'true');
    node.setAttribute('focusable', 'false');
  }
  return node;
}
