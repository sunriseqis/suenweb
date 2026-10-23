// 无浏览器的 DOM 冒烟测：验证事件真的挂上了（.click() 能触发回调）
// 用法：npm run check:dom（依赖 devDependency happy-dom）
import { Window } from 'happy-dom';

const window = new Window({ url: 'http://localhost/' });
globalThis.window = window;
globalThis.document = window.document;
globalThis.Node = window.Node;
globalThis.HTMLElement = window.HTMLElement;
globalThis.SVGElement = window.SVGElement;
globalThis.Element = window.Element;
globalThis.CustomEvent = window.CustomEvent;
document.body.innerHTML = '<div id="capsule-root"></div>';

const { el } = await import('../src/lib/dom.ts');
const { mountCapsule } = await import('../src/ui/capsule.ts');
const { renderBookmarks } = await import('../src/pages/bookmarks.ts');
const { ENGINES, searchUrl, getEngineId } = await import('../src/ui/websearch.ts');

const hits = [];
const failures = [];
const expect = (name, ok, detail = '') => {
  if (!ok) failures.push(name + (detail ? ' -> ' + detail : ''));
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' -> ' + detail : ''));
};

const probe = el('button', { onClick: () => hits.push('el-onClick') });
probe.click();
expect('el() 的 onClick 能触发', hits.includes('el-onClick'));

mountCapsule([
  { key: 'edit', label: '编辑模式', iconName: 'lock', onClick: () => hits.push('capsule-edit') },
  { key: 'settings', label: '设置', iconName: 'settings', onClick: () => hits.push('capsule-settings') },
  { key: 'logout', label: '登出', iconName: 'logout', onClick: () => hits.push('capsule-logout') },
]);
const capsuleButtons = Array.from(document.querySelectorAll('#capsule-root button'));
expect('胶囊渲染出 3 个按钮', capsuleButtons.length === 3, String(capsuleButtons.length));
capsuleButtons.forEach((node) => node.click());
expect('胶囊按钮可点击', hits.filter((h) => h.startsWith('capsule-')).length === 3, hits.join(','));
const bar = document.querySelector('#capsule-root .capsule');
expect('胶囊自身可接收指针事件', Boolean(bar && bar.className.includes('pointer-events-auto')));

const link = { id: 1, group_id: 1, title: 'T', url: 'https://a.example.com', url_normalized: 'https://a.example.com', description: null, icon: null, icon_type: 'auto', sort_order: 10, sync_state: 'synced', created_at: '', updated_at: '' };
const group = { id: 1, name: '置顶组', name_key: 'p', icon: null, type: 'fixed', display_mode: 'grid', layout_mode: 'auto', sort_order: 10, created_at: '', updated_at: '', links: [link] };
const tabGroup = { ...group, id: 2, name: '普通组', name_key: 't', type: 'tab', display_mode: 'icon', links: [{ ...link, id: 2, group_id: 2 }] };
const pageHits = [];
const page = renderBookmarks({
  groups: [group, tabGroup],
  authed: true,
  editing: true,
  fetchIcons: false,
  activeTabId: null,
  onTab: (id) => pageHits.push('tab:' + id),
  onAddLink: () => pageHits.push('addLink'),
  onEditLink: () => pageHits.push('editLink'),
  onDeleteLink: () => pageHits.push('deleteLink'),
  onMoveLink: () => pageHits.push('move'),
  onReorder: () => pageHits.push('reorder'),
  onAddGroup: () => pageHits.push('addGroup'),
  onEditGroup: () => pageHits.push('editGroup'),
  onDeleteGroup: () => pageHits.push('deleteGroup'),
  onTogglePin: () => pageHits.push('togglePin'),
  onDisplayMode: () => pageHits.push('displayMode'),
  onLayoutMode: () => pageHits.push('layoutMode'),
  onLogin: () => pageHits.push('login'),
});
document.body.appendChild(page);
for (const node of Array.from(page.querySelectorAll('button[aria-label]'))) node.click();
for (const key of ['togglePin', 'displayMode', 'addLink', 'editGroup', 'deleteGroup', 'editLink', 'deleteLink', 'move']) {
  expect('页面操作可点击: ' + key, pageHits.includes(key));
}


expect('搜索引擎不少于 7 个', ENGINES.length >= 7, String(ENGINES.length));
expect('默认引擎是 Google', getEngineId() === 'google', getEngineId());
expect('URL 模板正确编码', searchUrl('a b', 'duckduckgo') === 'https://duckduckgo.com/?q=a%20b', searchUrl('a b', 'duckduckgo'));
expect('含隐私型引擎', ['brave', 'startpage', 'mojeek', 'qwant'].every((id) => ENGINES.some((e) => e.id === id)));
const engineSelect = page.querySelector('select[aria-label="搜索引擎"]');
expect('页面渲染出引擎选择器', Boolean(engineSelect), engineSelect ? String(engineSelect.options.length) : 'missing');
const tabButton = page.querySelector('[role=tab]');
tabButton.click();
expect('tab 切换可点击', pageHits.includes('tab:2'), pageHits.join(','));

console.log('---');
console.log('failed', failures.length);
process.exit(failures.length === 0 ? 0 : 1);
