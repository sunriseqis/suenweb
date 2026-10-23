import type { FastifyInstance } from 'fastify';
import { badRequest } from '../../domain/errors.ts';

export async function settingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async () => {
    const settings = await app.repos.settings.getPublic();
    return { ok: true, data: { settings } };
  });

  app.put('/api/settings', { preHandler: app.requireAuth }, async (req) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw badRequest('INVALID_BODY', '设置必须是键值对象');
    }
    await app.repos.settings.setMany(body as Record<string, unknown>);
    const settings = await app.repos.settings.getPublic();
    return { ok: true, data: { settings } };
  });
}
