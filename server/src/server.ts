import { mkdir } from 'node:fs/promises';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { DataPool } from './data/proxy.ts';
import { createLogger } from './infra/logger.ts';

const config = loadConfig();
const logger = createLogger(config.logLevel);

await mkdir(config.dataDir, { recursive: true });

const db = await DataPool.open({
  dbFile: config.dbFile,
  migrationsDir: config.migrationsDir,
  readWorkers: 2,
  onError: (err) => logger.error({ err }, '数据层错误'),
});

const app = await buildApp({ config, db, logger });
await app.listen({ host: config.host, port: config.port });
logger.info(
  { port: config.port, host: config.host, dataDir: config.dataDir, version: config.version },
  'SuenWeb 后端已启动',
);

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  logger.info({ signal }, '开始优雅关闭');
  const watchdog = setTimeout(() => {
    logger.warn('关闭超时，强制退出');
    process.exit(1);
  }, 10000);
  watchdog.unref();
  try {
    await app.close();
    await db.close();
  } catch (err) {
    logger.error({ err }, '关闭过程出错');
  }
  clearTimeout(watchdog);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
