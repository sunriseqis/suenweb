import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env, Group, Link } from './types';
import {
  hashPassword,
  verifyPassword,
  issueAuthToken,
  sha256Hex,
  requireAuth,
  isTokenValid
} from './auth';
import {
  getSetting,
  setSetting,
  logAction,
  notifyChange,
  getAllData,
  normalizeUrl,
  escapeHtml,
  escapeAttr
} from './db';
import { parseBookmarks } from './bookmark_parser';
import {
  generateSingleDescription,
  generateBulkDescriptions,
  checkLinksHealth,
  suggestGroupIcons
} from './ai';
import { fetchWallpaperUrl } from './wallpaper';
import { fetchFontCss, fetchFontWoff2 } from './fonts';
import { createExtensionZip, getExtensionCrx, getExtensionXpi, EXTENSION_ID } from './extensions';

const app = new Hono<{ Bindings: Env }>();

// Enable CORS
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['*'],
    exposeHeaders: ['*']
  })
);

// ═══════════════════════════════════════════════════════════
//  Auto-initialization / DB Verification Middleware
// ═══════════════════════════════════════════════════════════
let _tablesEnsured = false;
app.use('*', async (c, next) => {
  // Allow health check to pass through
  if (c.req.path === '/health') {
    return await next();
  }

  // Gracefully handle missing D1 binding
  if (!c.env.DB) {
    if (c.req.path.startsWith('/api/')) {
      return c.json(
        {
          error: 'D1 数据库未绑定',
          detail: '请在 Cloudflare 控制台 -> Workers -> suenweb -> Settings -> Bindings 中添加 D1 绑定（变量名填 DB，数据库选择 suenweb-db）'
        },
        500
      );
    }
  }

  if (!_tablesEnsured && c.env.DB) {
    try {
      await ensureDatabaseTables(c.env.DB);
      _tablesEnsured = true;
    } catch (e) {
      console.error('Failed to ensure tables:', e);
    }
  }
  return await next();
});

