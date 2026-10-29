import type { FastifyInstance } from 'fastify';
import { badRequest, notFound } from '../../domain/errors.ts';
import type { ExtensionsRepo } from '../../data/repositories/extensions.ts';

export async function extensionRoutes(app: FastifyInstance): Promise<void> {
  const repo = (): ExtensionsRepo => app.repos.extensions;

  /** EXT-01：插件上报（按浏览器全量替换） */
  app.post('/api/extensions', { preHandler: app.requireAuth }, async (req) => {
    const body = (req.body ?? {}) as { browser?: string; extensions?: Array<{ ext_id?: unknown; name?: unknown; version?: unknown; url?: unknown }> };
    if (!Array.isArray(body.extensions)) throw badRequest('INVALID_EXTENSIONS', 'extensions 必须是数组');
    const result = await repo().replace(body.browser, body.extensions);
    return { ok: true, data: result };
  });

  /** EXT-02：云端清单（导航页展示） */
  app.get('/api/extensions', { preHandler: app.requireAuth }, async () => {
    const rows = await repo().list();
    const byBrowser: Record<string, Array<{ id: number; ext_id: string; name: string; version: string; url: string | null }>> = {};
    for (const row of rows) {
      (byBrowser[row.browser] ??= []).push({ id: row.id, ext_id: row.ext_id, name: row.name, version: row.version, url: row.url });
    }
    return { ok: true, data: { byBrowser, total: rows.length } };
  });

  /** EXT-02：删除单条 */
  app.delete('/api/extensions/:id', { preHandler: app.requireAuth }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id < 1) throw badRequest('INVALID_ID', 'id 不合法');
    const removed = await repo().deleteById(id);
    if (!removed) throw notFound('记录不存在');
    return { ok: true, data: { removed } };
  });
}
