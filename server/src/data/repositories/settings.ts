import type { DataPool } from '../proxy.ts';
import { badRequest } from '../../domain/errors.ts';

export type SettingRow = { key: string; value: string; updated_at: string };

/** 公开键：访客也能读（外观与站点信息） */
export const PUBLIC_SETTING_KEYS = [
  'site.title',
  'site.description',
  'ui.theme',
  'ui.accent',
  'ui.card_style',
  'ui.density',
  'ui.show_icons',
  'ui.default_view',
];

/** 前端可写键：只允许外观与站点信息，内部键（auth.* / backup.*）一律走服务端 */
export const WRITABLE_SETTING_KEYS = new Set(PUBLIC_SETTING_KEYS);

const PUBLIC_SET = new Set(PUBLIC_SETTING_KEYS);
const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export class SettingsRepo {
  private readonly db: DataPool;

  constructor(db: DataPool) {
    this.db = db;
  }

  async listRows(): Promise<SettingRow[]> {
    return this.db.all<SettingRow>('SELECT * FROM settings ORDER BY key');
  }

  /** 内部键只服务端可见（口令哈希等），绝不能出现在任何响应里 */
  async getAll(): Promise<Record<string, unknown>> {
    const rows = await this.listRows();
    const out: Record<string, unknown> = {};
    for (const row of rows) {
      if (row.key.startsWith('auth.') || row.key.startsWith('backup.') || row.key.startsWith('webdav.')) continue;
      out[row.key] = parseValue(row.value);
    }
    return out;
  }

  async getPublic(): Promise<Record<string, unknown>> {
    const all = await this.getAll();
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(all)) {
      if (PUBLIC_SET.has(key)) out[key] = all[key];
    }
    return out;
  }

  async getRaw(key: string): Promise<string | null> {
    const row = await this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    return row ? row.value : null;
  }

  async getValue<T>(key: string, fallback: T): Promise<T> {
    const raw = await this.getRaw(key);
    if (raw === null) return fallback;
    return parseValue(raw) as T;
  }

  async set(key: string, value: unknown): Promise<void> {
    if (!key || key.length > 64) throw badRequest('INVALID_SETTING_KEY', '设置键不合法');
    const encoded = JSON.stringify(value === undefined ? null : value);
    await this.db.run(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = " + NOW_SQL,
      [key, encoded],
    );
  }

  async setMany(patch: Record<string, unknown>): Promise<void> {
    const keys = Object.keys(patch);
    for (const key of keys) {
      if (!WRITABLE_SETTING_KEYS.has(key)) throw badRequest('SETTING_NOT_WRITABLE', '不可写的设置项: ' + key);
    }
    const statements = keys.map((key) => ({
      sql:
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = " + NOW_SQL,
      params: [key, JSON.stringify(patch[key] ?? null)],
    }));
    if (statements.length > 0) await this.db.batch(statements);
  }

  async remove(key: string): Promise<void> {
    await this.db.run('DELETE FROM settings WHERE key = ?', [key]);
  }
}

function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
