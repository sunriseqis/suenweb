import type { FastifyInstance } from 'fastify';
import { badRequest } from '../../domain/errors.ts';

const DOMAIN = /^[a-z0-9.-]+(:[0-9]{1,5})?$/i;

/**
 * GET /api/icon?domain=host:port —— 只发缓存里的图标。
 * 抓取只发生在已登录用户请求、且设置里开启 ui.fetch_icons 的情况下；访客永远只读缓存。
 */
export async function iconRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/icon', async (req, reply) => {
    const raw = (req.query as { domain?: string }).domain ?? '';
    const domain = raw.trim().toLowerCase();
    if (!DOMAIN.test(domain)) throw badRequest('INVALID_DOMAIN', '域名不合法');

    const origin = 'https://' + domain;
    const cached = await app.icons.read(origin);
    if (cached) {
      reply.header('cache-control', 'public, max-age=604800, immutable');
      reply.type(cached.type);
      return reply.send(cached.data);
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

    const fetched = await app.icons.fetchAndStore(origin);
    if (!fetched) {
      reply.code(404);
      return { ok: false, error: { code: 'ICON_UNAVAILABLE', message: '没有取到该站点的图标' } };
    }
    reply.header('cache-control', 'public, max-age=604800, immutable');
    reply.type(fetched.type);
    return reply.send(fetched.data);
  });
}
