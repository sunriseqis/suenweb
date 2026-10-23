import type { FastifyInstance } from 'fastify';
import { badRequest } from '../../domain/errors.ts';

const DOMAIN = /^[a-z0-9.-]+(:[0-9]{1,5})?$/i;

/**
 * GET /api/icon?domain=host[:port]
 * 只发缓存。抓取仅发生在已登录用户请求且设置开启 ui.fetch_icons 时；访客永远只读缓存。
 */
export async function iconRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/icon', async (req, reply) => {
    const raw = (req.query as { domain?: string }).domain ?? '';
    const domain = raw.trim().toLowerCase();
    if (!DOMAIN.test(domain)) throw badRequest('INVALID_DOMAIN', '域名不合法');

    const origin = 'https://' + domain;
    const cached = await app.icons.read(origin);
    if (cached.status === 'hit') {
      reply.header('cache-control', 'public, max-age=604800, immutable');
      reply.type(cached.icon.type);
      return reply.send(cached.icon.data);
    }
    if (cached.status === 'negative') {
      reply.code(404);
      return { ok: false, error: { code: 'ICON_UNAVAILABLE', message: '该站点没有可用图标' } };
    }

    const enabled = await app.repos.settings.getValue<boolean>('ui.fetch_icons', false);
    if (!enabled) {
      reply.code(404);
      return { ok: false, error: { code: 'ICONS_DISABLED', message: '站点图标抓取未开启' } };
    }
    if (!req.session) {
      reply.code(404);
      return { ok: false, error: { code: 'ICON_NOT_CACHED', message: '访客只能读已缓存的图标' } };
    }

    const resolved = await app.icons.resolve(origin);
    if (resolved.status !== 'hit') {
      reply.code(404);
      return { ok: false, error: { code: 'ICON_UNAVAILABLE', message: '没有取到该站点的图标' } };
    }
    reply.header('cache-control', 'public, max-age=604800, immutable');
    reply.type(resolved.icon.type);
    return reply.send(resolved.icon.data);
  });
}
