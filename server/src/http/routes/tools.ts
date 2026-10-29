import type { FastifyInstance } from 'fastify';
import { badRequest } from '../../domain/errors.ts';
import { isPrivateHost } from '../../domain/isPrivateHost.ts';
import { normalizeUrl } from '../../domain/normalize.ts';

const DOMAIN = /^[a-z0-9.-]+(:[0-9]{1,5})?$/i;

export async function toolsRoutes(app: FastifyInstance): Promise<void> {
  /** TOOL-02：重复链接聚类检测（全库按归一化 URL 分组，跨组重复才列出） */
  app.get('/api/tools/duplicates', { preHandler: app.requireAuth }, async () => {
    const rows = await app.db.all<{ id: number; group_id: number; title: string; url: string; url_normalized: string; group_name: string }>(
      'SELECT l.id, l.group_id, l.title, l.url, l.url_normalized, g.name AS group_name FROM links l JOIN groups g ON g.id = l.group_id ORDER BY l.url_normalized, l.group_id',
    );
    const clusters = new Map<string, Array<{ id: number; group_id: number; title: string; url: string; group_name: string }>>();
    for (const row of rows) {
      const list = clusters.get(row.url_normalized) ?? [];
      list.push({ id: row.id, group_id: row.group_id, title: row.title, url: row.url, group_name: row.group_name });
      clusters.set(row.url_normalized, list);
    }
    const duplicates: Array<{ url_normalized: string; occurrences: Array<{ id: number; group_id: number; title: string; url: string; group_name: string }> }> = [];
    for (const [normalized, occurrences] of clusters) {
      if (occurrences.length > 1) duplicates.push({ url_normalized: normalized, occurrences });
    }
    return { ok: true, data: { duplicates, total: duplicates.length } };
  });

  /**
   * TOOL-02：批量删除重复链接。keepIds 语义沿用前端 openDuplicatesDialog：
   * 传的是「要删除的 id 列表」（保留第一条、删其余）。安全校验：每个 id
   * 必须确实存在于跨组重复聚类中，且禁止删除某个 url_normalized 聚类的
   * 全部成员（每簇至少保留一条），越界 id 拒绝。
   */
  app.post('/api/tools/duplicates/delete', { preHandler: app.requireAuth }, async (req) => {
    const body = (req.body ?? {}) as { keepIds?: number[] };
    const ids = [...new Set((body.keepIds ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (ids.length === 0) throw badRequest('KEEP_IDS_REQUIRED', 'keepIds 不能为空');

    // 按 url_normalized 聚类全库链接，与检测接口同一口径
    const rows = await app.db.all<{ id: number; url_normalized: string }>('SELECT id, url_normalized FROM links');
    const clusters = new Map<string, number[]>();
    const idToCluster = new Map<number, string>();
    for (const row of rows) {
      const list = clusters.get(row.url_normalized) ?? [];
      list.push(row.id);
      clusters.set(row.url_normalized, list);
      idToCluster.set(row.id, row.url_normalized);
    }
    const deleteCount = new Map<string, number>();
    for (const id of ids) {
      const key = idToCluster.get(id);
      // 不存在，或不属于任何跨组重复聚类（簇成员数 < 2）→ 不是合法删除目标
      if (!key || (clusters.get(key)?.length ?? 0) < 2) {
        throw badRequest('INVALID_DELETE_TARGET', 'id ' + id + ' 不在重复链接聚类中，拒绝删除');
      }
      deleteCount.set(key, (deleteCount.get(key) ?? 0) + 1);
    }
    for (const [key, count] of deleteCount) {
      if (count >= (clusters.get(key)?.length ?? 0)) {
        throw badRequest('INVALID_DELETE_TARGET', '聚类 ' + key + ' 的全部成员都在删除列表中，至少需保留一条');
      }
    }

    await app.db.batch(ids.map((id) => ({ sql: 'DELETE FROM links WHERE id = ?', params: [id] })));
    app.events.emit('links-changed', { url: '/api/tools/duplicates/delete', method: 'POST' });
    return { ok: true, data: { deleted: ids.length } };
  });

  /** TOOL-05：站点图标手动刷新（清正负缓存并立即重抓） */
  app.post('/api/tools/icon-refresh', { preHandler: app.requireAuth }, async (req) => {
    const body = (req.body ?? {}) as { domain?: string };
    const domain = String(body.domain ?? '').trim().toLowerCase();
    if (!DOMAIN.test(domain)) throw badRequest('INVALID_DOMAIN', '域名不合法');
    const origin = 'https://' + domain;
    await app.icons.purge(origin);
    const enabled = await app.repos.settings.getValue<boolean>('ui.fetch_icons', false);
    if (!enabled) return { ok: true, data: { purged: true, refetched: false, reason: '抓取未开启，已清除旧缓存' } };
    const resolved = await app.icons.resolve(origin);
    return { ok: true, data: { purged: true, refetched: true, status: resolved.status } };
  });

  /** TOOL-03：失效链接检测（批量探活，结果保存到 settings 供复查） */
  app.post('/api/tools/check-links', { preHandler: app.requireAuth }, async (req) => {
    const body = (req.body ?? {}) as { limit?: number };
    const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 500);
    const links = await app.db.all<{ id: number; url: string; title: string; group_name: string }>(
      'SELECT l.id, l.url, l.title, g.name AS group_name FROM links l JOIN groups g ON g.id = l.group_id ORDER BY l.updated_at DESC LIMIT ' + limit,
    );
    const results: Array<{ id: number; title: string; url: string; group_name: string; ok: boolean; status: number | null }> = [];
    const concurrency = Math.min(app.config?.outboundConcurrency ?? 8, 16);
    let index = 0;
    async function worker(): Promise<void> {
      while (index < links.length) {
        const link = links[index++];
        let ok = false;
        let status: number | null = null;
        try {
          // M9 SSRF：私网地址直接判失败，不发请求
          if (isPrivateHost(new URL(link.url).hostname)) {
            ok = false;
            status = null;
            results.push({ id: link.id, title: link.title, url: link.url, group_name: link.group_name, ok, status });
            continue;
          }
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 6000);
          const response = await fetch(link.url, { signal: controller.signal, redirect: 'follow', method: 'GET', headers: { 'user-agent': 'SuenWeb/2.0 (+link-check)' } });
          clearTimeout(timer);
          status = response.status;
          ok = response.status < 400;
          // M14：消费完 body 再进下一条，避免连接/流悬挂
          await response.body?.cancel().catch(() => {});
        } catch {
          ok = false;
        }
        results.push({ id: link.id, title: link.title, url: link.url, group_name: link.group_name, ok, status });
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, links.length) }, worker));
    const dead = results.filter((r) => !r.ok);
    await app.repos.settings.set('tools.dead_links', { checkedAt: new Date().toISOString(), dead });
    return { ok: true, data: { checked: results.length, deadCount: dead.length, dead } };
  });

  /** TOOL-03：读取上次检测结果 */
  app.get('/api/tools/check-links', { preHandler: app.requireAuth }, async () => {
    const saved = await app.repos.settings.getValue<{ checkedAt: string; dead: Array<{ id: number; title: string; url: string; group_name: string; status: number | null }> } | null>('tools.dead_links', null);
    return { ok: true, data: { result: saved } };
  });

  /** TOOL-03：删除失效项 */
  app.post('/api/tools/dead-links/delete', { preHandler: app.requireAuth }, async (req) => {
    const body = (req.body ?? {}) as { ids?: number[] };
    const ids = (body.ids ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length === 0) throw badRequest('IDS_REQUIRED', 'ids 不能为空');
    await app.db.batch(ids.map((id) => ({ sql: 'DELETE FROM links WHERE id = ?', params: [id] })));
    app.events.emit('links-changed', { url: '/api/tools/dead-links/delete', method: 'POST' });
    return { ok: true, data: { deleted: ids.length } };
  });
}
