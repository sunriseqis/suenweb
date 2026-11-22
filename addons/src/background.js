/* SuenWeb 快速收藏：MV3 事件页（Firefox 优先，Chrome/Edge 同源）
 * 核心时序：先写进浏览器书签，成功后才向服务端 ack；失败回报 ok=false，绝不提前确认。
 */
const browser = globalThis.browser ?? globalThis.chrome;
const SYNC_ALARM = 'suenweb-sync';
const ROOT_FOLDER = 'SuenWeb';
const SETUP_FLAG = 'setupDone';
const DEFAULTS = { baseUrl: '', token: '', device: 'firefox', setupDone: false };

// ---- SSE 实时同步：服务端变化立刻拉取 pending，断线指数退避重连 ----
let eventSource = null;
let retryCount = 0;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

function connectEvents() {
  disconnectEvents();
  getConfig()
    .then((cfg) => {
    if (!cfg.baseUrl || !cfg.token) return;
    eventSource = new EventSource(cfg.baseUrl + '/api/events/stream?token=' + encodeURIComponent(cfg.token), {
      // EventSource 不支持自定义 header；服务端 M11 起要求鉴权，token 走 URL query 兜底。
      // 这里仅作为「有变化」信号，取数仍走带 token 的 fetch。
      //
      // P2-6 TODO: token 出现在 URL query 会被服务端 access log、代理、浏览器历史记录到，
      // 存在泄露风险。需要服务端配合改用 fetch + ReadableStream 的流式响应（fetch 支持自定义
      // Authorization header，且能读 SSE 字节流），届时本处的 EventSource 一并替换为 fetch 流。
      // 服务端改动前，这里保持现状——note：当前 baseUrl 默认 http://，token 本就明文过网，
      // query 形式只是再增加了一处记录面，不是新增泄露渠道。
    });
    eventSource.onopen = () => {
      // 重连成功后退避计数归零，避免一次故障后永远用最大间隔重连
      retryCount = 0;
    };
    eventSource.addEventListener('links-changed', () => {
      syncPending().catch(() => {});
    });
    eventSource.onerror = () => {
      disconnectEvents();
      const delay = Math.min(1000 * 2 ** retryCount, MAX_BACKOFF_MS);
      retryCount += 1;
      // P1-13: 用 alarm 而非 setTimeout，跨 SW 生命周期存活
      browser.alarms.create('suenweb-sse-reconnect', { when: Date.now() + delay });
    };
    })
    .catch(() => {});
}

function disconnectEvents() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

