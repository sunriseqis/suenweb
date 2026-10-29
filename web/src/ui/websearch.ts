import { cn } from '../lib/cn.ts';
import { el } from '../lib/dom.ts';
import { icon } from './icons.ts';

export type EngineId = 'google' | 'bing' | 'duckduckgo' | 'brave' | 'startpage';

export type Engine = {
  id: EngineId;
  name: string;
  template: string;
  note: string;
};

export const ENGINES: Engine[] = [
  { id: 'google', name: 'Google', template: 'https://www.google.com/search?q=%s', note: '主流，结果个性化' },
  { id: 'bing', name: 'Bing', template: 'https://www.bing.com/search?q=%s', note: '主流，结果个性化' },
  { id: 'duckduckgo', name: 'DuckDuckGo', template: 'https://duckduckgo.com/?q=%s', note: '不追踪、不建画像' },
  { id: 'brave', name: 'Brave', template: 'https://search.brave.com/search?q=%s', note: '独立索引，默认不做画像' },
  { id: 'startpage', name: 'Startpage', template: 'https://www.startpage.com/sp/search?query=%s', note: 'Google 结果 + 匿名代理' },
];

const KEY = 'sw.engine';

/** 存储与 window 都要能在无 DOM 环境下安全降级（测试 / SSR） */
function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function getEngineId(): EngineId {
  const saved = storage()?.getItem(KEY) as EngineId | null;
  return ENGINES.some((engine) => engine.id === saved) ? (saved as EngineId) : 'google';
}

export function setEngineId(id: EngineId): void {
  storage()?.setItem(KEY, id);
}

export function searchUrl(query: string, id: EngineId = getEngineId()): string {
  const engine = ENGINES.find((item) => item.id === id) ?? ENGINES[0];
  return engine.template.replace('%s', encodeURIComponent(query));
}

export type SearchBarHandle = { element: HTMLElement; input: HTMLInputElement; select: HTMLSelectElement };

/** 页面搜索框：直接搜网页，可切引擎（记住上次选择），回车即开新标签 */
export function webSearchBar(hint = '搜索网页'): SearchBarHandle {
  const select = el('select', {
    class: cn(
      'h-9 shrink-0 border border-r-0 border-[var(--c-line)] bg-[var(--c-surface)] px-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-fg',
      'hover:border-[var(--c-line-strong)] focus:border-accent focus:outline-none',
    ),
    'aria-label': '搜索引擎',
  }) as HTMLSelectElement;
  for (const engine of ENGINES) {
    const option = el('option', { value: engine.id, text: engine.name, title: engine.note });
    select.appendChild(option);
  }
  select.value = getEngineId();

  const input = el('input', {
    type: 'search',
    class: cn(
      'h-9 min-w-0 flex-1 border border-[var(--c-line)] bg-[var(--c-surface)] px-3 text-[13px] text-fg',
      'placeholder:text-[var(--c-fg-soft)] focus:border-accent focus:outline-none',
    ),
    placeholder: hint,
    autocomplete: 'off',
  }) as HTMLInputElement;

  const submit = el('button', {
    type: 'button',
    class: 'pressable flex h-9 w-9 shrink-0 items-center justify-center border border-l-0 border-[var(--c-line)] bg-[var(--c-surface)] text-[var(--c-fg-soft)] hover:bg-[var(--c-accent-soft)] hover:text-fg',
    title: '搜索',
    'aria-label': '搜索',
  });
  submit.appendChild(icon('search', { size: 15, stroke: 1.8 }));

  const run = (): void => {
    const query = input.value.trim();
    if (!query) {
      input.focus();
      return;
    }
    setEngineId(select.value as EngineId);
    const url = searchUrl(query, select.value as EngineId);
    if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer');
  };

  input.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Enter') run();
  });
  submit.addEventListener('click', run);
  select.addEventListener('change', () => setEngineId(select.value as EngineId));

  const element = el('div', { class: 'flex w-full items-stretch' }, select, input, submit);
  return { element, input, select };
}
