import { Worker } from 'node:worker_threads';
import type { Statement, WorkerInit } from './worker.ts';

export type RunResult = { changes: number; lastInsertRowid: number };
type Role = 'write' | 'read';

type Reply =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { code: string; message: string } };

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
};

const WORKER_URL = new URL('./worker.ts', import.meta.url);
const CALL_TIMEOUT_MS = 20000;
const MAX_RESTARTS = 5;

export class SqlError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'SqlError';
    this.code = code;
  }
}

class WorkerClient {
  private worker: Worker | null = null;
  private readonly pending = new Map<number, Pending>();
  private seq = 0;
  private restarts = 0;
  private stabilityTimer: NodeJS.Timeout | null = null;
  private closing = false;
  private readonly init: WorkerInit;
  private readonly onError: (e: Error) => void;

  constructor(init: WorkerInit, onError: (e: Error) => void) {
    this.init = init;
    this.onError = onError;
    this.spawn();
  }

  private spawn(): void {
    const worker = new Worker(WORKER_URL, { workerData: this.init });
    this.worker = worker;
    worker.on('message', (msg: Reply & { type?: string }) => {
      if (msg && (msg as { type?: string }).type === 'ready') {
        this.scheduleStabilityReset();
        return;
      }
      if (!msg || typeof msg.id !== 'number') return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new SqlError(msg.error.code, msg.error.message));
    });
    worker.on('error', (err) => {
      this.onError(err);
      this.failAll(new SqlError('WORKER_ERROR', err.message));
    });
    worker.on('exit', (code) => {
      this.worker = null;
      if (this.closing) return;
      const err = new SqlError('WORKER_EXIT', '数据 worker 退出，code=' + code);
      this.failAll(err);
      if (this.restarts < MAX_RESTARTS) {
        this.restarts += 1;
        this.spawn();
      } else {
        this.onError(err);
      }
    });
  }

  /** M7：worker 正常运行满 60 秒后把 restarts 清零——偶发崩溃不应累积成永久放弃 */
  private scheduleStabilityReset(): void {
    if (this.stabilityTimer) clearTimeout(this.stabilityTimer);
    this.stabilityTimer = setTimeout(() => {
      this.restarts = 0;
      this.stabilityTimer = null;
    }, 60_000);
    this.stabilityTimer.unref?.();
  }

  private failAll(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  async ready(): Promise<void> {
    await this.call({ method: 'ping' } as never);
  }

  call(payload: Record<string, unknown>, timeoutMs = CALL_TIMEOUT_MS): Promise<unknown> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new SqlError('WORKER_DOWN', '数据 worker 不可用'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new SqlError('WORKER_TIMEOUT', '数据库操作超时'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, ...payload });
    });
  }

  async close(): Promise<void> {
    this.closing = true;
    this.failAll(new SqlError('WORKER_CLOSING', '数据 worker 正在关闭'));
    const worker = this.worker;
    this.worker = null;
    if (worker) await worker.terminate();
  }
}

export type DataPoolOptions = {
  dbFile: string;
  migrationsDir: string;
  readWorkers?: number;
  migrate?: boolean;
  onError?: (e: Error) => void;
};

/** 主线程唯一入口：写走单写 worker（串行），读走 N 个只读 worker（并行） */
export class DataPool {
  private readonly writer: WorkerClient;
  private readonly readers: WorkerClient[];
  private rr = 0;
  private closed = false;

  private constructor(writer: WorkerClient, readers: WorkerClient[]) {
    this.writer = writer;
    this.readers = readers;
  }

  static async open(opts: DataPoolOptions): Promise<DataPool> {
    const onError = opts.onError ?? (() => {});
    const base = { dbFile: opts.dbFile, migrationsDir: opts.migrationsDir };
    const writer = new WorkerClient({ ...base, role: 'write', migrate: opts.migrate ?? true }, onError);
    await writer.ready();
    const readerCount = opts.readWorkers ?? 2;
    const readers: WorkerClient[] = [];
    for (let i = 0; i < readerCount; i += 1) {
      const r = new WorkerClient({ ...base, role: 'read', migrate: false }, onError);
      await r.ready();
      readers.push(r);
    }
    return new DataPool(writer, readers);
  }

  private reader(): WorkerClient {
    if (this.readers.length === 0) return this.writer;
    const c = this.readers[this.rr % this.readers.length];
    this.rr += 1;
    return c;
  }

  async all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    return (await this.reader().call({ method: 'all', sql, params })) as T[];
  }

  async get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> {
    const row = await this.reader().call({ method: 'get', sql, params });
    return (row ?? null) as T | null;
  }

  async run(sql: string, params?: unknown[]): Promise<RunResult> {
    return (await this.writer.call({ method: 'run', sql, params })) as RunResult;
  }

  async exec(sql: string): Promise<void> {
    await this.writer.call({ method: 'exec', sql }, 60000);
  }

  async batch(statements: Statement[]): Promise<RunResult[]> {
    return (await this.writer.call({ method: 'batch', statements }, 60000)) as RunResult[];
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.all([this.writer.close(), ...this.readers.map((r) => r.close())]);
  }
}