function normalizeBaseUrl(raw) {
  let url = String(raw || '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

async function getConfig() {
  const stored = await browser.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...stored, baseUrl: normalizeBaseUrl(stored.baseUrl) };
}

async function call(cfg, path, options = {}) {
  if (!cfg.baseUrl) throw new Error('未配置服务端地址');
  const response = await fetch(cfg.baseUrl + path, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(cfg.token ? { authorization: 'Bearer ' + cfg.token } : {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!payload || payload.ok !== true) {
    const error = new Error(payload && payload.error ? payload.error.message : 'HTTP ' + response.status);
    error.code = payload && payload.error ? payload.error.code : 'HTTP_' + response.status;
    error.details = payload && payload.error ? payload.error.details : undefined;
    throw error;
  }
  return payload.data;
}

// 解析「可写入」的顶层文件夹，指向「其他书签」。
// Chrome/Edge 根节点 id="0" 不可写，往它下面 create 会报 "Can't modify the root bookmark folders."
const OTHER_FOLDER_TITLE = /other\s*bookmarks?|unfiled|weitere\s*lesezeichen|autres\s*marqueurs|其他书签|その他/i;

async function rootParentId() {
  const tree = await browser.bookmarks.getTree();
  const root = (tree && tree[0]) || {};
  const rootId = String(root.id ?? '0');
  // 收集所有非根的顶层文件夹（排除 root 自身与任何父级是 root 的不可写节点）
  const children = (root.children || []).filter((node) => node && String(node.id) !== rootId && node.id !== '0');
  // 多级兜底：folderType → unfiled* → id '2' → 标题 → 位序
  const candidates = [
    ...children.filter((n) => n.folderType === 'other'),      // Chrome 新版语义字段
    ...children.filter((n) => /^unfiled/i.test(String(n.id))), // Firefox: unfiled_____
    ...children.filter((n) => String(n.id) === '2'),           // Chromium 固定 id：其他书签
    ...children.filter((n) => OTHER_FOLDER_TITLE.test(n.title || '')), // 标题兜底（多语言）
    children[1], // 位序兜底（书签栏, 其他书签, 移动端书签）
    children[0],
  ].filter(Boolean);
  const target = candidates.find((n) => String(n.id) !== rootId && String(n.id) !== '0');
  if (!target) {
    throw new Error('找不到可写入的浏览器书签文件夹（其他书签），请在浏览器书签管理器里检查');
  }
  return String(target.id);
}

async function ensureFolder(parentId, title) {
  // 硬性防线：绝不允许往根节点写入（Chrome id="0"，Firefox 同）
  if (parentId === undefined || parentId === null || String(parentId) === '' || String(parentId) === '0') {
    throw new Error('找不到可写入的浏览器书签文件夹（其他书签），请在浏览器书签管理器里检查');
  }
  const children = await browser.bookmarks.getChildren(parentId);
  const found = children.find((node) => !node.url && node.title === title);
  if (found) return found.id;
  const created = await browser.bookmarks.create({ parentId, title });
  return created.id;
}

async function setBadge(count) {
  // MV3 用 browser.action，MV2 用 browser.browserAction
  const action = browser.action || browser.browserAction;
  if (!action || !action.setBadgeText) return;
  try {
    await action.setBadgeText({ text: count > 0 ? String(count) : '' });
    await action.setBadgeBackgroundColor({ color: '#1BA1E2' });
  } catch {
    // Firefox 未授予 badge 权限时忽略
  }
}

let syncing = false;

// P2-8: 原 32 位 DJB2 哈希易碰撞，可能误判「清单未变」导致漏报；
// 改用双 32 位组合（64 位）+ 全局盐，降低碰撞概率同时不依赖 crypto.subtle 的异步 API。
const HASH_SALT = 'suenweb-ext-manifest-v2';
function simpleHash(text) {
  const input = HASH_SALT + '\u0000' + text;
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 = ((h1 << 5) + h1 + c) >>> 0;
    h2 = (((h2 << 5) + h2) ^ c) >>> 0;
  }
  return String(h1) + String(h2); // 64 位组合
}

async function syncPending() {
  if (syncing) return { skipped: true, reason: 'syncing' };
  syncing = true;
  try {
  const cfg = await getConfig();
  if (!cfg.baseUrl || !cfg.token) return { skipped: true, reason: 'not-configured' };
  const [pending, data] = await Promise.all([call(cfg, '/api/sync/pending'), call(cfg, '/api/data')]);
  const groupNames = new Map((data.groups || []).map((group) => [group.id, group.name]));
  const rootId = await ensureFolder(await rootParentId(), ROOT_FOLDER);
  // 幂等：先收集 SuenWeb 子树下已有书签的 url 集合，已存在的跳过 create 仍计入 okIds，
  // 避免 ack 失败后下一轮重复创建。
  const existingUrls = new Set();
  try {
    // P0-L: 只遍历 SuenWeb 子树，不扫描全书签树
    const walkSuenweb = async (parentId) => {
      const children = await browser.bookmarks.getChildren(parentId);
      for (const node of children) {
        if (node.url) existingUrls.add(node.url);
        if (!node.url) await walkSuenweb(node.id);
      }
    };
    await walkSuenweb(rootId);
  } catch {
    // 读不到书签树时不做幂等判断，按原逻辑创建
  }
  const folders = new Map();
  const okIds = [];
  const badIds = [];

  for (const link of pending.links || []) {
    try {
      if (existingUrls.has(link.url)) {
        okIds.push(link.id);
        continue;
      }
      const groupName = groupNames.get(link.group_id) || '未分组';
      let folderId = folders.get(groupName);
      if (!folderId) {
        folderId = await ensureFolder(rootId, groupName);
        folders.set(groupName, folderId);
      }
      await browser.bookmarks.create({ parentId: folderId, title: link.title || link.url, url: link.url });
      okIds.push(link.id);
    } catch {
      badIds.push(link.id);
    }
  }

  // P0-I: ack 分片，避免超 500 条被 schema 拒绝
  const ACK_CHUNK = 400;
  for (let i = 0; i < okIds.length; i += ACK_CHUNK) {
    await call(cfg, '/api/sync/ack', { method: 'POST', body: JSON.stringify({ ids: okIds.slice(i, i + ACK_CHUNK), ok: true }) });
  }
  for (let i = 0; i < badIds.length; i += ACK_CHUNK) {
    await call(cfg, '/api/sync/ack', { method: 'POST', body: JSON.stringify({ ids: badIds.slice(i, i + ACK_CHUNK), ok: false }) });
  }
  await refreshBadge();
  // 顺手上报扩展清单：清单内容与上次一致时跳过（静默失败，不影响主同步）
  try {
    const extensions = await collectExtensions();
    const manifest = JSON.stringify({ browser: currentBrowser(), extensions });
    const hash = simpleHash(manifest);
    const stored = await browser.storage.local.get({ extManifestHash: '' });
    if (stored.extManifestHash !== hash) {
      await call(cfg, '/api/extensions', { method: 'POST', body: manifest });
      await browser.storage.local.set({ extManifestHash: hash });
    }
  } catch {
    // 下次同步再试
  }
  return { synced: okIds.length, failed: badIds.length };
  } finally {
    syncing = false;
  }
}

/** target 可以是 tab（含 url/title）或 {url,title}（右键链接场景） */
async function saveLink(target, groupId, onDuplicate) {
  const cfg = await getConfig();
  if (!cfg.baseUrl || !cfg.token) throw new Error('先在扩展设置里登录 SuenWeb');
  const url = target && target.url ? String(target.url) : '';
  if (!url || /^(about|chrome|moz-extension|edge|file|data):/i.test(url)) {
    throw new Error('这个页面不能收藏');
  }
  let groupNameForReturn = '未分组';
  const created = await call(cfg, '/api/links', {
    method: 'POST',
    body: JSON.stringify({ group_id: groupId, url, title: (target && target.title) || url, on_duplicate: onDuplicate }),
  });
  // P0-G: merged/skipped 分支——服务端未新建，跳过 bookmarks.create，不发 ack
  if (created.merged || created.skipped) {
    return { ...created.link, group_name: groupNameForReturn, merged: Boolean(created.merged), skipped: Boolean(created.skipped) };
  }
  // 服务端 /api/links 已成功；此后 /api/data 或 bookmarks.create 若失败，链接只存在
  // 于服务端。失败时主动调一次 syncPending()，下一轮会把该 pending 链接补写进浏览器，
  // 避免本机书签树永久缺失。闭环：服务端有 → sync/pending 仍返回它 → syncPending 补建书签 → ack。
  try {
    const rootId = await ensureFolder(await rootParentId(), ROOT_FOLDER);
    const data = await call(cfg, '/api/data');
    const group = (data.groups || []).find((item) => item.id === created.link.group_id);
    groupNameForReturn = group ? group.name : '未分组';
    const folderId = await ensureFolder(rootId, group ? group.name : '未分组');
    // P0-H: URL 查重，避免重复创建（仅在 SuenWeb 子树下查重）
    const existing = await browser.bookmarks.search({ url: created.link.url }).catch(() => []);
    const alreadyInSuenweb = existing.some((node) => node.parentId === folderId || node.parentId === rootId);
    if (!alreadyInSuenweb) {
      await browser.bookmarks.create({ parentId: folderId, title: created.link.title, url: created.link.url });
    }
    await call(cfg, '/api/sync/ack', { method: 'POST', body: JSON.stringify({ ids: [created.link.id], ok: true }) });
  } catch (error) {
    void syncPending().catch(() => {});
    throw error;
  }
  return { ...created.link, group_name: groupNameForReturn };
}

/** 未登录：点图标直接进设置页引导登录；已登录：点图标弹分组选择 */
async function syncPopupAvailability() {
  const action = browser.action || browser.browserAction;
  if (!action || !action.setPopup) return;
  const cfg = await getConfig();
  const configured = Boolean(cfg.baseUrl && cfg.token);
  try {
    // P2-4: 从 manifest 动态读取 popup 路径，避免硬编码 'src/popup.html' 在重命名/移位后失效
    const manifest = browser.runtime.getManifest();
    const popupPath = manifest.action?.default_popup || manifest.browser_action?.default_popup || 'src/popup.html';
    await action.setPopup({ popup: configured ? popupPath : '' });
  } catch {
    // setPopup 不可用时保持 manifest 默认
  }
}

async function refreshBadge() {
  const cfg = await getConfig();
  if (!cfg.baseUrl || !cfg.token) return;
  try {
    const status = await call(cfg, '/api/sync/status');
    await setBadge(status.pending || 0);
  } catch {
    await setBadge('!'); // 显示错误标记，而非清零误导用户
  }
}


browser.runtime.onInstalled.addListener(async () => {
  browser.alarms.create(SYNC_ALARM, { periodInMinutes: 5 });
  await refreshBadge();
  await syncPopupAvailability();
  const stored = await browser.storage.local.get({ setupDone: false });
  if (!stored.setupDone) {
    await browser.storage.local.set({ setupDone: true });
    browser.runtime.openOptionsPage();
  }
  connectEvents();
});

browser.runtime.onStartup.addListener(() => {
  browser.alarms.create(SYNC_ALARM, { periodInMinutes: 5 });
  void syncPopupAvailability();
  connectEvents();
});

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) {
    syncPending().catch(() => {});
    connectEvents();
    getConfig()
      .then((cfg) => call(cfg, '/api/sync/heartbeat', { method: 'POST', body: JSON.stringify({ device: currentBrowser() + '-extension' }) }))
      .catch(() => {});
  }
  // P1-13: SSE 重连 alarm
  if (alarm.name === 'suenweb-sse-reconnect') {
    connectEvents();
  }
  // P1-13: REDIRECT_LOCK 清理 alarm
  if (alarm.name.startsWith('suenweb-redirect-lock-')) {
    const tabId = parseInt(alarm.name.slice('suenweb-redirect-lock-'.length), 10);
    REDIRECT_LOCK.delete(tabId);
  }
});

