import { mkdir } from 'node:fs/promises';
import { loadConfig } from '../config.ts';
import { DataPool } from './proxy.ts';

const config = loadConfig();
await mkdir(config.dataDir, { recursive: true });

const db = await DataPool.open({
  dbFile: config.dbFile,
  migrationsDir: config.migrationsDir,
  readWorkers: 0,
});

const rows = await db.all<{ version: string; applied_at: string }>(
  'SELECT version, applied_at FROM schema_migrations ORDER BY version',
);
console.log('schema_migrations:');
for (const row of rows) {
  console.log('  - ' + row.version + '  (' + row.applied_at + ')');
}
await db.close();
