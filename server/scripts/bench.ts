import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { DataPool } from '../src/data/proxy.ts';
import { createLogger } from '../src/infra/logger.ts';

const REQUESTS = Number(process.env.REQUESTS ?? 300);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 20);
const SEED_LINKS = Number(process.env.SEED_LINKS ?? 200);

const dataDir = await mkdtemp(join(tmpdir(), 'suenweb-bench-'));
const config = loadConfig({ DATA_DIR: dataDir, LOG_LEVEL: 'silent', HOST: '127.0.0.1' }, dataDir);
const db = await DataPool.open({ dbFile: config.dbFile, migrationsDir: config.migrationsDir, readWorkers: 2 });
const app = await buildApp({ config, db, logger: createLogger('silent') });

const group = await app.repos.groups.create({ name: 'Bench' });
for (let i = 0; i < SEED_LINKS; i += 1) {
  await app.repos.links.create({ group_id: group.group.id, url: 'https://example.com/' + i, title: 'link ' + i });
}

await app.listen({ host: '127.0.0.1', port: 0 });
const address = app.server.address();
const port = typeof address === 'object' && address ? address.port : 0;
const base = 'http://127.0.0.1:' + port;

const histogram = monitorEventLoopDelay({ resolution: 5 });
histogram.enable();
const latencies: number[] = [];
let cursor = 0;
const startedAt = Date.now();

async function worker(): Promise<void> {
  while (cursor < REQUESTS) {
    cursor += 1;
    const t0 = performance.now();
    const res = await fetch(base + '/api/data');
    await res.json();
    latencies.push(performance.now() - t0);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
histogram.disable();
const elapsed = Date.now() - startedAt;
latencies.sort((a, b) => a - b);
const pick = (q: number): number => latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))];

const report = {
  requests: REQUESTS,
  concurrency: CONCURRENCY,
  seedLinks: SEED_LINKS,
  elapsedMs: elapsed,
  qps: Math.round((REQUESTS / Math.max(1, elapsed)) * 1000),
  p50ms: Number(pick(0.5).toFixed(1)),
  p95ms: Number(pick(0.95).toFixed(1)),
  p99ms: Number(pick(0.99).toFixed(1)),
  eventLoopP99ms: Number((histogram.percentile(99) / 1e6).toFixed(2)),
  eventLoopMaxMs: Number((histogram.max / 1e6).toFixed(2)),
};
console.log(JSON.stringify(report, null, 2));

await app.close();
await db.close();
await rm(dataDir, { recursive: true, force: true });
