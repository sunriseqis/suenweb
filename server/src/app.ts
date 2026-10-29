import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.ts';
import type { DataPool } from './data/proxy.ts';
import { GroupsRepo } from './data/repositories/groups.ts';
import { LinksRepo } from './data/repositories/links.ts';
import { SessionsRepo } from './data/repositories/sessions.ts';
import type { SessionRow } from './data/repositories/sessions.ts';
import { SettingsRepo } from './data/repositories/settings.ts';
import { AuthService } from './domain/authService.ts';
import { AppError, unauthorized } from './domain/errors.ts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AppEvents } from './infra/events.ts';
import { BackupService } from './infra/backupService.ts';
import { IconCache } from './infra/iconCache.ts';
import { extractToken } from './http/plugins/auth.ts';
import { authRoutes } from './http/routes/auth.ts';
import { dataRoutes } from './http/routes/data.ts';
import { dedupeRoutes } from './http/routes/dedupe.ts';
import { groupRoutes } from './http/routes/groups.ts';
import { healthRoutes } from './http/routes/health.ts';
import { importExportRoutes } from './http/routes/importExport.ts';
import { backupRoutes } from './http/routes/backup.ts';
import { extensionRoutes } from './http/routes/extensions.ts';
import { toolsRoutes } from './http/routes/tools.ts';
import { addonDownloadRoutes } from './http/routes/addonDownload.ts';
import { iconRoutes } from './http/routes/icon.ts';
import { linkRoutes } from './http/routes/links.ts';
import { settingRoutes } from './http/routes/settings.ts';
import { ExtensionsRepo } from './data/repositories/extensions.ts';
import { syncRoutes } from './http/routes/sync.ts';
import type { Logger } from './infra/logger.ts';

export type Repos = {
  groups: GroupsRepo;
  links: LinksRepo;
  settings: SettingsRepo;
  extensions: ExtensionsRepo;
  sessions: SessionsRepo;
};

export type AppDeps = {
  config: Config;
  db: DataPool;
  logger: Logger;
};

declare module 'fastify' {
  interface FastifyRequest {
    session: SessionRow | null;
    sessionToken: string | null;
  }
  interface FastifyInstance {
    config: Config;
    db: DataPool;
    repos: Repos;
    auth: AuthService;
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    icons: IconCache;
    events: AppEvents;
    backup: BackupService;
  }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: deps.logger as unknown as FastifyBaseLogger,
    // 默认没有前置反代：不信任 X-Forwarded-For，req.ip 即 TCP 对端地址（登录失败限速基于它）
    trustProxy: false,
    bodyLimit: 4 * 1024 * 1024,
  });

  const repos: Repos = {
    groups: new GroupsRepo(deps.db),
    links: new LinksRepo(deps.db),
    settings: new SettingsRepo(deps.db),
    sessions: new SessionsRepo(deps.db),
    extensions: new ExtensionsRepo(deps.db),
  };

  app.decorate('config', deps.config);
  app.decorate('db', deps.db);
  app.decorate('repos', repos);
  app.decorate('icons', new IconCache(deps.config.dataDir));
  app.decorate('events', new AppEvents());
  app.decorate('backup', new BackupService(deps.db, repos.settings));

  const auth = new AuthService({
    db: deps.db,
    settings: repos.settings,
    sessions: repos.sessions,
    ttlDays: deps.config.sessionTtlDays,
  });
  app.decorate('auth', auth);

  app.decorateRequest('session', null);
  app.decorateRequest('sessionToken', null);

  app.decorate('requireAuth', async (req: FastifyRequest): Promise<void> => {
    if (!req.session) throw unauthorized();
  });

  await app.register(cookie);
  // 导入接口的 multipart 上传分支（attachFieldsToBody: false，按需在路由里 await req.file()）
  await app.register(multipart, { attachFieldsToBody: false });

  // 插件（moz-extension:// / chrome-extension:// 源）与本地开发前端需要跨域访问 API；
  // 自托管单用户场景：全放行 + 允许凭据。鉴权本身靠 Bearer token / same-origin cookie，CORS 不构成额外风险面。
  await app.register(cors, { origin: true, credentials: true, methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] });

  // 生产模式托管前端构建产物（vite build 输出到 <repoRoot>/public）；目录缺失（纯开发）时跳过
  const publicDir = deps.config.webRoot;
  if (existsSync(join(publicDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: publicDir, prefix: '/', index: false });
    // '/' 直接回 index.html（fastifyStatic 在 index:false 时对目录返回 403）
    app.get('/', (_req, reply) => {
      return (reply as unknown as { sendFile: (f: string) => unknown }).sendFile('index.html');
    });
  }

  // 写操作成功后广播事件，SSE 推给网页与插件（不需要每个路由各自 emit）
  app.addHook('onResponse', async (req, reply) => {
    const method = req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
    if (reply.statusCode >= 400) return;
    const url = req.url;
    if (url.startsWith('/api/links') || url.startsWith('/api/reorder/links')) {
      app.events.emit('links-changed', { url, method });
      return;
    }
    if (url.startsWith('/api/groups') || url.startsWith('/api/reorder/groups')) {
      app.events.emit('groups-changed', { url, method });
      app.events.emit('links-changed', { url, method });
    }
  });

  app.addHook('onRequest', async (req) => {
    // M10：静态资源不需要会话，跳过 sha256 + sessions 查库，避免静态文件请求打 DB
    if (!req.url.startsWith('/api/')) return;
    const token = extractToken(req);
    req.sessionToken = token;
    req.session = token ? await auth.authenticate(token) : null;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      reply.code(err.status).send({
        ok: false,
        error: { code: err.code, message: err.message, details: err.details },
      });
      return;
    }
    const generic = err as { statusCode?: number; code?: string; message?: string; validation?: unknown };
    if (generic.validation) {
      reply.code(400).send({
        ok: false,
        error: { code: 'VALIDATION_FAILED', message: '参数不合法', details: generic.validation },
      });
      return;
    }
    if (typeof generic.statusCode === 'number' && generic.statusCode >= 400 && generic.statusCode < 500) {
      reply.code(generic.statusCode).send({
        ok: false,
        error: { code: generic.code ?? 'BAD_REQUEST', message: generic.message ?? '请求不合法' },
      });
      return;
    }
    req.log.error({ err: generic }, '未处理的服务端错误');
    reply.code(500).send({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' },
    });
  });

  // 404：非 /api 的 GET 走 SPA（前端构建产物存在时），其余给结构化 404
  app.setNotFoundHandler((req, reply) => {
    const serving = existsSync(join(deps.config.webRoot, 'index.html'));
    if (serving && req.method === 'GET' && !req.url.startsWith('/api/')) {
      return (reply as unknown as { sendFile: (f: string) => unknown }).sendFile('index.html');
    }
    // 回显前截断并过滤控制字符，避免超长/特殊字符进入响应体
    const shown = req.url.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120);
    reply.code(404).send({
      ok: false,
      error: { code: 'NOT_FOUND', message: '接口不存在: ' + req.method + ' ' + shown },
    });
  });

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(dataRoutes);
  await app.register(dedupeRoutes);
  await app.register(groupRoutes);
  await app.register(linkRoutes);
  await app.register(settingRoutes);
  await app.register(iconRoutes);
  await app.register(syncRoutes);
  await app.register(importExportRoutes);
  await app.register(backupRoutes);
  await app.register(extensionRoutes);
  await app.register(toolsRoutes);
  await app.register(addonDownloadRoutes);

  return app;
}
