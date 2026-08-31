/**
 * SuenWeb — Background Service Worker (MV3)
 *
 * Architecture:
 *   Context menu:       reads server groups from /api/data, POSTs to /api/links
 *   SSE realtime:       /api/events/stream → triggers auto-backup check on server changes
 *   Auto-backup:        compares server total_links with lastBackupCount → WebDAV snapshot
 *   Manual backup:      popup button → full browser bookmarks HTML → WebDAV PUT
 *   Restore:            PROPFIND list → download → parse → import to browser
 *   New Tab override:   tabs.onCreated & onUpdated listeners → redirect new tab to server URL
 *   Watchdog:           alarm every 5min
 */

/* ── Browser API compatibility (Firefox browser.* / Chrome chrome.*) ── */
const browser = globalThis.browser || (() => {
  const c = globalThis.chrome;
  if (!c) throw new Error('WebExtension API unavailable');
  const lastError = () => c.runtime && c.runtime.lastError;
  const p = (fn, ctx) => (...args) => new Promise((resolve, reject) => {
    let settled = false;
    const cb = (res) => {
      if (settled) return;
      settled = true;
      const err = lastError();
      err ? reject(new Error(err.message)) : resolve(res);
    };
    try {
      const ret = fn.call(ctx, ...args, cb);
      if (ret && typeof ret.then === 'function') ret.then(resolve, reject);
      else if (fn.length <= args.length && !settled) resolve(ret);
    } catch (e) {
      reject(e);
    }
  });
  return {
    storage: { local: { get: p(c.storage.local.get, c.storage.local), set: p(c.storage.local.set, c.storage.local) } },
    bookmarks: {
      getTree: p(c.bookmarks.getTree, c.bookmarks),
      create: p(c.bookmarks.create, c.bookmarks),
    },
    management: c.management && {
      getAll: p(c.management.getAll, c.management),
      get: p(c.management.get, c.management),
    },
    alarms: {
      onAlarm: c.alarms.onAlarm,
      clear: p(c.alarms.clear, c.alarms),
      create: (name, info) => { c.alarms.create(name, info); return Promise.resolve(); },
    },
    contextMenus: c.contextMenus && {
      onClicked: c.contextMenus.onClicked,
      removeAll: p(c.contextMenus.removeAll, c.contextMenus),
      create: (info) => new Promise((resolve, reject) => {
        try {
          c.contextMenus.create(info, () => {
            const err = lastError();
            err ? reject(new Error(err.message)) : resolve();
          });
        } catch (e) { reject(e); }
      }),
    },
    menus: c.contextMenus,
    runtime: {
      onMessage: {
        addListener(fn) {
          c.runtime.onMessage.addListener((msg, sender, sendResponse) => {
            Promise.resolve(fn(msg, sender)).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
            return true;
          });
        }
      },
      sendMessage: p(c.runtime.sendMessage, c.runtime),
    },
    action: c.action,
    browserAction: c.browserAction,
  };
})();

const SYNC_ALARM = 'suenweb-sync-watchdog';
const WATCHDOG_MIN = 5;

/* ── Config ──────────────────────────────────────────────── */
let _cachedCfg = null;

async function cfg() {
  if (_cachedCfg) return _cachedCfg;
  const d = await browser.storage.local.get(['serverUrl', 'authToken', 'lastSync', 'lastError', 'webdavUrl', 'webdavUser', 'webdavPass', 'lastBackupCount', 'newtabEnabled']);
  _cachedCfg = {
    serverUrl: (d.serverUrl || '').replace(/\/+$/, ''),
    authToken: d.authToken || '',
    lastSync:  d.lastSync  || null,
    lastError: d.lastError || null,
    webdavUrl:  (d.webdavUrl || '').replace(/\/+$/, ''),
    webdavUser: d.webdavUser || '',
    webdavPass: d.webdavPass || '',
    lastBackupCount: d.lastBackupCount || 0,
    newtabEnabled: !!d.newtabEnabled,
  };
  return _cachedCfg;
}

