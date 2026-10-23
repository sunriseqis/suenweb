/* SuenWeb 快速收藏：MV3 事件页（Firefox 优先，Chrome/Edge 同源）
 * 核心时序：先写进浏览器书签，成功后才向服务端 ack；失败回报 ok=false，绝不提前确认。
 */
const SYNC_ALARM = 'suenweb-sync';
const ROOT_FOLDER = 'SuenWeb';
const DEFAULTS = { baseUrl: '', token: '', device: 'firefox' };

async function getConfig() {
  const stored = await browser.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...stored, baseUrl: String(stored.baseUrl || '').replace(/\/+$/, '') };
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
    throw error;
  }
  return payload.data;
}

async function rootParentId() {
  const tree = await browser.bookmarks.getTree();
  const root = tree[0];
  const other = (root.children || []).find((node) => /other|unfiled/i.test(node.id));
  return other ? other.id : root.id;
}

async function ensureFolder(parentId, title) {
  const children = await browser.bookmarks.getChildren(parentId);
  const found = children.find((node) => !node.url && node.title === title);
  if (found) return found.id;
  const created = await browser.bookmarks.create({ parentId, title });
  return created.id;
}

async function setBadge(count) {
  if (!browser.action || !browser.action.setBadgeText) return;
  try {
    await browser.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    await browser.action.setBadgeBackgroundColor({ color: '#1BA1E2' });
  } catch {
    // Firefox 未授予 badge 权限时忽略
  }
}

async function syncPending() {
  const cfg = await getConfig();
  if (!cfg.baseUrl || !cfg.token) return { skipped: true, reason: 'not-configured' };
  const [pending, data] = await Promise.all([call(cfg, '/api/sync/pending'), call(cfg, '/api/data')]);
  const groupNames = new Map((data.groups || []).map((group) => [group.id, group.name]));
  const rootId = await ensureFolder(await rootParentId(), ROOT_FOLDER);
  const folders = new Map();
  const okIds = [];
  const badIds = [];

  for (const link of pending.links || []) {
    try {
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

  if (okIds.length > 0) await call(cfg, '/api/sync/ack', { method: 'POST', body: JSON.stringify({ ids: okIds, ok: true }) });
  if (badIds.length > 0) await call(cfg, '/api/sync/ack', { method: 'POST', body: JSON.stringify({ ids: badIds, ok: false }) });
  await setBadge(badIds.length);
  return { synced: okIds.length, failed: badIds.length };
}

async function saveLink(tab, groupId) {
  const cfg = await getConfig();
  if (!cfg.baseUrl || !cfg.token) throw new Error('先在扩展设置里登录 SuenWeb');
  if (!tab || !tab.url || /^(about|chrome|moz-extension|edge|file):/i.test(tab.url)) {
    throw new Error('这个页面不能收藏');
  }
  const created = await call(cfg, '/api/links', {
    method: 'POST',
    body: JSON.stringify({ group_id: groupId, url: tab.url, title: tab.title || tab.url }),
  });
  const rootId = await ensureFolder(await rootParentId(), ROOT_FOLDER);
  const data = await call(cfg, '/api/data');
  const group = (data.groups || []).find((item) => item.id === created.link.group_id);
  const folderId = await ensureFolder(rootId, group ? group.name : '未分组');
  // 只有真正写进浏览器后才 ack
  await browser.bookmarks.create({ parentId: folderId, title: created.link.title, url: created.link.url });
  await call(cfg, '/api/sync/ack', { method: 'POST', body: JSON.stringify({ ids: [created.link.id], ok: true }) });
  return created.link;
}

async function refreshBadge() {
  const cfg = await getConfig();
  if (!cfg.baseUrl || !cfg.token) return;
  try {
    const status = await call(cfg, '/api/sync/status');
    await setBadge(status.pending || 0);
  } catch {
    await setBadge(0);
  }
}

browser.runtime.onInstalled.addListener(async () => {
  browser.alarms.create(SYNC_ALARM, { periodInMinutes: 5 });
  browser.contextMenus.create({
    id: 'suenweb-save',
    title: '收藏到 SuenWeb',
    contexts: ['page', 'link'],
  });
  await refreshBadge();
});

browser.runtime.onStartup.addListener(() => {
  browser.alarms.create(SYNC_ALARM, { periodInMinutes: 5 });
});

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) syncPending().catch(() => {});
});

browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'suenweb-save' || !tab) return;
  getConfig()
    .then((cfg) => call(cfg, '/api/data'))
    .then((data) => {
      const groups = data.groups || [];
      const first = groups.find((group) => group.type === 'fixed') || groups[0];
      return saveLink(tab, first ? first.id : null);
    })
    .catch(() => {});
});

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const done = (promise) => {
    promise
      .then((value) => sendResponse({ ok: true, data: value }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  };
  if (message && message.type === 'capture') {
    return done(browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => saveLink(tab, message.groupId)));
  }
  if (message && message.type === 'sync') return done(syncPending());
  if (message && message.type === 'status') return done(getConfig().then((cfg) => call(cfg, '/api/sync/status')));
  if (message && message.type === 'groups') return done(getConfig().then((cfg) => call(cfg, '/api/data')));
  return false;
});
