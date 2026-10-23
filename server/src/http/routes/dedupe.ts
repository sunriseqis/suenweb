import type { FastifyInstance } from 'fastify';
import { badRequest } from '../../domain/errors.ts';

const ignoreBody = {
  type: 'object',
  required: ['url_normalized', 'group_id'],
  additionalProperties: false,
  properties: {
    url_normalized: { type: 'string', minLength: 1, maxLength: 2048 },
    group_id: { type: 'integer', minimum: 1 },
  },
};

/** 跨组重复的「忽略提示」记录管理：用户选过忽略，就能在这里撤销 */
export async function dedupeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/dedupe/ignores', { preHandler: app.requireAuth }, async () => {
    const ignores = await app.repos.links.listIgnores();
    return { ok: true, data: { ignores } };
  });

  app.post('/api/dedupe/ignores', { preHandler: app.requireAuth, schema: { body: ignoreBody } }, async (req) => {
    const body = req.body as { url_normalized: string; group_id: number };
    await app.repos.links.rememberIgnore(body.url_normalized, body.group_id);
    return { ok: true, data: { ignored: true } };
  });

  app.delete('/api/dedupe/ignores', { preHandler: app.requireAuth, schema: { body: ignoreBody } }, async (req) => {
    const body = req.body as { url_normalized: string; group_id: number };
    const removed = await app.repos.links.forgetIgnore(body.url_normalized, body.group_id);
    if (removed === 0) throw badRequest('IGNORE_NOT_FOUND', '没有对应的忽略记录');
    return { ok: true, data: { removed } };
  });
}
