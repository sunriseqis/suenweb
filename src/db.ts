import { Group, Link, Setting } from './types';

export async function getSetting(db: D1Database, key: string, defaultValue: string = ''): Promise<string> {
  try {
    const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<Setting>();
    return row?.value ?? defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value)
    .run();
}

export async function logAction(db: D1Database, action: string, target: string = '', detail: any = {}): Promise<void> {
  try {
    await db
      .prepare('INSERT INTO operation_log (action, target, detail) VALUES (?, ?, ?)')
      .bind(action, target, JSON.stringify(detail))
      .run();
  } catch (e) {
    console.error('Failed to log action:', e);
  }
}

export async function notifyChange(db: D1Database, kind: string, payload: any = {}): Promise<void> {
  try {
    await db
      .prepare('INSERT INTO event_log (kind, payload, created_ms) VALUES (?, ?, ?)')
      .bind(kind, JSON.stringify(payload), Date.now())
      .run();
  } catch (e) {
    console.error('Failed to notify change:', e);
  }
}

export async function getAllData(db: D1Database): Promise<Group[]> {
  const groups = await db
    .prepare('SELECT * FROM groups_table ORDER BY sort_order ASC, id ASC')
    .all<Group>();

  const links = await db
    .prepare('SELECT * FROM links ORDER BY sort_order ASC, id ASC')
    .all<Link>();

  const groupMap = new Map<number, Group>();
  for (const g of groups.results || []) {
    groupMap.set(g.id, { ...g, links: [] });
  }

  for (const l of links.results || []) {
    const group = groupMap.get(l.group_id);
    if (group && group.links) {
      group.links.push(l);
    }
  }

  return Array.from(groupMap.values());
}

export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url.trim());
    let host = parsed.hostname.toLowerCase();
    if (host.startsWith('www.')) {
      host = host.substring(4);
    }
    let path = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol}//${host}${path}${parsed.search}`;
  } catch {
    return url.trim().toLowerCase().replace(/\/+$/, '');
  }
}

export function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function escapeAttr(str: string): string {
  return escapeHtml(str);
}
