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
/* ── WebDAV backup ──────────────────────────────────────── */
let _backupDebounce = null;

function _formatBackupDate() {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return { dateStr: `${yy}${mm}${dd}`, timeStr: `${hh}${min}${ss}` };
}

function _bookmarksToNetscapeHTML(nodes) {
  const html = _bookmarksToHTML(nodes);
  return '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n' +
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n' +
    '<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n' +
    html + '</DL><p>\n';
}

function _countBookmarks(nodes) {
  let n = 0;
  for (const node of nodes) {
    if (node.url) n++;
    if (node.children) n += _countBookmarks(node.children);
  }
  return n;
}

function _davAuth(c) {
  const user = String(c.webdavUser || '');
  const pass = String(c.webdavPass || '');
  try {
    return 'Basic ' + btoa(unescape(encodeURIComponent(`${user}:${pass}`)));
  } catch {
    return 'Basic ' + btoa(`${user}:${pass}`);
  }
}

function _davFailReason(resp) {
  if (resp.redirected) return `请求被重定向到 ${resp.url}（请检查 WebDAV 地址是否精确到目录）`;
  if (resp.status === 401 || resp.status === 403) return `认证失败 (HTTP ${resp.status})`;
  if (resp.status === 404) return '目录或路径不存在 (HTTP 404)';
  if (resp.status === 409) return '冲突或父目录不存在 (HTTP 409)';
  if (resp.status === 507) return '存储空间不足 (HTTP 507)';
  return `HTTP ${resp.status} ${resp.statusText || ''}`.trim();
}

async function _davPut(primaryUrl, fallbackUrl, contentType, content, headers) {
  let resp;
  try {
    resp = await fetch(primaryUrl, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': contentType },
      body: content
    });
    if (resp.ok && !resp.redirected) return { ok: true, url: primaryUrl };
  } catch (e) {
    if (!fallbackUrl) throw e;
  }

  // If primary url failed (404/409/etc.) and fallback url is available, try fallback
  if (fallbackUrl && (!resp || resp.status === 404 || resp.status === 409 || !resp.ok)) {
    const resp2 = await fetch(fallbackUrl, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': contentType },
      body: content
    });
    if (resp2.ok && !resp2.redirected) return { ok: true, url: fallbackUrl };
    throw new Error(_davFailReason(resp2));
  }

  if (!resp) throw new Error('网络请求失败');
  throw new Error(_davFailReason(resp));
}

async function backupToWebDAV() {
  const c = await cfg();
  if (!c.webdavUrl || !c.webdavUser) return;

  if (_backupDebounce) clearTimeout(_backupDebounce);
  _backupDebounce = setTimeout(() => {
    _doBackup(c).then(r => {
      if (r.errors && r.errors.length) console.warn('[SuenWeb] auto-backup partial errors:', r.errors);
    }).catch(e => console.warn('[SuenWeb] auto-backup failed:', e));
  }, 3000);
}

