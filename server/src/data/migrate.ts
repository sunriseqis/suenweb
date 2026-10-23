import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

/** 版本化迁移：按文件名排序、单个文件一个事务、写入 schema_migrations 后才算应用 */
export function runMigrations(db: DatabaseSync, dir: string): string[] {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))",
  );
  const rows = db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: string }>;
  const applied = new Set(rows.map((r) => r.version));
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const done: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations(version) VALUES (?)').run(version);
      db.exec('COMMIT');
      done.push(version);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return done;
}
