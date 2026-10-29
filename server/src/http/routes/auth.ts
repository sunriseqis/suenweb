import type { FastifyInstance, FastifyReply } from 'fastify';
import { FailureLimiter } from '../plugins/rate-limit.ts';
import { SESSION_COOKIE, deviceLabel } from '../plugins/auth.ts';

const passwordBody = {
  type: 'object',
  required: ['password'],
  additionalProperties: false,
  properties: {
    password: { type: 'string', minLength: 1, maxLength: 200 },
    device: { type: 'string', maxLength: 120 },
  },
};

const changePasswordBody = {
  type: 'object',
  required: ['currentPassword', 'newPassword'],
  additionalProperties: false,
  properties: {
    currentPassword: { type: 'string', minLength: 1, maxLength: 200 },
    newPassword: { type: 'string', minLength: 6, maxLength: 200 },
  },
};

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const limiter = new FailureLimiter(5, 60000);

  app.post('/api/auth/setup', { schema: { body: passwordBody } }, async (req, reply) => {
    const body = req.body as { password: string; device?: string };
    const session = await app.auth.setup(body.password, body.device ?? deviceLabel(req));
    setSessionCookie(app, reply, session.token);
    req.log.info({ device: body.device ?? deviceLabel(req) }, '管理密码已设置');
    return { ok: true, data: { token: session.token, expiresAt: session.expiresAt } };
  });

  app.post('/api/auth/login', { schema: { body: passwordBody } }, async (req, reply) => {
    const body = req.body as { password: string; device?: string };
    const key = req.ip;
    limiter.assertAllowed(key);
    try {
      const session = await app.auth.login(body.password, body.device ?? deviceLabel(req));
      limiter.reset(key);
      // 成功时也顺带清理过期记录，避免 hits Map 无界增长
      limiter.cleanup();
      setSessionCookie(app, reply, session.token);
      return { ok: true, data: { token: session.token, expiresAt: session.expiresAt } };
    } catch (err) {
      limiter.fail(key);
      throw err;
    }
  });

  app.post('/api/auth/logout', { preHandler: app.requireAuth }, async (req, reply) => {
    await app.auth.logout(req.sessionToken);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true, data: { loggedOut: true } };
  });

  app.get('/api/auth/status', async (req) => {
    const initialized = await app.auth.isInitialized();
    return {
      ok: true,
      data: {
        initialized,
        authenticated: Boolean(req.session),
        device: req.session ? req.session.device : null,
        expiresAt: req.session ? req.session.expires_at : null,
      },
    };
  });

  app.post('/api/auth/change-password', { preHandler: app.requireAuth, schema: { body: changePasswordBody } }, async (req) => {
    const body = req.body as { currentPassword: string; newPassword: string };
    await app.auth.changePassword(body.currentPassword, body.newPassword, req.sessionToken);
    return { ok: true, data: { changed: true } };
  });
}

function setSessionCookie(app: FastifyInstance, reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: app.config.secureCookies,
    maxAge: app.config.sessionTtlDays * 86400,
  });
}