async function _doBackup(c, bookmarkCount) {
  if (bookmarkCount == null) {
    try {
      const tree = await browser.bookmarks.getTree();
      bookmarkCount = _countBookmarks(tree);
    } catch {
      bookmarkCount = 0;
    }
  }

  const rawBase = String(c.webdavUrl || '').trim().replace(/\/+$/, '');
  if (!rawBase) throw new Error('WebDAV 地址未配置');

  const auth = _davAuth(c);
  const headers = { 'Authorization': auth };

  // Resolve directory: if URL already points to SuenWeb, use it; otherwise prefer subfolder SuenWeb
  const isAlreadySuenWeb = rawBase.toLowerCase().endsWith('/suenweb');
  const targetDir = isAlreadySuenWeb ? rawBase : `${rawBase}/SuenWeb`;

  if (!isAlreadySuenWeb) {
    try {
      await fetch(targetDir, { method: 'MKCOL', headers });
    } catch {}
  }

  const { dateStr, timeStr } = _formatBackupDate();
  const results = { app: null, bookmarks: null, extensions: null, errors: [], uploaded: 0 };

  // 1. Synchronize & Backup SuenWeb App Data (Full JSON snapshot: groups, links, settings, wallpapers, fonts, ext_repo)
  if (c.serverUrl && c.authToken) {
    try {
      const resp = await apiFetch('/api/config/export');
      const appData = await resp.json();
      const appFileName = `suenweb-app-${dateStr}-${timeStr}.json`;
      const jsonStr = JSON.stringify(appData, null, 2);
      const primUrl = `${targetDir}/${appFileName}`;
      const fbUrl = isAlreadySuenWeb ? null : `${rawBase}/${appFileName}`;

      await _davPut(primUrl, fbUrl, 'application/json; charset=utf-8', jsonStr, headers);
      results.app = appFileName;
      results.uploaded++;
      console.log(`[SuenWeb] app data backup OK: ${appFileName}`);
    } catch (e) {
      results.errors.push(`应用数据: ${e.message}`);
      console.warn('[SuenWeb] app data backup failed:', e);
    }
  }

  // 2. Backup Browser Bookmarks (HTML)
  try {
    const tree = await browser.bookmarks.getTree();
    const htmlContent = _bookmarksToNetscapeHTML(tree);
    const bmFileName = `suenweb-bookmarks-${dateStr}-${bookmarkCount}.html`;
    const primUrl = `${targetDir}/${bmFileName}`;
    const fbUrl = isAlreadySuenWeb ? null : `${rawBase}/${bmFileName}`;

    await _davPut(primUrl, fbUrl, 'text/html; charset=utf-8', htmlContent, headers);
    results.bookmarks = bmFileName;
    results.uploaded++;
    console.log(`[SuenWeb] bookmarks backup OK: ${bmFileName}`);
  } catch (e) {
    results.errors.push(`书签: ${e.message}`);
    console.warn('[SuenWeb] bookmarks backup failed:', e);
  }

  // 3. Backup Installed Browser Extensions
  try {
    const exts = await collectInstalledExtensions();
    if (exts && exts.length) {
      const extFileName = `suenweb-extensions-${dateStr}.json`;
      const extJson = JSON.stringify({ browser: currentBrowserType(), exported_at: new Date().toISOString(), extensions: exts }, null, 2);
      const primUrl = `${targetDir}/${extFileName}`;
      const fbUrl = isAlreadySuenWeb ? null : `${rawBase}/${extFileName}`;

      await _davPut(primUrl, fbUrl, 'application/json; charset=utf-8', extJson, headers);
      results.extensions = extFileName;
      results.uploaded++;
      console.log(`[SuenWeb] extensions backup OK: ${extFileName}`);
    }
  } catch (e) {
    results.errors.push(`扩展列表: ${e.message}`);
    console.warn('[SuenWeb] extensions WebDAV backup failed:', e);
  }

  if (results.uploaded > 0) {
    const now = new Date().toISOString();
    await saveCfg({ lastBackupAt: now });
  } else {
    const errDetail = results.errors.join('；') || '远端无法写入';
    throw new Error(`WebDAV 上传失败: ${errDetail}`);
  }

  return results;
}

/* ── Manual backup ───────────────────────────────────────── */
async function manualBackup() {
  const c = await cfg();
  if (!c.webdavUrl || !c.webdavUser) throw new Error('WebDAV 未配置');
  const r = await _doBackup(c);
  const tree = await browser.bookmarks.getTree();
  const count = _countBookmarks(tree);
  return {
    ok: r.uploaded > 0,
    partial: r.uploaded > 0 && r.errors.length > 0,
    appName: r.app,
    bmName: r.bookmarks,
    extName: r.extensions,
    errors: r.errors,
    count
  };
}

