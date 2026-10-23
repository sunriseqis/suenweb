import type { FastifyInstance } from 'fastify';
import type { LinkRow } from '../../data/repositories/links.ts';

export async function dataRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/data', async () => {
    const [groups, links, settings] = await Promise.all([
      app.repos.groups.list(),
      app.repos.links.listAll(),
      app.repos.settings.getPublic(),
    ]);
    const buckets = new Map<number, LinkRow[]>();
    for (const link of links) {
      const bucket = buckets.get(link.group_id);
      if (bucket) bucket.push(link);
      else buckets.set(link.group_id, [link]);
    }
    return {
      ok: true,
      data: {
        groups: groups.map((group) => ({ ...group, links: buckets.get(group.id) ?? [] })),
        settings,
        meta: { groupCount: groups.length, linkCount: links.length, mode: 'public' },
      },
    };
  });
}
