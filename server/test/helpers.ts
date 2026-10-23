import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { DataPool } from '../src/data/proxy.ts';
import { createLogger } from '../src/infra/logger.ts';

export type Harness = {
  app: FastifyInstance;
  db: DataPool;
  dataDir: string;
  close: () => Promise<void>;
};

export async function createHarness(): Promise<Harness> {
  const dataDir = await mkdtemp(join(tmpdir(), 'suenweb-test-'));
  const config = loadConfig({ DATA_DIR: dataDir, LOG_LEVEL: 'silent', HOST: '127.0.0.1' }, dataDir);
  const db = await DataPool.open({
    dbFile: config.dbFile,
    migrationsDir: config.migrationsDir,
    readWorkers: 1,
  });
  const app = await buildApp({ config, db, logger: createLogger('silent') });
  await app.ready();
  return {
    app,
    db,
    dataDir,
    close: async () => {
      await app.close();
      await db.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

export function parse(res: { body: string }): any {
  return JSON.parse(res.body);
}

export function bearer(token: string): Record<string, string> {
  return { authorization: 'Bearer ' + token };
}

export async function setupAdmin(app: FastifyInstance, password = 'passw0rd!'): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password } });
  if (res.statusCode !== 200) throw new Error('setup failed: ' + res.body);
  return parse(res).data.token as string;
}
