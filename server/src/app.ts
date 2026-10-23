import cookie from '@fastify/cookie';
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
import { extractToken } from './http/plugins/auth.ts';
import { authRoutes } from './http/routes/auth.ts';
import { dataRoutes } from './http/routes/data.ts';
import { dedupeRoutes } from './http/routes/dedupe.ts';
import { groupRoutes } from './http/routes/groups.ts';
import { healthRoutes } from './http/routes/health.ts';
import { linkRoutes } from './http/routes/links.ts';
import { settingRoutes } from './http/routes/settings.ts';
import type { Logger } from './infra/logger.ts';

export type Repos = {
  groups: GroupsRepo;
  links: LinksRepo;
  settings: SettingsRepo;
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
  }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: deps.logger as unknown as FastifyBaseLogger,
    trustProxy: true,
    bodyLimit: 4 * 1024 * 1024,
  });

  const repos: Repos = {
    groups: new GroupsRepo(deps.db),
    links: new LinksRepo(deps.db),
    settings: new SettingsRepo(deps.db),
    sessions: new SessionsRepo(deps.db),
  };

  app.decorate('config', deps.config);
  app.decorate('db', deps.db);
  app.decorate('repos', repos);

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

  app.addHook('onRequest', async (req) => {
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

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({
      ok: false,
      error: { code: 'NOT_FOUND', message: '接口不存在: ' + req.method + ' ' + req.url },
    });
  });

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(dataRoutes);
  await app.register(dedupeRoutes);
  await app.register(groupRoutes);
  await app.register(linkRoutes);
  await app.register(settingRoutes);

  return app;
}