/* ── List backups from WebDAV ────────────────────────────── */
async function listBackups() {
  const c = await cfg();
  if (!c.webdavUrl || !c.webdavUser) return { ok: false, error: 'WebDAV 未配置' };
  const rawBase = String(c.webdavUrl || '').trim().replace(/\/+$/, '');
  const isAlreadySuenWeb = rawBase.toLowerCase().endsWith('/suenweb');
  const targetDir = isAlreadySuenWeb ? rawBase : `${rawBase}/SuenWeb`;
  const auth = _davAuth(c);

  const body = `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:getlastmodified/>
    <d:getcontentlength/>
  </d:prop>
</d:propfind>`;

  // Try querying targetDir first; if 404, fallback to rawBase
  let resp = await fetch(targetDir, {
    method: 'PROPFIND',
    headers: { 'Authorization': auth, 'Content-Type': 'application/xml', 'Depth': '1' },
    body
  });
  let activeDir = targetDir;
  if (!resp.ok && !isAlreadySuenWeb) {
    const resp2 = await fetch(rawBase, {
      method: 'PROPFIND',
      headers: { 'Authorization': auth, 'Content-Type': 'application/xml', 'Depth': '1' },
      body
    });
    if (resp2.ok) {
      resp = resp2;
      activeDir = rawBase;
    }
  }

  if (!resp.ok) return { ok: false, error: `WebDAV ${resp.status} (${resp.statusText || '无法读取目录'})` };

  const xml = await resp.text();
  const entries = [];
  const tag = (name) => new RegExp(`<(?:[\\w.-]+:)?${name}[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>`, 'i');
  const re = /<(?:[\w.-]+:)?response[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?response>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const rawHref = (block.match(tag('href')) || [])[1] || '';
    const rawName = rawHref.split('/').pop().split('?')[0];
    let name = rawName;
    try { name = decodeURIComponent(rawName); } catch {}
    if (!name || (!name.endsWith('.html') && !name.endsWith('.json')) || !name.startsWith('suenweb-')) continue;

    let category = 'bookmarks';
    let label = '📑 浏览器书签';
    if (name.startsWith('suenweb-app-') || (name.endsWith('.json') && !name.startsWith('suenweb-extensions-'))) {
      category = 'app';
      label = '🌐 SuenWeb 应用全量数据';
    } else if (name.startsWith('suenweb-extensions-')) {
      category = 'extensions';
      label = '🧩 浏览器扩展备份';
    }

    const mod = (block.match(tag('getlastmodified')) || [])[1] || '';
    const sizeRaw = (block.match(tag('getcontentlength')) || [])[1] || '0';
    const size = parseInt(sizeRaw) || 0;
    entries.push({
      name,
      href: rawHref,
      category,
      label,
      date: mod ? new Date(mod).toLocaleString('zh-CN') : '—',
      size: size > 1024 ? (size / 1024).toFixed(1) + ' KB' : size + ' B',
      _date: mod ? new Date(mod).getTime() : 0,
    });
  }
  entries.sort((a, b) => b._date - a._date);
  return { ok: true, backups: entries, activeDir };
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
  const auth = _davAuth(c);

  // Safely resolve download URL
  let downloadUrl;
  if (entry.href && entry.href.startsWith('http')) {
    downloadUrl = entry.href;
  } else if (entry.href && entry.href.startsWith('/')) {
    const origin = new URL(c.webdavUrl).origin;
    downloadUrl = origin + entry.href;
  } else {
    const dir = listResult.activeDir || c.webdavUrl.replace(/\/+$/, '');
    downloadUrl = `${dir}/${entry.name}`;
  }

  const resp = await fetch(downloadUrl, {
    headers: { 'Authorization': auth }
  });
  if (!resp.ok) return { ok: false, error: `下载失败: ${resp.status} (${resp.statusText || ''})` };

  const content = await resp.text();

  // 1. If App Data Backup (JSON)
  if (entry.category === 'app' || (entry.name.endsWith('.json') && !entry.name.startsWith('suenweb-extensions-'))) {
    if (!c.serverUrl || !c.authToken) {
      return { ok: false, error: '请先配置 SuenWeb 服务器地址与令牌' };
    }
    const jsonData = JSON.parse(content);
    const r = await apiFetch('/api/config/import', {
      method: 'POST',
      body: JSON.stringify(jsonData)
    });
    const rData = await r.json().catch(() => ({}));
    return {
      ok: true,
      type: 'app',
      count: rData.imported?.groups || 0,
      links: rData.imported?.links || 0,
      name: entry.name
    };
  }

  // 2. If Extensions Backup (JSON)
  if (entry.category === 'extensions' || entry.name.startsWith('suenweb-extensions-')) {
    if (!c.serverUrl || !c.authToken) {
      return { ok: false, error: '请先配置 SuenWeb 服务器地址与令牌' };
    }
    const extData = JSON.parse(content);
    await apiFetch('/api/extensions', {
      method: 'POST',
      body: JSON.stringify(extData)
    });
    return {
      ok: true,
      type: 'extensions',
      count: extData.extensions?.length || 0,
      name: entry.name
    };
  }

  // 3. If Bookmarks Backup (HTML)
  const imported = await _importBookmarksHTML(content);
  return { ok: true, type: 'bookmarks', count: imported, name: entry.name };
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

/* ── Pull server → browser pending links ─────────────────── */
async function pullPendingLinks() {
  const c = await cfg();
  if (!c.serverUrl || !c.authToken) return;
  try {
    const resp = await apiFetch('/api/sync/pending');
    const data = await resp.json();
    const links = data.links || [];
    if (!links.length) return;

    const tree = await browser.bookmarks.getTree();
    const existing = new Set();
    (function walk(nodes) {
      for (const n of nodes || []) {
        if (n.url) existing.add(n.url);
        if (n.children) walk(n.children);
      }
    })(tree[0]?.children || []);

    const toAdd = links.filter(l => l.url && !existing.has(l.url));
    if (toAdd.length) {
      const roots = tree[0]?.children || [];
      const other = roots.find(r => r.title === '其他书签' || r.title === 'Other bookmarks') || roots[roots.length - 1];
      if (other) {
        let folder = (other.children || []).find(x => !x.url && x.title === 'SuenWeb 同步');
        if (!folder) folder = await browser.bookmarks.create({ parentId: other.id, title: 'SuenWeb 同步' });
        for (const l of toAdd) {
          try { await browser.bookmarks.create({ parentId: folder.id, title: l.title || l.url, url: l.url }); } catch {}
        }
      }
    }
    // Ack everything pending (added or already present as duplicates)
    await apiFetch('/api/sync/ack', {
      method: 'POST',
      body: JSON.stringify({ ids: links.map(l => l.id) })
    });
    console.log(`[SuenWeb] pending links: added ${toAdd.length}, acked ${links.length}`);
  } catch (e) {
    console.warn('[SuenWeb] pull pending failed:', e);
  }
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
              const br = await _doBackup(c, serverCount);
              // Only mark as backed up after a successful upload, otherwise retry on next round
              if (br.uploaded > 0) await saveCfg({ lastBackupCount: serverCount });
              if (br.errors.length) console.warn('[SuenWeb] auto-backup errors:', br.errors);
            }
          }
        } catch {}
      }
      // Pull links waiting for plugin sync (server → browser bookmarks), then ack
      await pullPendingLinks();
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
const AMO_SEARCH_BASE = 'https://addons.mozilla.org/firefox/search/?q=';
const CWS_SEARCH_BASE = 'https://chromewebstore.google.com/search/';
const RESTORE_MAX_TABS = 10;

