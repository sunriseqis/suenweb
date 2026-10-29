import type { DataPool } from '../proxy.ts';
import { badRequest } from '../../domain/errors.ts';
import type { BrowserKind } from '../../domain/stores.ts';

const BROWSERS = new Set<BrowserKind>(['firefox', 'chrome', 'edge', 'other']);
const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export type ExtensionRow = {
  id: number;
  ext_id: string;
  name: string;
  version: string;
  url: string | null;
  browser: BrowserKind;
  updated_at: string;
};

export type ExtensionInput = { ext_id?: unknown; name?: unknown; version?: unknown; url?: unknown };

export class ExtensionsRepo {
  private readonly db: DataPool;

  constructor(db: DataPool) {
    this.db = db;
  }

  private browser(value: unknown): BrowserKind {
    const b = String(value ?? '') as BrowserKind;
    if (!BROWSERS.has(b)) throw badRequest('INVALID_BROWSER', '不支持的浏览器类型: ' + value);
    return b;
  }

  /** EXT-01：按浏览器全量替换 */
  async replace(browser: unknown, items: ExtensionInput[]): Promise<{ browser: BrowserKind; total: number }> {
    const b = this.browser(browser);
    const statements: Array<{ sql: string; params?: unknown[] }> = [{ sql: 'DELETE FROM extensions WHERE browser = ?', params: [b] }];
    const seen = new Set<string>();
    for (const item of items) {
      const extId = String(item.ext_id ?? '').trim();
      const name = String(item.name ?? '').trim();
      if (!extId || !name || seen.has(extId)) continue;
      seen.add(extId);
      statements.push({
        sql: "INSERT INTO extensions (ext_id, name, version, url, browser, updated_at) VALUES (?, ?, ?, ?, ?, " + NOW_SQL + ") ON CONFLICT(ext_id, browser) DO UPDATE SET name = excluded.name, version = excluded.version, url = excluded.url, updated_at = " + NOW_SQL,
        params: [extId.slice(0, 200), name.slice(0, 200), String(item.version ?? '').slice(0, 100), item.url ? String(item.url).slice(0, 500) : null, b],
      });
    }
    if (statements.length > 0) await this.db.batch(statements);
    return { browser: b, total: seen.size };
  }

  async list(): Promise<ExtensionRow[]> {
    return this.db.all<ExtensionRow>('SELECT * FROM extensions ORDER BY browser, name, ext_id');
  }

  async deleteById(id: number): Promise<number> {
    const res = await this.db.run('DELETE FROM extensions WHERE id = ?', [id]);
    return res.changes;
  }

  async count(): Promise<number> {
    const row = await this.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM extensions');
    return row ? Number(row.count) : 0;
  }
}