// ---- CAP-05 新标签页：改用 chrome_settings_overrides 声明式接管（见 manifest 与 src/newtab.html）----
// 用户可在 Firefox 新标签页右上角一键恢复默认；options 的 newtabEnabled 开关控制跳转页行为
// 未登录时点图标（popup 已置空）→ 直接打开设置页
const actionApi = browser.action || browser.browserAction;
if (actionApi && actionApi.onClicked) {
  actionApi.onClicked.addListener(() => {
    void browser.runtime.openOptionsPage();
  });
}


// ---- CAP-05 新标签页跳转（恢复旧版双监听模式：onCreated + onUpdated 补新窗口首标签漏触发）----
const NEWTAB_PATTERNS = [
  'about:newtab', 'about:home',
  'chrome://newtab/', 'chrome://newtab', 'chrome://new-tab-page/',
  'edge://newtab/',
];
const REDIRECT_LOCK = new Set();

async function handleNewTab(tab) {
  try {
    const stored = await browser.storage.local.get({ newtabEnabled: false, baseUrl: '' });
    if (!stored.newtabEnabled || !stored.baseUrl) return;
    const url = String(tab.pendingUrl || tab.url || '').toLowerCase();
    if (!url || !NEWTAB_PATTERNS.some((p) => url.startsWith(p))) return;
    if (REDIRECT_LOCK.has(tab.id)) return;
    REDIRECT_LOCK.add(tab.id);
    await browser.tabs.update(tab.id, { url: stored.baseUrl.replace(/\/+$/, '') + '/' });
    // P1-13: 用 alarm 清理锁，跨 SW 生命周期存活
    browser.alarms.create('suenweb-redirect-lock-' + tab.id, { when: Date.now() + 2000 });
  } catch {}
}

