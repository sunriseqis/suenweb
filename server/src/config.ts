import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Config = {
  host: string;
  port: number;
  dataDir: string;
  repoRoot: string;
  webRoot: string;
  dbFile: string;
  migrationsDir: string;
  logLevel: string;
  tz: string;
  outboundConcurrency: number;
  sessionTtlDays: number;
  secureCookies: boolean;
  baseUrl: string;
  version: string;
};

export const APP_VERSION = '2.0.0';

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];

function intInRange(raw: string | undefined, fallback: number, min: number, max: number, name: string): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(name + ' 不合法: ' + raw);
  return n;
}

export function loadConfig(env: Record<string, string | undefined> = process.env, cwd: string = process.cwd()): Config {
  const logLevel = env.LOG_LEVEL ?? 'info';
  if (!LOG_LEVELS.includes(logLevel)) throw new Error('LOG_LEVEL 不合法: ' + logLevel);
  const dataDir = resolve(cwd, env.DATA_DIR ?? './data');
  const baseUrl = env.BASE_URL ?? '';
  return {
    host: env.HOST ?? '0.0.0.0',
    port: intInRange(env.PORT, 8080, 1, 65535, 'PORT'),
    dataDir,
    repoRoot: fileURLToPath(new URL('../..', import.meta.url)),
    // 前端静态产物目录：默认仓库内 public/；包内（fnOS）用 WEB_ROOT 指向 app/web/dist
    webRoot: env.WEB_ROOT && env.WEB_ROOT !== '' ? resolve(env.WEB_ROOT) : fileURLToPath(new URL('../../public', import.meta.url)),
    dbFile: resolve(dataDir, 'suenweb.db'),
    migrationsDir: fileURLToPath(new URL('./data/migrations/', import.meta.url)),
    logLevel,
    tz: env.TZ ?? 'Asia/Shanghai',
    outboundConcurrency: intInRange(env.OUTBOUND_CONCURRENCY, 8, 1, 64, 'OUTBOUND_CONCURRENCY'),
    sessionTtlDays: intInRange(env.SESSION_TTL_DAYS, 30, 1, 365, 'SESSION_TTL_DAYS'),
    // 注意：此处只依据 BASE_URL 协议判断。反向代理做 TLS 终结时，本服务收到的是 http 请求，
    // 必须把 BASE_URL 设为 https:// 开头，cookie 才会带 Secure 属性
    secureCookies: baseUrl.startsWith('https://'),
    baseUrl,
    version: APP_VERSION,
  };
}