function selfExtId() {
  const rt = (globalThis.browser && globalThis.browser.runtime) || (globalThis.chrome && globalThis.chrome.runtime);
  return rt ? rt.id : '';
}

// Firefox AMO IDs are GUIDs without a Chrome-store page → search AMO by name;
// Chrome: use the crxsoso mirror only for real Web Store IDs (32 chars a-p),
// otherwise fall back to a Web Store search by name (e.g. cross-browser restore).
function storeUrlFor(ext, browserType = currentBrowserType()) {
  const name = (ext.name && ext.name !== ext.ext_id) ? ext.name : '';
  if (browserType === 'firefox') {
    return AMO_SEARCH_BASE + encodeURIComponent(name || ext.ext_id);
  }
  if (/^[a-p]{32}$/i.test(ext.ext_id || '')) return CRXSOSO_BASE + ext.ext_id;
  return CWS_SEARCH_BASE + encodeURIComponent(name || ext.ext_id);
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
      url: storeUrlFor({ ext_id: e.id, name: e.name || e.id }),
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
  const browserType = currentBrowserType();
  let opened = 0;
  for (const it of missing.slice(0, RESTORE_MAX_TABS)) {
    // Stored URLs are Chrome-store links from the backing browser; in Firefox
    // (or for cross-browser restores) regenerate the link for this browser.
    let url;
    if (browserType === 'firefox') {
      url = storeUrlFor(it, 'firefox');
    } else {
      url = (it.url && /^https:\/\/www\.crxsoso\.com\/webstore\/detail\/[a-p]{32}\/?$/i.test(it.url))
        ? it.url
        : storeUrlFor(it, 'chrome');
    }
    try {
      await tabsApi.create({ url });
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
  const rawBase = String(c.webdavUrl || '').trim().replace(/\/+$/, '');
  const isAlreadySuenWeb = rawBase.toLowerCase().endsWith('/suenweb');
  const targetDir = isAlreadySuenWeb ? rawBase : `${rawBase}/SuenWeb`;
  const auth = _davAuth(c);

  try {
    // Test 1: PROPFIND on root (check connectivity & auth)
    const resp = await fetch(c.webdavUrl, {
      method: 'PROPFIND',
      headers: { 'Authorization': auth, 'Content-Type': 'application/xml', 'Depth': '0' },
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>'
    });
    if (resp.status === 401 || resp.status === 403) return { ok: false, error: '认证失败，请检查用户名和密码 (HTTP 401/403)' };
    if (!resp.ok && resp.status !== 405) return { ok: false, error: `连接异常: HTTP ${resp.status}` };

    // Test 2: Verify write access (create directory & write test file)
    let writable = false;
    let writeError = '';
    try {
      if (!isAlreadySuenWeb) {
        try { await fetch(targetDir, { method: 'MKCOL', headers: { 'Authorization': auth } }); } catch {}
      }
      const testUrl = `${targetDir}/.suenweb-test`;
      const tr = await fetch(testUrl, {
        method: 'PUT',
        headers: { 'Authorization': auth, 'Content-Type': 'text/plain' },
        body: 'ok'
      });
      if (tr.ok && !tr.redirected) {
        writable = true;
        await fetch(testUrl, { method: 'DELETE', headers: { 'Authorization': auth } }).catch(() => {});
      } else {
        // Try testing write to rawBase if targetDir failed
        const testUrl2 = `${rawBase}/.suenweb-test`;
        const tr2 = await fetch(testUrl2, {
          method: 'PUT',
          headers: { 'Authorization': auth, 'Content-Type': 'text/plain' },
          body: 'ok'
        });
        if (tr2.ok && !tr2.redirected) {
          writable = true;
          await fetch(testUrl2, { method: 'DELETE', headers: { 'Authorization': auth } }).catch(() => {});
        } else {
          writeError = _davFailReason(tr);
        }
      }
    } catch (we) {
      writeError = we.message;
    }

    return { ok: true, writable, error: writable ? null : writeError };
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
