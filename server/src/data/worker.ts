import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue, StatementSync } from 'node:sqlite';
import { runMigrations } from './migrate.ts';

export type WorkerInit = {
  dbFile: string;
  role: 'write' | 'read';
  migrate: boolean;
  migrationsDir: string;
  cacheLimit?: number;
};

export type Statement = { sql: string; params?: unknown[] };

export type WorkerRequest =
  | { id: number; method: 'ping' }
  | { id: number; method: 'all'; sql: string; params?: unknown[] }
  | { id: number; method: 'get'; sql: string; params?: unknown[] }
  | { id: number; method: 'run'; sql: string; params?: unknown[] }
  | { id: number; method: 'exec'; sql: string }
  | { id: number; method: 'batch'; statements: Statement[] };

const init = workerData as WorkerInit;
const CACHE_LIMIT = init.cacheLimit ?? 200;
const db = new DatabaseSync(init.dbFile);
const cache = new Map<string, StatementSync>();

db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');
db.exec('PRAGMA temp_store = MEMORY');

if (init.role === 'write') {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  if (init.migrate) runMigrations(db, init.migrationsDir);
} else {
  // 读连接只读：SQL 写错了也不会破坏数据
  db.exec('PRAGMA query_only = ON');
}

function prepare(sql: string): StatementSync {
  const hit = cache.get(sql);
  if (hit) return hit;
  const stmt = db.prepare(sql);
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(sql, stmt);
  return stmt;
}

function bind(params: unknown[] | undefined): SQLInputValue[] {
  if (!params || params.length === 0) return [];
  return params.map((v) => {
    if (v === undefined) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v instanceof Date) return v.toISOString();
    return v as SQLInputValue;
  });
}

function plain<T>(row: unknown): T {
  return (row ? { ...(row as object) } : row) as T;
}

function handle(req: WorkerRequest): unknown {
  switch (req.method) {
    case 'ping':
      return 'pong';
    case 'all':
      return (prepare(req.sql).all(...bind(req.params)) as unknown[]).map((r) => plain(r));
    case 'get':
      return plain(prepare(req.sql).get(...bind(req.params)));
    case 'run': {
      const res = prepare(req.sql).run(...bind(req.params));
      return { changes: Number(res.changes), lastInsertRowid: Number(res.lastInsertRowid) };
    }
    case 'exec':
      db.exec(req.sql);
      return null;
    case 'batch': {
      const results: Array<{ changes: number; lastInsertRowid: number }> = [];
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const st of req.statements) {
          const res = prepare(st.sql).run(...bind(st.params));
          results.push({ changes: Number(res.changes), lastInsertRowid: Number(res.lastInsertRowid) });
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      return results;
    }
    default:
      throw new Error('未知方法: ' + String((req as { method?: string }).method));
  }
}

parentPort?.on('message', (req: WorkerRequest) => {
  if (!parentPort) return;
  try {
    parentPort.postMessage({ id: req.id, ok: true, result: handle(req) });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    parentPort.postMessage({
      id: req.id,
      ok: false,
      error: { code: e.code ?? 'SQLITE_ERROR', message: e.message ?? '数据库操作失败' },
    });
  }
});

parentPort?.postMessage({ type: 'ready', role: init.role });