async function saveCfg(patch) {
  if (_cachedCfg) {
    Object.assign(_cachedCfg, patch);
    if (patch.serverUrl !== undefined) _cachedCfg.serverUrl = (patch.serverUrl || '').replace(/\/+$/, '');
    if (patch.webdavUrl !== undefined) _cachedCfg.webdavUrl = (patch.webdavUrl || '').replace(/\/+$/, '');
  }
  await browser.storage.local.set(patch);
}

// Preload config cache
cfg().catch(() => {});

// Listen for storage changes from popup or other contexts
const _storageApi = (globalThis.chrome && globalThis.chrome.storage) || (globalThis.browser && globalThis.browser.storage);
if (_storageApi && _storageApi.onChanged) {
  _storageApi.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (!_cachedCfg) _cachedCfg = {};
      for (const key in changes) {
        _cachedCfg[key] = changes[key].newValue;
      }
      if (_cachedCfg.serverUrl) _cachedCfg.serverUrl = _cachedCfg.serverUrl.replace(/\/+$/, '');
      if (_cachedCfg.webdavUrl) _cachedCfg.webdavUrl = _cachedCfg.webdavUrl.replace(/\/+$/, '');
    }
  });
}

/* ── WebDAV backup ──────────────────────────────────────── */
let _backupDebounce = null;

function _backupFileName(count) {
  // Format: YYMMDD-COUNT-seq (260607-114-0, 260607-114-1)
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `suenweb-${yy}${mm}${dd}-${count}-`;
}

async function _backupBookmarksHTML() {
  const tree = await browser.bookmarks.getTree();
  const html = _bookmarksToHTML(tree);
  return new Blob(['<!DOCTYPE NETSCAPE-Bookmark-file-1>\n' +
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n' +
    '<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n' +
    html + '</DL><p>\n'], { type: 'text/html' });
}

function _countBookmarks(nodes) {
  let n = 0;
  for (const node of nodes) {
    if (node.url) n++;
    if (node.children) n += _countBookmarks(node.children);
  }
  return n;
}

async function backupToWebDAV() {
  const c = await cfg();
  if (!c.webdavUrl || !c.webdavUser) return;

  // Debounce for auto-triggers
  if (_backupDebounce) clearTimeout(_backupDebounce);
  _backupDebounce = setTimeout(() => _doBackup(c), 3000);
}

async function _doBackup(c, count) {
  if (count == null) {
    const tree = await browser.bookmarks.getTree();
    count = _countBookmarks(tree);
  }
  const blob = await _backupBookmarksHTML();
  const auth = btoa(`${c.webdavUser}:${c.webdavPass}`);
  const headers = { 'Authorization': `Basic ${auth}` };

  // 坚果云 etc. need a subdirectory — use base + /SuenWeb/
  const dir = c.webdavUrl.replace(/\/$/, '') + '/SuenWeb';
  const prefix = _backupFileName(count);
  const filename = prefix + '0.html';
  const url = `${dir}/${filename}`;

  // Ensure directory exists
  try { await fetch(dir, { method: 'MKCOL', headers }); } catch {}

  // Upload
  const resp = await fetch(url, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'text/html' },
    body: blob
  });
  if (!resp.ok) throw new Error(`WebDAV ${resp.status}`);

  const now = new Date().toISOString();
  await saveCfg({ lastBackupAt: now });
  console.log(`[SuenWeb] backup: ${filename} (${count} bookmarks)`);
}

/* ── Manual backup ───────────────────────────────────────── */
async function manualBackup() {
  const c = await cfg();
  if (!c.webdavUrl || !c.webdavUser) throw new Error('WebDAV 未配置');
  await _doBackup(c);
  const tree = await browser.bookmarks.getTree();
  const count = _countBookmarks(tree);
  return { ok: true, name: _backupFileName(count) + '0.html', count };
}