async function ensureDatabaseTables(db: D1Database) {
  // Migrate: add layout_mode column for databases created before it existed
  try {
    await db.prepare('SELECT layout_mode FROM groups_table LIMIT 1').first();
  } catch {
    try {
      await db.prepare("ALTER TABLE groups_table ADD COLUMN layout_mode TEXT DEFAULT 'single'").run();
    } catch (e) {
      console.warn('layout_mode migration warning:', e);
    }
  }

  // Migrate: ensure late-added tables exist on pre-existing databases
  try {
    await db.prepare('CREATE TABLE IF NOT EXISTS auth_rate (ip TEXT PRIMARY KEY, fails INTEGER DEFAULT 0, first_fail_ms INTEGER DEFAULT 0, locked_until_ms INTEGER DEFAULT 0)').run();
    await db.prepare('CREATE TABLE IF NOT EXISTS backups (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT DEFAULT (datetime(\'now\',\'localtime\')), payload TEXT NOT NULL)').run();
    await db.prepare('CREATE TABLE IF NOT EXISTS ext_repo (id INTEGER PRIMARY KEY AUTOINCREMENT, ext_id TEXT NOT NULL, name TEXT NOT NULL, version TEXT DEFAULT \'\', url TEXT DEFAULT \'\', browser TEXT DEFAULT \'chrome\', updated_at TEXT DEFAULT (datetime(\'now\',\'localtime\')), UNIQUE(ext_id, browser))').run();
  } catch (e) {
    console.warn('table migration warning:', e);
  }

  // Check if settings table exists
  const check = await db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'")
    .first();
  if (check) return;

  // Run initial creation statements
  const statements = [
    `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
    `CREATE TABLE IF NOT EXISTS groups_table (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      icon TEXT DEFAULT '',
      type TEXT DEFAULT 'tab',
      display_mode TEXT DEFAULT 'compact',
      layout_mode TEXT DEFAULT 'single',
      sort_order INTEGER DEFAULT 0,
      is_imported INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    `CREATE TABLE IF NOT EXISTS links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      description TEXT DEFAULT '',
      icon TEXT DEFAULT '',
      icon_type TEXT DEFAULT 'auto',
      sort_order INTEGER DEFAULT 0,
      is_imported INTEGER DEFAULT 0,
      synced_to_browser INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (group_id) REFERENCES groups_table(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS sync_state (id INTEGER PRIMARY KEY DEFAULT 1, last_sync_at TEXT, last_sync_from TEXT)`,
    `CREATE TABLE IF NOT EXISTS auth_tokens (token_hash TEXT PRIMARY KEY, created_at TEXT DEFAULT (datetime('now','localtime')), expires_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS auth_rate (ip TEXT PRIMARY KEY, fails INTEGER DEFAULT 0, first_fail_ms INTEGER DEFAULT 0, locked_until_ms INTEGER DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS backups (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT DEFAULT (datetime('now','localtime')), payload TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS ext_repo (id INTEGER PRIMARY KEY AUTOINCREMENT, ext_id TEXT NOT NULL, name TEXT NOT NULL, version TEXT DEFAULT '', url TEXT DEFAULT '', browser TEXT DEFAULT 'chrome', updated_at TEXT DEFAULT (datetime('now','localtime')), UNIQUE(ext_id, browser))`,
    `CREATE TABLE IF NOT EXISTS event_log (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, payload TEXT DEFAULT '{}', created_ms INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS operation_log (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, target TEXT DEFAULT '', detail TEXT DEFAULT '{}', created_at TEXT DEFAULT (datetime('now','localtime')))`,
    `CREATE TABLE IF NOT EXISTS wallpapers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, url TEXT NOT NULL, category TEXT DEFAULT 'custom', enabled INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0, source_type TEXT DEFAULT 'url', created_at TEXT DEFAULT (datetime('now','localtime')))`,
    `CREATE TABLE IF NOT EXISTS wallpaper_state (id INTEGER PRIMARY KEY DEFAULT 1, current_url TEXT DEFAULT '', current_index INTEGER DEFAULT 0, current_image_idx INTEGER DEFAULT 0, last_refresh_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS fonts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, family TEXT NOT NULL, category TEXT DEFAULT 'builtin', cdn_url TEXT NOT NULL, language TEXT DEFAULT 'zh', sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now','localtime')))`,
    `CREATE TABLE IF NOT EXISTS icon_cache (domain TEXT PRIMARY KEY, content TEXT NOT NULL, content_type TEXT DEFAULT 'image/x-icon', source_url TEXT DEFAULT '', updated_at TEXT DEFAULT (datetime('now','localtime')))`,
    `CREATE TABLE IF NOT EXISTS steamgriddb_cache (game_id TEXT NOT NULL, image_url TEXT NOT NULL, style TEXT DEFAULT '', fetched_at TEXT DEFAULT (datetime('now','localtime')), PRIMARY KEY (game_id, image_url))`,
    `INSERT OR IGNORE INTO sync_state (id) VALUES (1)`,
    `INSERT OR IGNORE INTO wallpaper_state (id) VALUES (1)`,
    `INSERT OR IGNORE INTO settings (key, value) VALUES ('theme', 'purple'), ('pattern', 'grid'), ('glass_intensity', '1'), ('weather_city', 'Beijing'), ('clock_format', '24h'), ('weather_size', 'medium'), ('widget_style', 'bar'), ('clock_size', 'medium'), ('auth_password_hash', ''), ('background_type', 'gradient'), ('wallpaper_interval', '900'), ('font_size', '14'), ('accent_color', '#7c6ff7'), ('color_scheme', 'purple'), ('style', 'glass'), ('bg_solid_color', '#0d0e14'), ('steamgriddb_api_key', '')`,
    `INSERT OR IGNORE INTO wallpapers (name, url, category, enabled, sort_order, source_type) VALUES
      ('必应每日', 'https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8', 'builtin', 1, 0, 'url'),
      ('赛博朋克2077', '1091500', 'builtin', 1, 1, 'steamgriddb'),
      ('艾尔登法环', '1245620', 'builtin', 1, 2, 'steamgriddb'),
      ('荒野大镖客2', '1174180', 'builtin', 1, 3, 'steamgriddb'),
      ('巫师3', '292030', 'builtin', 1, 4, 'steamgriddb'),
      ('对马岛之魂', '2215430', 'builtin', 1, 5, 'steamgriddb'),
      ('死亡搁浅', '1850570', 'builtin', 1, 6, 'steamgriddb'),
      ('战神', '1593500', 'builtin', 1, 7, 'steamgriddb'),
      ('星空', '1716740', 'builtin', 1, 8, 'steamgriddb'),
      ('只狼', '814380', 'builtin', 1, 9, 'steamgriddb'),
      ('地平线：西之绝境', '2420110', 'builtin', 1, 10, 'steamgriddb'),
      ('地平线：零之曙光', '1151640', 'builtin', 1, 11, 'steamgriddb'),
      ('刺客信条：英灵殿', '2208920', 'builtin', 1, 12, 'steamgriddb'),
      ('刺客信条：奥德赛', '812140', 'builtin', 1, 13, 'steamgriddb'),
      ('怪物猎人：世界', '582010', 'builtin', 1, 14, 'steamgriddb'),
      ('黑暗之魂3', '374320', 'builtin', 1, 15, 'steamgriddb'),
      ('无人深空', '275850', 'builtin', 1, 16, 'steamgriddb')`,
    `INSERT OR IGNORE INTO fonts (name, family, category, cdn_url, language, sort_order) VALUES
      ('匯文明朝體', 'Huiwen-mincho', 'builtin', 'https://fontsapi.zeoseven.com/256/main/result.css', 'zh', 0),
      ('京华老宋体', 'KingHwaOldSong', 'builtin', 'https://fontsapi.zeoseven.com/309/main/result.css', 'zh', 1),
      ('LXGW WenKai', 'LXGW WenKai', 'builtin', 'https://fontsapi.zeoseven.com/292/main/result.css', 'zh', 2),
      ('抖音美好体', 'DouyinSans', 'builtin', 'https://fontsapi.zeoseven.com/84/main/result.css', 'zh', 3)`
  ];

  for (const sql of statements) {
    try {
      await db.prepare(sql).run();
    } catch (e) {
      console.warn('DB init step warning:', e);
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  ROUTES — Health
// ═══════════════════════════════════════════════════════════
app.get('/health', c => c.json({ status: 'ok', ts: Date.now() }));

// ═══════════════════════════════════════════════════════════
//  Auth Rate Limiting (D1-backed, per-IP)
// ═══════════════════════════════════════════════════════════
const RATE_MAX_FAILS = 5;
const RATE_WINDOW_MS = 15 * 60 * 1000;   // 15 min counting window
const RATE_LOCK_MS = 30 * 60 * 1000;     // lock duration after too many failures

function clientIp(c: any): string {
  return (c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown').split(',')[0].trim();
}

async function isLoginLocked(db: D1Database, ip: string): Promise<string | null> {
  try {
    const row = await db.prepare('SELECT locked_until_ms FROM auth_rate WHERE ip = ?').bind(ip).first<{ locked_until_ms: number }>();
    if (row && row.locked_until_ms > Date.now()) {
      const mins = Math.ceil((row.locked_until_ms - Date.now()) / 60000);
      return `尝试次数过多，请 ${mins} 分钟后再试`;
    }
  } catch {}
  return null;
}

async function recordLoginFailure(db: D1Database, ip: string): Promise<void> {
  try {
    const now = Date.now();
    const row = await db.prepare('SELECT fails, first_fail_ms FROM auth_rate WHERE ip = ?').bind(ip).first<{ fails: number; first_fail_ms: number }>();
    if (!row || now - (row.first_fail_ms || 0) > RATE_WINDOW_MS) {
      await db.prepare('INSERT INTO auth_rate (ip, fails, first_fail_ms, locked_until_ms) VALUES (?, 1, ?, 0) ON CONFLICT(ip) DO UPDATE SET fails = 1, first_fail_ms = ?, locked_until_ms = 0').bind(ip, now, now).run();
      return;
    }
    const fails = row.fails + 1;
    if (fails >= RATE_MAX_FAILS) {
      await db.prepare('UPDATE auth_rate SET fails = ?, locked_until_ms = ? WHERE ip = ?').bind(fails, now + RATE_LOCK_MS, ip).run();
    } else {
      await db.prepare('UPDATE auth_rate SET fails = ? WHERE ip = ?').bind(fails, ip).run();
    }
  } catch (e) {
    console.warn('recordLoginFailure failed:', e);
  }
}

async function clearLoginFailures(db: D1Database, ip: string): Promise<void> {
  try { await db.prepare('DELETE FROM auth_rate WHERE ip = ?').bind(ip).run(); } catch {}
}

// ═══════════════════════════════════════════════════════════
//  ROUTES — Auth API
// ═══════════════════════════════════════════════════════════
app.get('/api/auth/status', async c => {
  const hash = await getSetting(c.env.DB, 'auth_password_hash', '');
  return c.json({ has_password: Boolean(hash) });
});

app.post('/api/auth/setup', async c => {
  const ip = clientIp(c);
  const locked = await isLoginLocked(c.env.DB, ip);
  if (locked) return c.json({ detail: locked }, 429);
  const hash = await getSetting(c.env.DB, 'auth_password_hash', '');
  if (hash) {
    return c.json({ detail: '密码已设置' }, 400);
  }
  const body = (await c.req.json().catch(() => ({}))) as any;
  const password = (body.password || '').trim();
  if (password.length < 6) {
    return c.json({ detail: '密码至少6位' }, 400);
  }
  const newHash = await hashPassword(password);
  await setSetting(c.env.DB, 'auth_password_hash', newHash);
  await clearLoginFailures(c.env.DB, ip);
  const token = await issueAuthToken(c.env.DB);
  return c.json({ ok: true, token });
});

app.post('/api/auth/login', async c => {
  const ip = clientIp(c);
  const locked = await isLoginLocked(c.env.DB, ip);
  if (locked) return c.json({ detail: locked }, 429);
  const hash = await getSetting(c.env.DB, 'auth_password_hash', '');
  if (!hash) {
    return c.json({ detail: '请先设置密码' }, 400);
  }
  const body = (await c.req.json().catch(() => ({}))) as any;
  const password = (body.password || '').trim();
  const valid = await verifyPassword(password, hash);
  if (!valid) {
    await recordLoginFailure(c.env.DB, ip);
    return c.json({ detail: '密码错误' }, 401);
  }
  await clearLoginFailures(c.env.DB, ip);
  const token = await issueAuthToken(c.env.DB);
  return c.json({ ok: true, token });
});

app.post('/api/auth/logout', requireAuth, async c => {
  const authHeader = c.req.header('Authorization') || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (token) {
    const tokenHash = await sha256Hex(token);
    await c.env.DB.prepare('DELETE FROM auth_tokens WHERE token_hash = ?').bind(tokenHash).run();
  }
  return c.json({ ok: true });
});

app.post('/api/auth/change-password', requireAuth, async c => {
  const body = (await c.req.json().catch(() => ({}))) as any;
  const oldPw = body.old_password || '';
  const newPw = (body.new_password || '').trim();
  if (newPw.length < 6) {
    return c.json({ detail: '新密码至少6位' }, 400);
  }
  const currentHash = await getSetting(c.env.DB, 'auth_password_hash', '');
  if (!(await verifyPassword(oldPw, currentHash))) {
    return c.json({ detail: '旧密码错误' }, 401);
  }
  const newHash = await hashPassword(newPw);
  await setSetting(c.env.DB, 'auth_password_hash', newHash);
  await c.env.DB.prepare('DELETE FROM auth_tokens').run();
  const token = await issueAuthToken(c.env.DB);
  return c.json({ ok: true, token });
});

// ═══════════════════════════════════════════════════════════
//  ROUTES — Data API (Groups & Links)
// ═══════════════════════════════════════════════════════════
app.get('/api/data', async c => {
  const groups = await getAllData(c.env.DB);
  return c.json({ groups });
});

app.post('/api/groups', requireAuth, async c => {
  const body = (await c.req.json().catch(() => ({}))) as any;
  const name = (body.name || '').trim();
  if (!name) return c.json({ detail: '名称不能为空' }, 400);
  const icon = body.icon || '📁';
  const type = body.type || 'tab';
  const db = c.env.DB;

  const maxOrderRow = await db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM groups_table').first<any>();
  const sortOrder = (maxOrderRow?.max_order ?? -1) + 1;

  const res = await db
    .prepare('INSERT INTO groups_table (name, icon, type, sort_order) VALUES (?, ?, ?, ?)')
    .bind(name, icon, type, sortOrder)
    .run();

  const id = res.meta.last_row_id;
  await logAction(db, 'create_group', 'group', { id, name });
  await notifyChange(db, 'group_created', { id, name });
  return c.json({ id, name, icon, type, links: [] }, 201);
});

app.put('/api/groups/:gid', requireAuth, async c => {
  const gid = parseInt(c.req.param('gid') || '0', 10);
  const body = (await c.req.json().catch(() => ({}))) as any;
  const db = c.env.DB;

  for (const field of ['name', 'icon', 'type', 'display_mode', 'layout_mode', 'sort_order']) {
    if (field in body) {
      await db.prepare(`UPDATE groups_table SET ${field} = ? WHERE id = ?`).bind(body[field], gid).run();
    }
  }

  const row = await db.prepare('SELECT * FROM groups_table WHERE id = ?').bind(gid).first<Group>();
  if (!row) return c.json({ detail: 'Not found' }, 404);

  await logAction(db, 'update_group', 'group', { id: gid });
  await notifyChange(db, 'group_updated', { id: gid });
  return c.json(row);
});

app.delete('/api/groups/:gid', requireAuth, async c => {
  const gid = parseInt(c.req.param('gid') || '0', 10);
  const db = c.env.DB;
  const row = await db.prepare('SELECT name FROM groups_table WHERE id = ?').bind(gid).first<{ name: string }>();
  if (!row) return c.json({ ok: true });

  await db.prepare('DELETE FROM groups_table WHERE id = ?').bind(gid).run();
  await logAction(db, 'delete_group', 'group', { id: gid, name: row.name });
  await notifyChange(db, 'group_deleted', { id: gid, name: row.name });
  return c.json({ ok: true });
});

app.post('/api/links', requireAuth, async c => {
  const body = (await c.req.json().catch(() => ({}))) as any;
  let groupId = body.group_id;
  const groupName = (body.group_name || '').trim();
  const groupType = body.group_type || 'tab';
  const title = (body.title || '').trim();
  const url = (body.url || '').trim();
  const db = c.env.DB;

  if (!groupId && groupName) {
    const existing = await db.prepare('SELECT id FROM groups_table WHERE name = ?').bind(groupName).first<{ id: number }>();
    if (existing) {
      groupId = existing.id;
    } else {
      const maxOrderRow = await db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM groups_table').first<any>();
      const sortOrder = (maxOrderRow?.max_order ?? -1) + 1;
      const cur = await db
        .prepare('INSERT INTO groups_table (name, icon, type, sort_order) VALUES (?, ?, ?, ?)')
        .bind(groupName, '', groupType, sortOrder)
        .run();
      groupId = cur.meta.last_row_id;
      await logAction(db, 'create_group', 'group', { id: groupId, name: groupName });
      await notifyChange(db, 'group_created', { id: groupId, name: groupName });
    }
  }

  if (!title || !url || !groupId) {
    return c.json({ detail: '缺少必填字段' }, 400);
  }

  const desc = body.description || '';
  const icon = body.icon || '';
  const iconType = body.icon_type || 'auto';

  const maxLinkRow = await db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM links WHERE group_id = ?')
    .bind(groupId)
    .first<any>();
  const sortOrder = (maxLinkRow?.max_order ?? -1) + 1;

  const cur = await db
    .prepare('INSERT INTO links (group_id, title, url, description, icon, icon_type, sort_order, synced_to_browser) VALUES (?, ?, ?, ?, ?, ?, ?, 0)')
    .bind(groupId, title, url, desc, icon, iconType, sortOrder)
    .run();

  const id = cur.meta.last_row_id;
  await logAction(db, 'create_link', 'link', { id, title, url, group_id: groupId });
  await notifyChange(db, 'link_created', { id, group_id: groupId, title });
  return c.json({ id }, 201);
});

app.put('/api/links/:lid', requireAuth, async c => {
  const lid = parseInt(c.req.param('lid') || '0', 10);
  const body = (await c.req.json().catch(() => ({}))) as any;
  const db = c.env.DB;

  for (const field of ['title', 'url', 'description', 'icon', 'icon_type', 'group_id', 'sort_order']) {
    if (field in body) {
      await db.prepare(`UPDATE links SET ${field} = ? WHERE id = ?`).bind(body[field], lid).run();
    }
  }

  const row = await db.prepare('SELECT * FROM links WHERE id = ?').bind(lid).first<Link>();
  if (!row) return c.json({ detail: 'Not found' }, 404);

  await logAction(db, 'update_link', 'link', { id: lid });
  await notifyChange(db, 'link_updated', { id: lid });
  return c.json(row);
});

app.delete('/api/links/:lid', requireAuth, async c => {
  const lid = parseInt(c.req.param('lid') || '0', 10);
  const db = c.env.DB;
  const linkRow = await db
    .prepare('SELECT l.url, g.name AS group_name FROM links l JOIN groups_table g ON l.group_id = g.id WHERE l.id = ?')
    .bind(lid)
    .first<{ url: string; group_name: string }>();

  await db.prepare('DELETE FROM links WHERE id = ?').bind(lid).run();
  if (linkRow) {
    await logAction(db, 'delete_link', 'link', { id: lid, url: linkRow.url, group_name: linkRow.group_name });
    const remaining = await db
      .prepare('SELECT COUNT(*) as cnt FROM links l JOIN groups_table g ON l.group_id = g.id WHERE g.name = ?')
      .bind(linkRow.group_name)
      .first<{ cnt: number }>();
    if (remaining && remaining.cnt === 0) {
      await db.prepare('DELETE FROM groups_table WHERE name = ?').bind(linkRow.group_name).run();
      await notifyChange(db, 'group_deleted', { name: linkRow.group_name });
    }
    await notifyChange(db, 'link_deleted', { id: lid, url: linkRow.url, group_name: linkRow.group_name });
  }
  return c.json({ ok: true });
});

app.post('/api/reorder/groups', requireAuth, async c => {
  const body = (await c.req.json().catch(() => ({}))) as any;
  const ids: number[] = (body.ids || []).map((x: any) => parseInt(x, 10));
  const db = c.env.DB;

  const stmts = ids.map((gid, idx) =>
    db.prepare('UPDATE groups_table SET sort_order = ? WHERE id = ?').bind(idx, gid)
  );
  if (stmts.length > 0) {
    await db.batch(stmts);
  }

  await logAction(db, 'reorder_groups', 'group', { ids });
  await notifyChange(db, 'groups_reordered', { ids });
  return c.json({ ok: true });
});

app.post('/api/reorder/links', requireAuth, async c => {
  const body = (await c.req.json().catch(() => ({}))) as any;
  const groupId = parseInt(body.group_id || '0', 10);
  const ids: number[] = (body.ids || []).map((x: any) => parseInt(x, 10));
  if (!groupId || ids.length === 0) {
    return c.json({ detail: '缺少分组或链接' }, 400);
  }
  const db = c.env.DB;

  const stmts = ids.map((lid, idx) =>
    db
      .prepare('UPDATE links SET group_id = ?, sort_order = ?, synced_to_browser = 0 WHERE id = ?')
      .bind(groupId, idx, lid)
  );
  await db.batch(stmts);

  await logAction(db, 'reorder_links', 'link', { group_id: groupId, ids });
  await notifyChange(db, 'links_reordered', { group_id: groupId, ids });
  return c.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════
//  ROUTES — Tools & Cleaners
// ═══════════════════════════════════════════════════════════
app.get('/api/tools/duplicates', requireAuth, async c => {
  const db = c.env.DB;
  const rows = await db
    .prepare('SELECT l.id, l.title, l.url, g.name AS group_name FROM links l JOIN groups_table g ON l.group_id = g.id ORDER BY l.id ASC')
    .all<any>();

  const buckets = new Map<string, any[]>();
  for (const r of rows.results || []) {
    const key = normalizeUrl(r.url);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(r);
  }

  const groups: any[] = [];
  for (const [key, items] of buckets.entries()) {
    if (items.length > 1) {
      groups.push({ url_key: key, items });
    }
  }

  const totalDuplicates = groups.reduce((acc, g) => acc + g.items.length - 1, 0);
  return c.json({
    total_groups: groups.length,
    total_duplicates: totalDuplicates,
    groups
  });
});

app.post('/api/tools/duplicates/delete', requireAuth, async c => {
  const body = (await c.req.json().catch(() => ({}))) as any;
  const ids: number[] = (body.ids || []).map((x: any) => parseInt(x, 10));
  if (ids.length === 0) return c.json({ deleted: 0 });

  const db = c.env.DB;
  const placeholders = ids.map(() => '?').join(',');
  await db.prepare(`DELETE FROM links WHERE id IN (${placeholders})`).bind(...ids).run();

  await logAction(db, 'delete_duplicates', 'link', { ids });
  await notifyChange(db, 'duplicates_deleted', { ids });
  return c.json({ deleted: ids.length });
});

app.get('/api/ops/logs', requireAuth, async c => {
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);
  const rows = await c.env.DB
    .prepare('SELECT * FROM operation_log ORDER BY id DESC LIMIT ?')
    .bind(limit)
    .all<any>();

  const logs = (rows.results || []).map(r => {
    let detail = {};
    try {
      detail = JSON.parse(r.detail || '{}');
    } catch {}
    return { ...r, detail };
  });

  return c.json({ logs });
});

// ═══════════════════════════════════════════════════════════
//  ROUTES — Settings & Config Export/Import
// ═══════════════════════════════════════════════════════════
app.get('/api/settings', async c => {
  const db = c.env.DB;
  const authHeader = c.req.header('Authorization') || '';
  const token = authHeader.replace('Bearer ', '').trim();
  const isAuth = token ? await isTokenValid(token, db) : false;

  let rows: any;
  if (isAuth) {
    rows = await db.prepare("SELECT key, value FROM settings WHERE key NOT LIKE 'auth_%'").all<any>();
  } else {
    const publicKeys = [
      'theme', 'pattern', 'glass_intensity', 'weather_city',
      'clock_format', 'weather_size', 'widget_style', 'clock_size', 'search_engines', 'search_default',
      'background_type', 'wallpaper_interval',
      'font_body', 'font_title', 'font_body_en', 'font_code', 'font_size',
      'accent_color', 'color_scheme', 'style', 'bg_solid_color'
    ];
    const placeholders = publicKeys.map(() => '?').join(',');
    rows = await db.prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders})`).bind(...publicKeys).all<any>();
  }

  const result: Record<string, string> = {};
  for (const r of rows.results || []) {
    result[r.key] = r.value;
  }
  return c.json(result);
});

app.put('/api/settings', requireAuth, async c => {
  const body = (await c.req.json().catch(() => ({}))) as any;
  const allowed = [
    'pattern', 'glass_intensity', 'weather_city',
    'clock_format', 'weather_size', 'widget_style', 'clock_size', 'search_engines', 'search_default',
    'llm_url', 'llm_key', 'llm_model', 'ai_provider', 'ai_model',
    'background_type', 'wallpaper_interval',
    'font_body', 'font_title', 'font_body_en', 'font_code', 'font_size',
    'accent_color', 'style', 'bg_solid_color', 'color_scheme',
    'steamgriddb_api_key'
  ];

  const db = c.env.DB;
  for (const key of allowed) {
    if (key in body) {
      await setSetting(db, key, String(body[key]));
    }
  }
  return c.json({ ok: true });
});

async function buildExportPayload(db: D1Database) {
  const settingsRows = await db.prepare('SELECT key, value FROM settings').all<any>();
  const settings: Record<string, string> = {};
  for (const r of settingsRows.results || []) {
    settings[r.key] = r.value;
  }

  const groups = await getAllData(db);
  const wallpapers = (await db.prepare("SELECT name, url, category, enabled, sort_order, source_type FROM wallpapers WHERE category != 'builtin' ORDER BY sort_order").all<any>()).results || [];
  const fonts = (await db.prepare("SELECT name, family, category, cdn_url, language, sort_order FROM fonts WHERE category != 'builtin' ORDER BY sort_order").all<any>()).results || [];

  return {
    version: 1,
    exported_at: new Date().toISOString(),
    settings,
    groups,
    wallpapers,
    fonts
  };
}

app.get('/api/config/export', requireAuth, async c => {
  return c.json(await buildExportPayload(c.env.DB));
});

app.post('/api/config/import', requireAuth, async c => {
  const body = (await c.req.json().catch(() => ({}))) as any;
  if (body.version !== 1) {
    return c.json({ detail: '不支持的配置版本' }, 400);
  }

  const db = c.env.DB;
  const imported = { settings: 0, groups: 0, links: 0, wallpapers: 0, fonts: 0 };

  if (body.settings && typeof body.settings === 'object') {
    for (const [k, v] of Object.entries(body.settings)) {
      await setSetting(db, k, String(v));
      imported.settings++;
    }
  }

  if (Array.isArray(body.groups)) {
    await db.prepare('DELETE FROM links').run();
    await db.prepare('DELETE FROM groups_table').run();

    for (const g of body.groups) {
      const cur = await db
        .prepare('INSERT INTO groups_table (name, icon, display_mode, sort_order) VALUES (?, ?, ?, ?)')
        .bind(g.name || '', g.icon || '📁', g.display_mode || 'compact', g.sort_order || 0)
        .run();
      const gid = cur.meta.last_row_id;
      imported.groups++;

      if (Array.isArray(g.links)) {
        for (const l of g.links) {
          await db
            .prepare('INSERT INTO links (group_id, title, url, description, icon, icon_type, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .bind(gid, l.title || '', l.url || '', l.description || '', l.icon || '', l.icon_type || 'auto', l.sort_order || 0)
            .run();
          imported.links++;
        }
      }
    }
  }

  if (Array.isArray(body.wallpapers)) {
    for (const w of body.wallpapers) {
      try {
        await db
          .prepare('INSERT INTO wallpapers (name, url, category, enabled, sort_order, source_type) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(w.name || '', w.url || '', w.category || 'custom', w.enabled ? 1 : 0, w.sort_order || 0, w.source_type || 'url')
          .run();
        imported.wallpapers++;
      } catch {}
    }
  }

  if (Array.isArray(body.fonts)) {
    for (const f of body.fonts) {
      try {
        await db
          .prepare('INSERT INTO fonts (name, family, category, cdn_url, language, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(f.name || '', f.family || '', f.category || 'custom', f.cdn_url || '', f.language || 'zh', f.sort_order || 0)
          .run();
        imported.fonts++;
      } catch {}
    }
  }

  return c.json({ ok: true, imported });
});

// ═══════════════════════════════════════════════════════════
//  ROUTES — Sync & Bookmarks
// ═══════════════════════════════════════════════════════════
app.post('/api/sync', requireAuth, async c => {
  const db = c.env.DB;
  const ct = c.req.header('content-type') || '';
  let folders: any[] = [];

  if (ct.includes('application/json')) {
    const body = (await c.req.json().catch(() => ({}))) as any;
    folders = body.folders || [];
  } else {
    const formData = await c.req.formData();
    const file = formData.get('file');
    if (file && typeof file === 'object') {
      const text = await (file as Blob).text();
      folders = parseBookmarks(text);
    }
  }

  if (!folders || folders.length === 0) {
    return c.json({ detail: '未获取到书签数据' }, 400);
  }

  let totalNew = 0;
  for (const folder of folders) {
    const name = (folder.name || '未分类').trim();
    if (!name) continue;

    let groupId: number;
    const existingGroup = await db.prepare('SELECT id FROM groups_table WHERE name = ?').bind(name).first<{ id: number }>();
    if (existingGroup) {
      groupId = existingGroup.id;
    } else {
      const maxOrderRow = await db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM groups_table').first<any>();
      const sortOrder = (maxOrderRow?.max_order ?? -1) + 1;
      const res = await db
        .prepare('INSERT INTO groups_table (name, icon, type, sort_order, is_imported) VALUES (?, ?, ?, ?, 1)')
        .bind(name, '📁', 'tab', sortOrder)
        .run();
      groupId = res.meta.last_row_id;
    }

    const existingLinks = (await db.prepare('SELECT url FROM links WHERE group_id = ?').bind(groupId).all<{ url: string }>()).results || [];
    const existingNorm = new Set(existingLinks.map(l => normalizeUrl(l.url)));

    const maxLinkRow = await db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM links WHERE group_id = ?').bind(groupId).first<any>();
    let maxOrder = (maxLinkRow?.max_order ?? -1);

    for (const bm of folder.bookmarks || []) {
      const url = (bm.url || '').trim();
      const title = (bm.title || '').trim();
      if (!url || !title) continue;

      const norm = normalizeUrl(url);
      if (existingNorm.has(norm)) continue;

      maxOrder++;
      await db
        .prepare('INSERT INTO links (group_id, title, url, icon_type, sort_order, is_imported, synced_to_browser) VALUES (?, ?, ?, ?, ?, 1, 1)')
        .bind(groupId, title, url, 'auto', maxOrder)
        .run();
      existingNorm.add(norm);
      totalNew++;
    }
  }

  await db.prepare("UPDATE sync_state SET last_sync_at = datetime('now','localtime'), last_sync_from = ? WHERE id = 1").bind('extension').run();
  if (totalNew > 0) {
    await logAction(db, 'import_bookmarks', 'bookmarks', { imported: totalNew });
    await notifyChange(db, 'sync_imported', { imported: totalNew });
  }

  return c.json({ ok: true, imported: totalNew });
});

app.post('/api/import/preview', requireAuth, async c => {
  const formData = await c.req.formData();
  const file = formData.get('file');
  if (!file || typeof file !== 'object') {
    return c.json({ detail: '未上传文件' }, 400);
  }
  const text = await (file as Blob).text();
  const folders = parseBookmarks(text);
  const total = folders.reduce((acc, f) => acc + (f.bookmarks ? f.bookmarks.length : 0), 0);
  return c.json({ total, folders });
});

app.delete('/api/sync/bookmark', requireAuth, async c => {
  const url = (c.req.query('url') || '').trim();
  if (!url) return c.json({ detail: 'Missing url' }, 400);

  const db = c.env.DB;
  const norm = normalizeUrl(url);
  const rows = (await db.prepare("SELECT l.id, l.url, g.name AS group_name FROM links l JOIN groups_table g ON l.group_id = g.id WHERE l.is_imported = 1").all<any>()).results || [];

  let deleted = 0;
  let deletedGroup = '';
  for (const r of rows) {
    if (normalizeUrl(r.url) === norm) {
      deletedGroup = r.group_name;
      await db.prepare('DELETE FROM links WHERE id = ?').bind(r.id).run();
      deleted++;
      break;
    }
  }

  if (deleted > 0) {
    await notifyChange(db, 'link_deleted', { url, group_name: deletedGroup });
  }
  return c.json({ deleted });
});

app.get('/api/sync/status', requireAuth, async c => {
  const db = c.env.DB;
  const syncRow = await db.prepare('SELECT * FROM sync_state WHERE id = 1').first<any>();
  const totalLinks = (await db.prepare('SELECT COUNT(*) AS cnt FROM links').first<{ cnt: number }>())?.cnt || 0;
  const totalGroups = (await db.prepare('SELECT COUNT(*) AS cnt FROM groups_table').first<{ cnt: number }>())?.cnt || 0;
  const pending = (await db.prepare('SELECT COUNT(*) AS cnt FROM links WHERE synced_to_browser = 0').first<{ cnt: number }>())?.cnt || 0;

  return c.json({
    last_sync_at: syncRow?.last_sync_at || null,
    last_sync_from: syncRow?.last_sync_from || null,
    total_links: totalLinks,
    total_groups: totalGroups,
    pending_sync: pending,
    listeners: 0
  });
});

app.post('/api/sync/heartbeat', requireAuth, async c => {
  await c.env.DB
    .prepare("UPDATE sync_state SET last_sync_at = datetime('now','localtime'), last_sync_from = 'plugin' WHERE id = 1")
    .run();
  return c.json({ ok: true });
});

app.get('/api/sync/pending', requireAuth, async c => {
  const rows = await c.env.DB
    .prepare("SELECT l.id, l.group_id, l.title, l.url, l.icon_type, l.description, g.name AS group_name, g.type AS group_type FROM links l JOIN groups_table g ON l.group_id = g.id WHERE l.synced_to_browser = 0 ORDER BY l.id ASC")
    .all<any>();
  const links = rows.results || [];
  return c.json({ links, count: links.length });
});

app.post('/api/sync/ack', requireAuth, async c => {
  const body = (await c.req.json().catch(() => ({}))) as any;
  const ids: number[] = (body.ids || []).map((x: any) => parseInt(x, 10));
  if (ids.length === 0) return c.json({ detail: 'Missing ids' }, 400);

  const placeholders = ids.map(() => '?').join(',');
  await c.env.DB.prepare(`UPDATE links SET synced_to_browser = 1 WHERE id IN (${placeholders})`).bind(...ids).run();
  return c.json({ ok: true, acked: ids.length });
});

app.get('/api/events/stream', requireAuth, async c => {
  const db = c.env.DB;
  const row = await db.prepare('SELECT COALESCE(MAX(id), 0) AS max_id FROM event_log').first<{ max_id: number }>();
  let lastId = row?.max_id || 0;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(`event: hello\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`));

      // Send heartbeat
      const timer = setInterval(async () => {
        try {
          const events = await db
            .prepare('SELECT id, kind, payload, created_ms FROM event_log WHERE id > ? ORDER BY id ASC LIMIT 50')
            .bind(lastId)
            .all<any>();

          for (const ev of events.results || []) {
            lastId = ev.id;
            let payload = {};
            try {
              payload = JSON.parse(ev.payload || '{}');
            } catch {}
            const msg = { kind: ev.kind, payload, ts: ev.created_ms };
            controller.enqueue(encoder.encode(`event: change\ndata: ${JSON.stringify(msg)}\n\n`));
          }

          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          clearInterval(timer);
        }
      }, 5000);
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
});

// ═══════════════════════════════════════════════════════════
//  ROUTES — Netscape HTML Export
// ═══════════════════════════════════════════════════════════
app.get('/api/export', requireAuth, async c => {
  const groups = await getAllData(c.env.DB);
  const lines = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>SuenWeb Export</TITLE>',
    '<H1>SuenWeb Bookmarks</H1>',
    '<DL><p>'
  ];

  for (const g of groups) {
    lines.push(`    <DT><H3>${escapeHtml(g.name)}</H3>`);
    lines.push('    <DL><p>');
    for (const l of g.links || []) {
      lines.push(`        <DT><A HREF="${escapeAttr(l.url)}" ICON="">${escapeHtml(l.title)}</A>`);
    }
    lines.push('    </DL><p>');
  }
  lines.push('</DL><p>');

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': 'attachment; filename=suenweb_bookmarks.html'
    }
  });
});

// ═══════════════════════════════════════════════════════════
//  ROUTES — Wallpapers
// ═══════════════════════════════════════════════════════════
app.get('/api/wallpaper', async c => {
  const db = c.env.DB;
  const state = await db.prepare('SELECT * FROM wallpaper_state WHERE id = 1').first<any>();
  let url = state?.current_url || '';
  if (!url) {
    url = await fetchWallpaperUrl(db, 'next');
  }
  const bgType = await getSetting(db, 'background_type', 'gradient');
  return c.json({ url, background_type: bgType });
});

app.get('/api/wallpaper/sources', async c => {
  const db = c.env.DB;
  const sources = (await db.prepare('SELECT * FROM wallpapers ORDER BY sort_order ASC, id ASC').all<any>()).results || [];
  const interval = await getSetting(db, 'wallpaper_interval', '900');
  const bgType = await getSetting(db, 'background_type', 'gradient');
  const state = await db.prepare('SELECT * FROM wallpaper_state WHERE id = 1').first<any>();
  const sgdbKey = await getSetting(db, 'steamgriddb_api_key', '');

  return c.json({
    sources,
    interval: parseInt(interval, 10),
    background_type: bgType,
    current_index: state?.current_index ?? 0,
    steamgriddb_api_key: sgdbKey.length > 8 ? sgdbKey.substring(0, 4) + '****' + sgdbKey.slice(-4) : sgdbKey,
    steamgriddb_configured: Boolean(sgdbKey.trim())
  });
});

app.post('/api/wallpaper/source', requireAuth, async c => {
  const body = (await c.req.json().catch(() => ({}))) as any;
  const name = (body.name || '').trim();
  const url = (body.url || '').trim();
  const sourceType = body.source_type || 'url';
  if (!name || !url) return c.json({ detail: '名称和URL/游戏ID不能为空' }, 400);

  const db = c.env.DB;
  const maxOrderRow = await db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM wallpapers').first<any>();
  const sortOrder = (maxOrderRow?.max_order ?? -1) + 1;

  const res = await db
    .prepare('INSERT INTO wallpapers (name, url, category, enabled, sort_order, source_type) VALUES (?, ?, ?, 1, ?, ?)')
    .bind(name, url, 'custom', sortOrder, sourceType)
    .run();

  return c.json({ id: res.meta.last_row_id, name, url, category: 'custom', enabled: 1, source_type: sourceType }, 201);
});

app.delete('/api/wallpaper/source/:sid', requireAuth, async c => {
  const sid = parseInt(c.req.param('sid') || '0', 10);
  const db = c.env.DB;
  const row = await db.prepare('SELECT * FROM wallpapers WHERE id = ?').bind(sid).first<any>();
  if (!row) return c.json({ detail: 'Not found' }, 404);
  if (row.category === 'builtin') return c.json({ detail: '内置源不可删除' }, 400);

  await db.prepare('DELETE FROM wallpapers WHERE id = ?').bind(sid).run();
  return c.json({ ok: true });
});

app.put('/api/wallpaper/source/:sid', requireAuth, async c => {
  const sid = parseInt(c.req.param('sid') || '0', 10);
  const body = (await c.req.json().catch(() => ({}))) as any;
  if ('enabled' in body) {
    await c.env.DB.prepare('UPDATE wallpapers SET enabled = ? WHERE id = ?').bind(body.enabled ? 1 : 0, sid).run();
  }
  return c.json({ ok: true });
});

app.post('/api/wallpaper/refresh', requireAuth, async c => {
  const body = (await c.req.json().catch(() => ({}))) as any;
  const direction = body.direction || 'next';
  const url = await fetchWallpaperUrl(c.env.DB, direction);
  return c.json({ url });
});

app.post('/api/wallpaper/sgdb-test', requireAuth, async c => {
  const body = (await c.req.json().catch(() => ({}))) as any;
  const apiKey = (body.api_key || '').trim();
  if (!apiKey) return c.json({ detail: '请填写 API Key' }, 400);

  try {
    const res = await fetch('https://www.steamgriddb.com/api/v2/search/autocomplete/Cyberpunk', {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    if (res.status === 401) return c.json({ ok: false, error: 'API Key 无效 (401)' });
    if (res.status === 403) return c.json({ ok: false, error: 'API Key 无权限 (403)' });
    if (!res.ok) return c.json({ ok: false, error: `HTTP ${res.status}` });

    const data: any = await res.json();
    const count = (data?.data || []).length;
    return c.json({ ok: true, message: `连接成功，找到 ${count} 个匹配游戏` });
  } catch (e: any) {
    return c.json({ ok: false, error: e.message || '连接超时' });
  }
});

// ═══════════════════════════════════════════════════════════
//  ROUTES — Fonts
// ═══════════════════════════════════════════════════════════
app.get('/api/fonts', async c => {
  const db = c.env.DB;
  const fonts = (await db.prepare('SELECT * FROM fonts ORDER BY sort_order ASC, id ASC').all<any>()).results || [];
  return c.json({
    fonts,
    font_body: await getSetting(db, 'font_body', ''),
    font_title: await getSetting(db, 'font_title', ''),
    font_body_en: await getSetting(db, 'font_body_en', ''),
    font_code: await getSetting(db, 'font_code', ''),
    font_size: await getSetting(db, 'font_size', '14')
  });
});

app.post('/api/fonts', requireAuth, async c => {
  const body = (await c.req.json().catch(() => ({}))) as any;
  const name = (body.name || '').trim();
  const family = (body.family || '').trim();
  const cdnUrl = (body.cdn_url || '').trim();
  const language = body.language || 'zh';

  if (!name || !family || !cdnUrl) {
    return c.json({ detail: '名称、font-family 和 CDN URL 不能为空' }, 400);
  }

  const db = c.env.DB;
  const maxOrderRow = await db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM fonts').first<any>();
  const sortOrder = (maxOrderRow?.max_order ?? -1) + 1;

  const res = await db
    .prepare('INSERT INTO fonts (name, family, category, cdn_url, language, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(name, family, 'custom', cdnUrl, language, sortOrder)
    .run();

  return c.json({ id: res.meta.last_row_id, name, family, cdn_url: cdnUrl }, 201);
});

app.delete('/api/fonts/:fid', requireAuth, async c => {
  const fid = parseInt(c.req.param('fid') || '0', 10);
  const db = c.env.DB;
  const row = await db.prepare('SELECT * FROM fonts WHERE id = ?').bind(fid).first<any>();
  if (!row) return c.json({ detail: 'Not found' }, 404);
  if (row.category === 'builtin') return c.json({ detail: '内置字体不可删除' }, 400);

  await db.prepare('DELETE FROM fonts WHERE id = ?').bind(fid).run();
  return c.json({ ok: true });
});

app.get('/api/font-css/:fid.css', async c => {
  const fid = parseInt(c.req.param('fid') || '0', 10);
  const row = await c.env.DB.prepare('SELECT * FROM fonts WHERE id = ?').bind(fid).first<any>();
  if (!row || !row.cdn_url) return c.text('/* not found */', 404);

  try {
    const css = await fetchFontCss(row.cdn_url, String(fid));
    return new Response(css, {
      headers: {
        'Content-Type': 'text/css; charset=utf-8',
        'Cache-Control': 'public, max-age=3600'
      }
    });
  } catch (e: any) {
    return c.text(`/* fetch error: ${e.message} */`, 502);
  }
});

app.get('/api/font-woff', async c => {
  const family = c.req.query('family') || '';
  const file = c.req.query('file') || '';
  if (!family || !file || file.includes('..') || file.includes('/') || file.includes('\\')) {
    return c.text('', 404);
  }

  const fid = parseInt(family, 10);
  const row = await c.env.DB.prepare('SELECT cdn_url FROM fonts WHERE id = ?').bind(fid).first<{ cdn_url: string }>();
  if (!row || !row.cdn_url) return c.text('', 404);

  try {
    const buf = await fetchFontWoff2(row.cdn_url, file);
    return new Response(buf, {
      headers: {
        'Content-Type': 'font/woff2',
        'Cache-Control': 'public, max-age=86400'
      }
    });
  } catch (e: any) {
    return c.text(`woff2 fetch error: ${e.message}`, 502);
  }
});

// ═══════════════════════════════════════════════════════════
//  ROUTES — Icon Proxy & Builtin Icons
// ═══════════════════════════════════════════════════════════
app.get('/api/icon/proxy', async c => {
  let domain = c.req.query('domain') || '';
  let url = c.req.query('url') || '';

  if (!domain && url) {
    try {
      domain = new URL(url).hostname;
    } catch {}
  }

  if (domain && domain.startsWith('http')) {
    try {
      domain = new URL(domain).hostname;
    } catch {}
  }

  if (!domain && !url) {
    return new Response(DEFAULT_ICON_SVG, { headers: { 'Content-Type': 'image/svg+xml' } });
  }

  const iconRes = await proxyFavicon(domain, url, c.env.DB);
  if (iconRes) {
    return new Response(iconRes.data, {
      headers: {
        'Content-Type': iconRes.contentType,
        'Cache-Control': 'public, max-age=86400'
      }
    });
  }

  return new Response(DEFAULT_ICON_SVG, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400'
    }
  });
});

app.post('/api/icon/refresh', requireAuth, async c => {
  const body = (await c.req.json().catch(() => ({}))) as any;
  let domain = (body.domain || '').trim();
  const url = (body.url || '').trim();
  if (!domain && url) {
    try {
      domain = new URL(url).hostname;
    } catch {}
  }

  if (domain) {
    await c.env.DB.prepare('DELETE FROM icon_cache WHERE domain = ?').bind(domain).run();
    await logAction(c.env.DB, 'refresh_icon', 'icon', { domain });
    return c.json({ ok: true, domain });
  }
  return c.json({ detail: '缺少域名或 URL' }, 400);
});

app.get('/api/builtin-icons', c => {
  const icons = BUILTIN_ICONS.map(name => ({
    name,
    path: `/static/icons/${name}.svg`
  }));
  return c.json({ icons });
});

// ═══════════════════════════════════════════════════════════
//  ROUTES — Extension Downloads
// ═══════════════════════════════════════════════════════════
// Chrome / Edge CRX3
app.get('/extension/download/crx', c => {
  const crx = getExtensionCrx();
  return new Response(crx, {
    headers: {
      'Content-Type': 'application/x-chrome-extension',
      'Content-Disposition': 'attachment; filename=suenweb.crx'
    }
  });
});

app.get('/extension/download/chrome', c => {
  const crx = getExtensionCrx();
  return new Response(crx, {
    headers: {
      'Content-Type': 'application/x-chrome-extension',
      'Content-Disposition': 'attachment; filename=suenweb.crx'
    }
  });
});

// Chrome source ZIP (unpacked loading)
app.get('/extension/download/zip', c => {
  const zip = createExtensionZip('chrome');
  return new Response(zip, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename=suenweb-extension-chrome.zip'
    }
  });
});

// Firefox XPI / ZIP
app.get('/extension/download/firefox', c => {
  const xpi = getExtensionXpi();
  return new Response(xpi, {
    headers: {
      'Content-Type': 'application/x-xpinstall',
      'Content-Disposition': 'attachment; filename=suenweb-firefox.xpi'
    }
  });
});

app.get('/extension/download/xpi', c => {
  const xpi = getExtensionXpi();
  return new Response(xpi, {
    headers: {
      'Content-Type': 'application/x-xpinstall',
      'Content-Disposition': 'attachment; filename=suenweb-firefox.xpi'
    }
  });
});

// ═══════════════════════════════════════════════════════════
//  ROUTES — Extension Backup (via SuenWeb Sync extension)
// ═══════════════════════════════════════════════════════════
app.get('/api/extensions', requireAuth, async c => {
  const rows = (await c.env.DB
    .prepare('SELECT id, ext_id, name, version, url, browser, updated_at FROM ext_repo ORDER BY browser ASC, name COLLATE NOCASE ASC')
    .all<any>()).results || [];
  return c.json({ extensions: rows });
});

app.post('/api/extensions', requireAuth, async c => {
  const body = (await c.req.json().catch(() => ({}))) as any;
  const browserType = (body.browser || 'chrome').trim() === 'firefox' ? 'firefox' : 'chrome';
  const list = Array.isArray(body.extensions) ? body.extensions : [];

  const stmts = [c.env.DB.prepare('DELETE FROM ext_repo WHERE browser = ?').bind(browserType)];
  let count = 0;
  for (const e of list.slice(0, 100)) {
    const extId = String(e.ext_id || '').trim();
    if (!extId) continue;
    const url = String(e.url || '').trim() || `https://www.crxsoso.com/webstore/detail/${extId}`;
    stmts.push(
      c.env.DB
        .prepare(`INSERT INTO ext_repo (ext_id, name, version, url, browser) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(ext_id, browser) DO UPDATE SET name = excluded.name, version = excluded.version, url = excluded.url, updated_at = datetime('now','localtime')`)
        .bind(extId, String(e.name || extId).substring(0, 120), String(e.version || ''), url, browserType)
    );
    count++;
  }
  await c.env.DB.batch(stmts);

  await logAction(c.env.DB, 'backup_extensions', 'extensions', { browser: browserType, count });
  await notifyChange(c.env.DB, 'extensions_backed_up', { browser: browserType, count });
  return c.json({ ok: true, count });
});

app.delete('/api/extensions/:eid', requireAuth, async c => {
  const eid = parseInt(c.req.param('eid') || '0', 10);
  if (!eid) return c.json({ detail: 'Not found' }, 404);
  await c.env.DB.prepare('DELETE FROM ext_repo WHERE id = ?').bind(eid).run();
  return c.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════
//  ROUTES — AI Features (Zero API Key Free Models by Default!)
// ═══════════════════════════════════════════════════════════
app.post('/api/ai/suggest-icons', requireAuth, async c => {
  const body = (await c.req.json().catch(() => ({}))) as any;
  const db = c.env.DB;

  const savedUrl = await getSetting(db, 'llm_url', '');
  const savedKey = await getSetting(db, 'llm_key', '');
  const savedModel = await getSetting(db, 'llm_model', '');
  const aiConfig = {
    llm_url: body.llm_url || savedUrl,
    llm_key: body.llm_key || savedKey,
    llm_model: body.llm_model || savedModel
  };

  const groupIds = body.group_ids;
  let query = "SELECT id, name FROM groups_table WHERE (icon IS NULL OR icon = '' OR icon = '📁')";
  const params: any[] = [];
  if (Array.isArray(groupIds) && groupIds.length > 0) {
    const placeholders = groupIds.map(() => '?').join(',');
    query += ` AND id IN (${placeholders})`;
    params.push(...groupIds);
  }

  const groupsRes = await db.prepare(query).bind(...params).all<{ id: number; name: string }>();
  const groups = groupsRes.results || [];
  if (groups.length === 0) {
    return c.json({ message: '所有组已有图标，无需补全', updated: 0 });
  }

  const outcome = await suggestGroupIcons(groups, aiConfig, c.env);
  let updated = 0;
  for (const s of outcome.suggestions) {
    await db.prepare('UPDATE groups_table SET icon = ? WHERE id = ?').bind(s.icon, s.id).run();
    updated++;
  }
  if (outcome.error) {
    return c.json({ detail: outcome.error, updated }, 502);
  }

  await logAction(db, 'ai_suggest_icons', 'groups', { updated });
  return c.json({ message: `已为 ${updated} 个组补全图标`, updated });
});

app.post('/api/ai/describe', requireAuth, async c => {
  const body = (await c.req.json().catch(() => ({}))) as any;
  const db = c.env.DB;

  // Retrieve saved config or override from request
  const savedUrl = await getSetting(db, 'llm_url', '');
  const savedKey = await getSetting(db, 'llm_key', '');
  const savedModel = await getSetting(db, 'llm_model', '');

  const aiConfig = {
    llm_url: body.llm_url || savedUrl || '',
    llm_key: body.llm_key || savedKey || '',
    llm_model: body.llm_model || savedModel || ''
  };

  const linkId = body.link_id;
  const groupIds = body.group_ids;

  // Single link describe
  if (linkId) {
    const link = await db.prepare('SELECT id, title, url FROM links WHERE id = ?').bind(linkId).first<any>();
    if (!link) return c.json({ detail: '链接不存在' }, 404);

    const desc = await generateSingleDescription(link.title, link.url, aiConfig, c.env);
    if (!desc) {
      return c.json({ detail: '生成描述失败，请重试' }, 500);
    }

    await db.prepare('UPDATE links SET description = ? WHERE id = ?').bind(desc, linkId).run();
    return c.json({ description: desc, count: 1 });
  }

  // Bulk links describe
  let query = "SELECT l.id, l.title, l.url FROM links l WHERE (l.description IS NULL OR l.description = '')";
  const params: any[] = [];
  if (Array.isArray(groupIds) && groupIds.length > 0) {
    const placeholders = groupIds.map(() => '?').join(',');
    query += ` AND l.group_id IN (${placeholders})`;
    params.push(...groupIds);
  }

  const linksRes = await db.prepare(query).bind(...params).all<any>();
  const links = linksRes.results || [];
  if (links.length === 0) {
    return c.json({ message: '所有链接已有描述', count: 0 });
  }

  const descriptions = await generateBulkDescriptions(links, aiConfig, c.env);
  let updated = 0;

  for (const item of descriptions) {
    if (item.desc) {
      await db.prepare('UPDATE links SET description = ? WHERE id = ?').bind(item.desc, item.id).run();
      updated++;
    }
  }

  return c.json({ message: `已为 ${updated} 个链接生成描述`, count: updated });
});

app.post('/api/ai/check', requireAuth, async c => {
  const body = (await c.req.json().catch(() => ({}))) as any;
  const groupIds = body.group_ids;
  const db = c.env.DB;

  let query = 'SELECT l.id, l.title, l.url, g.name AS group_name FROM links l JOIN groups_table g ON l.group_id = g.id';
  const params: any[] = [];
  if (Array.isArray(groupIds) && groupIds.length > 0) {
    const placeholders = groupIds.map(() => '?').join(',');
    query += ` AND l.group_id IN (${placeholders})`;
    params.push(...groupIds);
  }

  const linksRes = await db.prepare(query).bind(...params).all<any>();
  const links = linksRes.results || [];
  if (links.length === 0) {
    return c.json({ detail: '没有找到链接' }, 400);
  }

  const result = await checkLinksHealth(links);
  return c.json(result);
});

// ═══════════════════════════════════════════════════════════
//  Fallback & Static Assets
// ═══════════════════════════════════════════════════════════
app.get('*', async c => {
  if (c.env.ASSETS) {
    const res = await c.env.ASSETS.fetch(c.req.raw);
    if (res.status !== 404) return res;
  }
  return c.text('Not Found', 404);
});

// ═══════════════════════════════════════════════════════════
//  Daily Backup (Cron Trigger)
//  Prefers R2 binding BACKUP_DB (off-site); falls back to a
//  D1 table (protects against logical mistakes only).
// ═══════════════════════════════════════════════════════════
const BACKUP_KEEP = 30;

async function runBackup(env: Env): Promise<{ where: string; key: string }> {
  const payload = await buildExportPayload(env.DB);
  const json = JSON.stringify(payload);
  const key = 'backup-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.json';

  if (env.BACKUP_DB) {
    await env.BACKUP_DB.put(key, json);
    const list = await env.BACKUP_DB.list({ prefix: 'backup-' });
    const sorted = list.objects.map(o => ({ key: o.key, t: o.uploaded.getTime() })).sort((a, b) => a.t - b.t);
    for (const o of sorted.slice(0, Math.max(0, sorted.length - BACKUP_KEEP))) {
      await env.BACKUP_DB.delete(o.key);
    }
    return { where: 'r2', key };
  }

  await env.DB.prepare('INSERT INTO backups (payload) VALUES (?)').bind(json).run();
  await env.DB.prepare('DELETE FROM backups WHERE id NOT IN (SELECT id FROM backups ORDER BY id DESC LIMIT ?)').bind(BACKUP_KEEP).run();
  return { where: 'd1', key };
}

export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext) {
    return runBackup(env).then(
      r => console.log(`[backup] stored ${r.key} in ${r.where}`),
      e => console.error('[backup] failed:', e)
    );
  }
};