// 双监听：onCreated 抓 Ctrl+T；onUpdated 抓新窗口首标签（onCreated 可能漏 pendingUrl）
if (browser.tabs && browser.tabs.onCreated) browser.tabs.onCreated.addListener((tab) => void handleNewTab(tab));
if (browser.tabs && browser.tabs.onUpdated) {
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.status === 'loading') void handleNewTab({ ...tab, id: tabId, pendingUrl: changeInfo.url || tab?.pendingUrl });
  });
}

// ---- 扩展清单备份 / 还原（EXT-01 / EXT-03）----
const STORE_BASE = {
  firefox: 'https://addons.mozilla.org',
  chrome: 'https://chromewebstore.google.com',
  edge: 'https://microsoftedge.microsoft.com',
};

function currentBrowser() {
  const ua = navigator.userAgent || '';
  if (/firefox/i.test(ua)) return 'firefox';
  if (/edg\//i.test(ua)) return 'edge';
  return 'chrome';
}

function storeUrlFor(entry) {
  const browser = currentBrowser();
  const name = encodeURIComponent(entry.name || '');
  const id = String(entry.ext_id || '');
  if (browser === 'firefox') {
    if (/^[a-z0-9.@-]+$/i.test(id) && !id.startsWith('{')) return STORE_BASE.firefox + '/firefox/addon/' + id + '/';
    return STORE_BASE.firefox + '/firefox/search/?q=' + name;
  }
  if (browser === 'edge') return STORE_BASE.edge + '/addons/search/' + name;
  return STORE_BASE.chrome + '/detail/' + id;
}

async function collectExtensions() {
  const management = browser.management;
  if (!management || !management.getAll) return [];
  const all = await management.getAll();
  const selfId = browser.runtime.id;
  const browserKind = currentBrowser();
  const list = [];
  for (const item of all) {
    if (item.type !== 'extension') continue;
    if (item.id === selfId) continue;
    if (browserKind !== 'firefox' && item.installType && item.installType !== 'normal' && item.installType !== 'admin') continue;
    list.push({ ext_id: item.id, name: item.name || item.id, version: item.version || '' });
  }
  list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

async function reportExtensions() {
  const cfg = await getConfig();
  if (!cfg.baseUrl || !cfg.token) throw new Error('先在扩展设置里登录 SuenWeb');
  const extensions = await collectExtensions();
  const result = await call(cfg, '/api/extensions', { method: 'POST', body: JSON.stringify({ browser: currentBrowser(), extensions }) });
  return { count: result.total, extensions };
}

const RESTORE_MAX_TABS = 10;

// P2-2: entry.url 来自服务端，不能直接信任——只允许打开官方商店域名，否则回退到 storeUrlFor
const STORE_DOMAINS = ['addons.mozilla.org', 'chromewebstore.google.com', 'microsoftedge.microsoft.com'];

async function restoreExtensions() {
  const cfg = await getConfig();
  if (!cfg.baseUrl || !cfg.token) throw new Error('先在扩展设置里登录 SuenWeb');
  const list = await call(cfg, '/api/extensions');
  const mine = (list.byBrowser && list.byBrowser[currentBrowser()]) || [];
  const management = browser.management;
  const installedIds = new Set();
  if (management && management.getAll) {
    const all = await management.getAll();
    for (const ext of all) {
      if (ext.type === 'extension' && ext.id) installedIds.add(ext.id);
    }
  }
  // 与本机实际安装的 id 集合对比（服务端条目没有 installed 字段，不能拿它判断）
  const installed = mine.filter((entry) => installedIds.has(entry.ext_id)).length;
  const missing = mine.filter((entry) => !installedIds.has(entry.ext_id));
  const opened = Math.min(missing.length, RESTORE_MAX_TABS);
  const tabsApi = browser.tabs;
  for (const entry of missing.slice(0, RESTORE_MAX_TABS)) {
    const url = entry.url || storeUrlFor(entry);
    let safeUrl = null;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        // P2-2: 只允许商店域名，防止服务端被污染后指向钓鱼站
        const isStoreDomain = STORE_DOMAINS.some((d) => parsed.hostname === d || parsed.hostname.endsWith('.' + d));
        if (isStoreDomain) safeUrl = parsed.href;
        else safeUrl = storeUrlFor(entry); // 回退到商店搜索链接
      }
    } catch {
      safeUrl = storeUrlFor(entry);
    }
    if (!safeUrl) continue;
    try {
      await tabsApi.create({ url: safeUrl });
    } catch {
      // 打不开就跳过，计数已含
    }
  }
  return { total: mine.length, installed, opened, skipped: missing.length - opened };
}