/* ── List backups from WebDAV ────────────────────────────── */
async function listBackups() {
  const c = await cfg();
  if (!c.webdavUrl || !c.webdavUser) return { ok: false, error: 'WebDAV 未配置' };
  const base = c.webdavUrl.replace(/\/$/, '') + '/SuenWeb';
  const auth = btoa(`${c.webdavUser}:${c.webdavPass}`);

  // PROPFIND to list .html files
  const body = `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:getlastmodified/>
    <d:getcontentlength/>
  </d:prop>
</d:propfind>`;

  const resp = await fetch(base, {
    method: 'PROPFIND',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/xml', 'Depth': '1' },
    body
  });
  if (!resp.ok) return { ok: false, error: `WebDAV ${resp.status}` };

  const xml = await resp.text();
  // Parse href, getlastmodified, getcontentlength
  const entries = [];
  const re = /<d:response>([\s\S]*?)<\/d:response>/g;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const href = (block.match(/<d:href>(.*?)<\/d:href>/) || [])[1] || '';
    const name = href.split('/').pop().split('?')[0];
    if (!name || !name.endsWith('.html') || !name.startsWith('suenweb-')) continue;
    const mod = (block.match(/<d:getlastmodified>(.*?)<\/d:getlastmodified>/) || [])[1] || '';
    const sizeRaw = (block.match(/<d:getcontentlength>(.*?)<\/d:getcontentlength>/) || [])[1] || '0';
    const size = parseInt(sizeRaw);
    entries.push({
      name,
      href,
      date: mod ? new Date(mod).toLocaleString('zh-CN') : '—',
      size: size > 1024 ? (size / 1024).toFixed(1) + ' KB' : size + ' B',
      _date: mod ? new Date(mod).getTime() : 0,
    });
  }
  entries.sort((a, b) => b._date - a._date);
  return { ok: true, backups: entries };
}

/* ── Restore backup from WebDAV ──────────────────────────── */
async function restoreBackup(index) {
  const c = await cfg();
  if (!c.webdavUrl || !c.webdavUser) return { ok: false, error: 'WebDAV 未配置' };
  const listResult = await listBackups();
  if (!listResult.ok) return listResult;
  const backups = listResult.backups;
  if (index < 0 || index >= backups.length) return { ok: false, error: '无效的备份索引' };

  const entry = backups[index];
  const base = c.webdavUrl;
  const auth = btoa(`${c.webdavUser}:${c.webdavPass}`);

  // Download the backup file
  const resp = await fetch(entry.href || `${base}/${entry.name}`, {
    headers: { 'Authorization': `Basic ${auth}` }
  });
  if (!resp.ok) return { ok: false, error: `下载失败: ${resp.status}` };

  const html = await resp.text();

  // Parse and import
  const imported = await _importBookmarksHTML(html);
  return { ok: true, count: imported, name: entry.name };
}

async function _importBookmarksHTML(html) {
  const links = _parseBookmarksHTMLFlat(html);

  const tree = await browser.bookmarks.getTree();
  const roots = tree[0]?.children || [];
  const other = roots.find(r => r.title === '其他书签' || r.title === 'Other bookmarks')
            || roots[roots.length - 1];
  if (!other || links.length === 0) return 0;
  const folder = await browser.bookmarks.create({ parentId: other.id, title: 'SuenWeb 恢复' });
  let count = 0;
  for (const item of links) {
    try {
      await browser.bookmarks.create({ parentId: folder.id, title: item.title || item.url, url: item.url });
      count++;
    } catch {}
  }
  return count;
}