// ---- 书签 API 错误中文化 ----
// Chromium 的书签错误是写死的英文，原样弹到弹窗里用户看不懂；这里统一翻译，未收录的保留原文。
// P2-5: 原实现用 raw.includes(pattern) 精确匹配，对英文原文的标点/大小写/空白极其脆弱
// （例如 "Can't modify the root bookmark folders." vs "Cannot modify the root bookmark folders"）。
// 这里对 pattern 与 error message 都做「去标点 + 折叠空白 + 小写」归一化后再匹配，鲁棒得多。
const BOOKMARK_ERRORS = [
  ["Can't modify the root bookmark folders.", '浏览器不允许修改根书签目录（书签栏/其他书签/移动端书签本身不能改名、移动或删除）'],
  ['Bookmark editing is disabled.', '浏览器已禁用书签编辑（可能由企业策略控制）'],
  ["Can't modify managed bookmarks.", '该书签由企业策略托管，不能修改'],
  ["Can't find bookmark for id.", '书签已不存在，可能被删除或移动了'],
  ["Can't find parent bookmark for id.", '找不到要写入的书签文件夹，可能已被删除'],
  ["Can't remove non-empty folder (use recursive to force).", '该文件夹不是空的，不能直接删除'],
  ['Bookmark id is invalid.', '书签 ID 无效'],
  ['Index out of bounds.', '书签插入位置超出范围'],
  ["Parameter 'parentId' does not specify a folder.", '目标位置不是书签文件夹'],
  ['Invalid URL.', '网址无效，无法收藏'],
  ["Can't set URL of a bookmark folder.", '不能给书签文件夹设置网址'],
  ["Can't move a folder to itself or its descendant.", '不能把文件夹移动到它自己或它的子文件夹里'],
];

function friendlyBookmarkError(error) {
  const raw = error && typeof error.message === 'string' ? error.message : String(error || '');
  const normalize = (s) => s.toLowerCase().replace(/[.\s]+/g, ' ').trim();
  const normalized = normalize(raw);
  const hit = BOOKMARK_ERRORS.find(([pattern]) => normalized.includes(normalize(pattern)));
  return hit ? hit[1] : raw;
}

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const done = (promise) => {
    promise
      .then((value) => sendResponse({ ok: true, data: value }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: friendlyBookmarkError(error),
          code: error && error.code,
          details: error && error.details,
        });
      });
    return true;
  };
  if (message && message.type === 'capture') {
    return done((async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      try {
        return await saveLink(tab, message.groupId, message.onDuplicate);
      } catch (error) {
        // 跨组重复：把服务端 details 原样带回，让 popup 弹确认
        if (error.code === 'CROSS_GROUP_DUPLICATE') {
          error.details = error.details ?? null;
          throw error;
        }
        throw error;
      }
    })());
  }
  if (message && message.type === 'sync') return done(syncPending());
  if (message && message.type === 'status') return done(getConfig().then((cfg) => call(cfg, '/api/sync/status')));
  if (message && message.type === 'groups') return done(getConfig().then((cfg) => call(cfg, '/api/data')));
  if (message && message.type === 'config') {
    return done(getConfig().then((cfg) => ({
      configured: Boolean(cfg.baseUrl && cfg.token),
      hasBaseUrl: Boolean(cfg.baseUrl),
      hasToken: Boolean(cfg.token),
      baseUrl: cfg.baseUrl,
    })));
  }
  if (message && message.type === 'report-extensions') return done(reportExtensions());
  if (message && message.type === 'restore-extensions') return done(restoreExtensions());
  if (message && message.type === 'config-saved') {
    retryCount = 0;
    void browser.storage.local.remove('extManifestHash').catch(() => {});
    connectEvents();
    void syncPopupAvailability();
    return done(syncPending());
  }
  return false;
});