function _decodeHtml(s) {
  return String(s || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function _parseBookmarksHTMLFlat(html) {
  const links = [];
  const re = /<A\b[^>]*\bHREF=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/A>/gi;
  let m;
  while ((m = re.exec(html))) {
    const url = _decodeHtml(m[2]).trim();
    const title = _decodeHtml(m[3].replace(/<[^>]*>/g, '')).trim() || url;
    if (/^(https?|ftp):\/\//i.test(url)) links.push({ title, url });
  }
  return links;
}

function _bookmarksToHTML(nodes, depth = 0) {
  let html = '';
  const indent = '    '.repeat(depth);
  for (const node of nodes) {
    if (node.url) {
      html += `${indent}<DT><A HREF="${_escAttr(node.url)}" ADD_DATE="${Math.floor(node.dateAdded / 1000)}">${_escHtml(node.title)}</A>\n`;
    } else if (node.children) {
      html += `${indent}<DT><H3 ADD_DATE="${Math.floor(node.dateAdded / 1000)}" LAST_MODIFIED="${Math.floor((node.dateGroupModified || node.dateAdded) / 1000)}">${_escHtml(node.title)}</H3>\n`;
      html += `${indent}<DL><p>\n`;
      html += _bookmarksToHTML(node.children, depth + 1);
      html += `${indent}</DL><p>\n`;
    }
  }
  return html;
}

function _escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function _escAttr(s) { return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

/* ── API helpers ─────────────────────────────────────────── */
async function apiFetch(path, opts = {}) {
  const c = await cfg();
  if (!c.serverUrl || !c.authToken) {
    throw new Error('未配置服务器或令牌');
  }
  const headers = {
    'Content-Type': 'application/json',
    ...opts.headers,
    'Authorization': `Bearer ${c.authToken}`
  };
  const resp = await fetch(`${c.serverUrl}${path}`, { ...opts, headers });
  if (resp.status === 401) throw new Error('令牌无效 (401)');
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.detail || body.error || `HTTP ${resp.status}`);
  }
  return resp;
}

async function loginServer(serverUrl, password) {
  const base = String(serverUrl || '').replace(/\/+$/, '');
  const resp = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.detail || data.error || `HTTP ${resp.status}`);
  return data.token || password;
}

/* ── Sync check + auto-backup ────────────────────────────── */
let _syncInFlight = null;
async function runSync({ source = 'manual' } = {}) {
  if (_syncInFlight) return _syncInFlight;
  _syncInFlight = (async () => {
    const c = await cfg();
    if (!c.serverUrl || !c.authToken) return { ok: false };
    try {
      // Check server link count, trigger backup if changed
      if (c.webdavUrl) {
        try {
          const sr = await fetch(`${c.serverUrl}/api/sync/status`, {
            headers: { 'Authorization': `Bearer ${c.authToken}` }
          });
          if (sr.ok) {
            const sd = await sr.json();
            const serverCount = sd.total_links || 0;
            fetch(`${c.serverUrl}/api/sync/heartbeat`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${c.authToken}` }
            }).catch(() => {});
            if (serverCount !== c.lastBackupCount) {
              console.log(`[SuenWeb] auto-backup: server ${serverCount} vs last ${c.lastBackupCount}`);
              _doBackup(c, serverCount).catch(() => {});
              await saveCfg({ lastBackupCount: serverCount });
            }
          }
        } catch {}
      }
      const now = new Date().toISOString();
      await saveCfg({ lastSync: now, lastError: null });
      refreshContextMenu();
      console.log(`[SuenWeb] check (${source}): links=${c.lastBackupCount}`);
      return { ok: true };
    } catch (e) {
      console.error('[SuenWeb] check error:', e);
      return { ok: false, error: e.message };
    } finally {
      _syncInFlight = null;
    }
  })();
  return _syncInFlight;
}

/* ── API helpers ─────────────────────────────────────────── */

/* ── Realtime SSE listener ──────────────────────────────── */
let _sseAbort = null;
let _sseRetryTimer = null;
let _sseConnected = false;

function startEventStream() {
  stopEventStream();
  cfg().then(c => {
    if (!c.serverUrl || !c.authToken) return;
    connectSSE();
  });
}

function stopEventStream() {
  if (_sseAbort) { try { _sseAbort.abort(); } catch {} _sseAbort = null; }
  if (_sseRetryTimer) { clearTimeout(_sseRetryTimer); _sseRetryTimer = null; }
  _sseConnected = false;
}

async function connectSSE() {
  const c = await cfg();
  if (!c.serverUrl || !c.authToken) return;
  try {
    _sseAbort = new AbortController();
    const resp = await fetch(`${c.serverUrl}/api/events/stream`, {
      headers: { 'Authorization': `Bearer ${c.authToken}` },
      signal: _sseAbort.signal,
    });
    if (!resp.ok) throw new Error(`SSE ${resp.status}`);
    _sseConnected = true;
    broadcastConnectionState(true);
    await badge('●', '#7c6ff7', '实时');
    console.log('[SuenWeb] SSE connected');

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const events = buf.split('\n\n');
      buf = events.pop() || '';
      for (const evt of events) {
        const lines = evt.split('\n');
        let eventName = 'message', data = '';
        for (const line of lines) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (eventName === 'change' && data) {
          try {
            const msg = JSON.parse(data);
            if (!msg.kind) continue;

            if (msg.kind === 'link_created' || msg.kind === 'link_updated' || msg.kind === 'link_deleted' || msg.kind === 'group_deleted') {
              // Server data changed → check for auto-backup
              console.log(`[SuenWeb] SSE: ${msg.kind}`);
              runSync({ source: 'sse' });
            } else if (msg.kind === 'sync_imported') {
              console.log(`[SuenWeb] SSE: sync_imported count=${msg.payload?.imported}`);
            }
          } catch (parseErr) {
            console.warn('[SuenWeb] SSE parse error:', parseErr);
          }
        }
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
    _sseConnected = false;
    broadcastConnectionState(false);
    console.warn('[SuenWeb] SSE disconnected, retrying in 10s:', e.message);
    _sseRetryTimer = setTimeout(connectSSE, 10000);
  }
}

/* ── Broadcast to popup ──────────────────────────────────── */
async function broadcast(msg) {
  try {
    await browser.runtime.sendMessage({ kind: 'broadcast', payload: msg });
  } catch (e) { /* popup closed, ignore */ }
}

async function broadcastConnectionState(connected) {
  await broadcast({ type: 'connection', connected });
}

/* ── Badge helpers ──────────────────────────────────────── */
async function badge(text, color, title) {
  const api = browser.action || browser.browserAction;
  if (!api) return;
  try {
    await api.setBadgeText({ text });
    if (color) await api.setBadgeBackgroundColor({ color });
    if (title !== undefined) await api.setBadgeTitle({ title: `SuenWeb Sync · ${title}` });
  } catch {}
}

/* ── Watchdog alarm ─────────────────────────────────────── */
browser.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === SYNC_ALARM) {
    if (!_sseConnected) startEventStream();
    runSync({ source: 'watchdog' });
  }
});

async function setupAlarm() {
  await browser.alarms.clear(SYNC_ALARM);
  browser.alarms.create(SYNC_ALARM, { periodInMinutes: WATCHDOG_MIN });
}

/* ═══════════════════════════════════════════════════════════
 *  CONTEXT MENU — Right-click → Bookmark to SuenWeb
 * ═══════════════════════════════════════════════════════════ */
const _menus = browser.contextMenus || browser.menus;

/**
 * Fetch server groups to populate the right-click context menu.
 * Falls back to local browser bookmark folders if server is unreachable.
 */
async function fetchServerGroups() {
  const c = await cfg();
  if (!c.serverUrl) return [];

  try {
    const resp = await fetch(`${c.serverUrl}/api/data`);
    if (!resp.ok) return [];
    const data = await resp.json();
    const names = (data.groups || []).map(g => g.name).filter(Boolean);
    if (names.length > 0) {
      console.log(`[SuenWeb] context menu: ${names.length} server groups loaded`);
      return names;
    }
  } catch (e) {
    console.warn('[SuenWeb] context menu: could not fetch server groups, falling back to local', e.message);
  }
  return [];
}

/**
 * Fetch local browser bookmark folders as fallback for context menu.
 */
async function fetchLocalFolders() {
  const folders = [];
  try {
    const tree = await browser.bookmarks.getTree();
    function collect(nodes) {
      for (const n of nodes) {
        if (n.children && n.children.some(c => c.url)) {
          folders.push(n.title || '未命名');
        }
        if (n.children) collect(n.children);
      }
    }
    collect(tree);
  } catch (e) {
    console.warn('[SuenWeb] context menu: could not read local bookmarks', e);
  }
  return folders;
}

async function setupContextMenu() {
  if (!_menus) return;
  try { await _menus.removeAll(); } catch {}

  // Priority: server groups → local browser folders
  let groups = await fetchServerGroups();
  if (groups.length === 0) {
    groups = await fetchLocalFolders();
  }

  if (groups.length === 0) {
    await _menus.create({
      id: 'suenweb-no-groups',
      title: '收藏到 SuenWeb (暂无分组)',
      contexts: ['page'],
    });
    return;
  }

  // Parent menu
  await _menus.create({
    id: 'suenweb-bookmark',
    title: '收藏到 SuenWeb',
    contexts: ['page'],
  });

  // Sub-items per group
  for (const name of groups) {
    await _menus.create({
      id: `bm-${name}`,
      parentId: 'suenweb-bookmark',
      title: name,
      contexts: ['page'],
    });
  }
}

// refreshContextMenu = setupContextMenu (re-reads server groups)
const refreshContextMenu = setupContextMenu;

if (_menus && _menus.onClicked) {
  _menus.onClicked.addListener(async (info, tab) => {
    const mid = info.menuItemId;
    if (!mid || !mid.startsWith('bm-')) return;
    const groupName = mid.replace('bm-', '');
    if (!tab || !tab.url) return;
    const url = tab.url;
    const title = tab.title || url;

    console.log(`[SuenWeb] context menu: bookmarking "${title}" to group "${groupName}"`);

    const c = await cfg();

    // 1. POST to server → creates link in group (auto-creates group if needed)
    if (c.serverUrl && c.authToken) {
      try {
        const resp = await fetch(`${c.serverUrl}/api/links`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${c.authToken}`,
          },
          body: JSON.stringify({
            group_name: groupName,
            group_type: 'pinned',
            title: title,
            url: url,
          }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          console.warn('[SuenWeb] context menu: server error', err);
        } else {
          console.log(`[SuenWeb] context menu: server OK for "${title}"`);
        }
      } catch (e) {
        console.warn('[SuenWeb] context menu: POST /api/links error', e);
      }
    }

    // Trigger WebDAV backup
    backupToWebDAV();
  });
}

/* ── Extension backup / restore ─────────────────────────── */
const CRXSOSO_BASE = 'https://www.crxsoso.com/webstore/detail/';
const RESTORE_MAX_TABS = 10;

function selfExtId() {
  const rt = (globalThis.browser && globalThis.browser.runtime) || (globalThis.chrome && globalThis.chrome.runtime);
  return rt ? rt.id : '';
}

function storeUrlFor(extId) {
  return CRXSOSO_BASE + extId;
}

function currentBrowserType() {
  return /Firefox/i.test(navigator.userAgent) ? 'firefox' : 'chrome';
}

async function collectInstalledExtensions() {
  const management = (globalThis.browser && globalThis.browser.management) || globalThis.chrome.management;
  const all = await management.getAll();
  const selfId = selfExtId();
  const isChromium = currentBrowserType() === 'chrome';
  const list = [];
  for (const e of all) {
    if (e.type !== 'extension') continue;
    if (e.id === selfId) continue;                                   // skip SuenWeb Sync itself
    if (isChromium && e.installType !== 'normal' && e.installType !== 'admin') continue; // skip dev/builtin
    list.push({
      ext_id: e.id,
      name: e.name || e.id,
      version: e.version || '',
      url: storeUrlFor(e.id),
    });
  }
  list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

async function backupExtensions() {
  const c = await cfg();
  if (!c.serverUrl || !c.authToken) throw new Error('未配置服务器或令牌');
  const extensions = await collectInstalledExtensions();
  const resp = await fetch(`${c.serverUrl}/api/extensions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${c.authToken}` },
    body: JSON.stringify({ browser: currentBrowserType(), extensions }),
  });
  if (!resp.ok) {
    const b = await resp.json().catch(() => ({}));
    throw new Error(b.detail || `HTTP ${resp.status}`);
  }
  const now = new Date().toISOString();
  await saveCfg({ lastExtBackupAt: now, lastExtBackupCount: extensions.length });
  return { ok: true, count: extensions.length };
}

async function restoreExtensions() {
  const c = await cfg();
  if (!c.serverUrl || !c.authToken) throw new Error('未配置服务器或令牌');
  const resp = await fetch(`${c.serverUrl}/api/extensions`, {
    headers: { 'Authorization': `Bearer ${c.authToken}` }
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  const entries = data.extensions || [];
  if (!entries.length) return { ok: true, total: 0, installed: 0, opened: 0 };

  const management = (globalThis.browser && globalThis.browser.management) || globalThis.chrome.management;
  const all = await management.getAll();
  const installedIds = new Set(all.filter(e => e.type === 'extension').map(e => e.id));

  let installed = 0;
  const missing = [];
  for (const it of entries) {
    if (installedIds.has(it.ext_id)) installed++;
    else missing.push(it);
  }

  const tabsApi = (globalThis.browser && globalThis.browser.tabs) ? globalThis.browser.tabs : globalThis.chrome.tabs;
  let opened = 0;
  for (const it of missing.slice(0, RESTORE_MAX_TABS)) {
    try {
      await tabsApi.create({ url: it.url || storeUrlFor(it.ext_id) });
      opened++;
    } catch {}
  }
  return { ok: true, total: entries.length, installed, opened, skipped: missing.length - opened };
}

/* ── Messages from popup/options ────────────────────────── */
browser.runtime.onMessage.addListener(async (msg) => {
  switch (msg.action) {
    case 'getStatus': {
      const c = await cfg();
      return {
        configured: !!(c.serverUrl && c.authToken),
        lastSync: c.lastSync,
        lastError: c.lastError,
        serverUrl: c.serverUrl,
        realtimeConnected: _sseConnected,
      };
    }
    case 'updateConfig': {
      const s = {};
      if (msg.serverUrl !== undefined) s.serverUrl = msg.serverUrl;
      if (msg.authToken !== undefined) s.authToken = msg.authToken;
      if (msg.webdavUrl !== undefined) s.webdavUrl = msg.webdavUrl;
      if (msg.webdavUser !== undefined) s.webdavUser = msg.webdavUser;
      if (msg.webdavPass !== undefined) s.webdavPass = msg.webdavPass;
      if (Object.keys(s).length) await saveCfg(s);
      // Reconnect SSE with new config, refresh context menu
      startEventStream();
      refreshContextMenu();
      return { ok: true };
    }
    case 'updateNewtab': {
      await saveCfg({ newtabEnabled: !!msg.enabled });
      return { ok: true };
    }
    case 'loginServer':
      return { ok: true, token: await loginServer(msg.serverUrl, msg.password) };
    case 'manualBackup':
      try { return await manualBackup(); } catch(e) { return { ok: false, error: e.message }; }
    case 'listBackups':
      return await listBackups();
    case 'restoreBackup':
      return await restoreBackup(msg.index);
    case 'testWebDAV':
      return await testWebDAV();
    case 'backupExtensions':
      try { return await backupExtensions(); } catch(e) { return { ok: false, error: e.message }; }
    case 'restoreExtensions':
      try { return await restoreExtensions(); } catch(e) { return { ok: false, error: e.message }; }
    default:
      return null;
  }
});

/* ── Test WebDAV connection ─────────────────────────────── */
async function testWebDAV() {
  const c = await cfg();
  if (!c.webdavUrl || !c.webdavUser) return { ok: false, error: 'WebDAV 未配置' };
  const base = c.webdavUrl.replace(/\/$/, '') + '/SuenWeb';
  const auth = btoa(`${c.webdavUser}:${c.webdavPass}`);
  try {
    // Test 1: PROPFIND on root (check connectivity)
    const resp = await fetch(c.webdavUrl, {
      method: 'PROPFIND',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/xml', 'Depth': '0' },
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>'
    });
    if (resp.status === 401 || resp.status === 403) return { ok: false, error: '认证失败，检查用户名密码' };
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };

    // Test 2: Ensure backup directory and verify write access
    try {
      // Create backup directory
      try { await fetch(base, { method: 'MKCOL', headers: { 'Authorization': `Basic ${auth}` } }); } catch {}
      const testUrl = `${base}/.suenweb-test`;
      const tr = await fetch(testUrl, {
        method: 'PUT',
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'text/plain' },
        body: 'ok'
      });
      if (tr.ok) {
        await fetch(testUrl, { method: 'DELETE', headers: { 'Authorization': `Basic ${auth}` } });
        return { ok: true, writable: true };
      }
      return { ok: true, writable: false, status: tr.status };
    } catch {
      return { ok: true, writable: false };
    }
  } catch (e) {
    return { ok: false, error: '无法连接: ' + e.message };
  }
}

/* ═══════════════════════════════════════════════════════════
 *  NEW TAB OVERRIDE
 * ═══════════════════════════════════════════════════════════ */
const _redirectingTabs = new Set();

function isNewTabUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const u = url.toLowerCase().trim();
  return (
    u === 'chrome://newtab/' ||
    u === 'chrome://newtab' ||
    u === 'chrome://new-tab-page/' ||
    u === 'chrome://new-tab-page' ||
    u.startsWith('chrome-search://local-ntp') ||
    u === 'edge://newtab/' ||
    u === 'edge://newtab' ||
    u === 'about:newtab' ||
    u === 'about:home'
  );
}

async function handleNewTabRedirect(tabId, tabUrl, pendingUrl) {
  if (!tabId) return;
  if (_redirectingTabs.has(tabId)) return;

  const candidateUrl = pendingUrl || tabUrl || '';
  if (candidateUrl && !isNewTabUrl(candidateUrl)) {
    return;
  }

  const c = await cfg();
  if (!c.newtabEnabled || !c.serverUrl) return;

  let urlToCheck = candidateUrl;
  const tabsApi = (globalThis.chrome && globalThis.chrome.tabs) || (globalThis.browser && globalThis.browser.tabs);
  if (!tabsApi) return;

  if (!urlToCheck) {
    try {
      const curTab = await new Promise(resolve => {
        tabsApi.get(tabId, t => {
          if (chrome.runtime?.lastError) resolve(null);
          else resolve(t);
        });
      });
      if (curTab) {
        urlToCheck = curTab.pendingUrl || curTab.url || '';
      }
    } catch {}
  }

  if (isNewTabUrl(urlToCheck)) {
    _redirectingTabs.add(tabId);
    try {
      await new Promise(resolve => {
        tabsApi.update(tabId, { url: c.serverUrl }, () => {
          if (chrome.runtime?.lastError) {}
          resolve();
        });
      });
    } catch (e) {
      console.warn('[SuenWeb] newtab redirect failed:', e);
    } finally {
      setTimeout(() => _redirectingTabs.delete(tabId), 1500);
    }
  }
}

// Synchronous top-level listener registrations (critical for MV3 wake-up)
const _tabs = (globalThis.chrome && globalThis.chrome.tabs) || (globalThis.browser && globalThis.browser.tabs);
if (_tabs) {
  if (_tabs.onCreated) {
    _tabs.onCreated.addListener((tab) => {
      handleNewTabRedirect(tab.id, tab.url, tab.pendingUrl);
    });
  }
  if (_tabs.onUpdated) {
    _tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      const url = changeInfo.url || tab?.pendingUrl || tab?.url || '';
      if (url && isNewTabUrl(url)) {
        handleNewTabRedirect(tabId, tab?.url, changeInfo.url || tab?.pendingUrl);
      }
    });
  }
  if (_tabs.onRemoved) {
    _tabs.onRemoved.addListener((tabId) => {
      _redirectingTabs.delete(tabId);
    });
  }
}

/* ── Init ────────────────────────────────────────────────── */
async function init() {
  await setupAlarm();
  await setupContextMenu();

  // Connect SSE and do initial status check
  setTimeout(async () => {
    const c = await cfg();
    if (c.serverUrl && c.authToken) {
      startEventStream();
      await runSync({ source: 'startup' });
      await refreshContextMenu();
    }
  }, 1000);
}

init();
