import type { FastifyInstance } from 'fastify';
import type { GroupInput } from '../../data/repositories/groups.ts';

const groupBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', maxLength: 40 },
    icon: { type: ['string', 'null'], maxLength: 500 },
    type: { type: 'string', enum: ['fixed', 'tab'] },
    display_mode: { type: 'string', enum: ['grid', 'list', 'icon'] },
    layout_mode: { type: 'string', enum: ['single', 'multi', 'auto'] },
  },
};

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer', minimum: 1 } },
};

const reorderBody = {
  type: 'object',
  required: ['ids'],
  additionalProperties: false,
  properties: {
    ids: {
      type: 'array',
      maxItems: 2000,
      items: { type: 'integer', minimum: 1 },
    },
  },
};

export async function groupRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/groups', { preHandler: app.requireAuth, schema: { body: groupBody } }, async (req, reply) => {
    const result = await app.repos.groups.create(req.body as GroupInput);
    reply.code(result.merged ? 200 : 201);
    return { ok: true, data: result };
  });

  app.put('/api/groups/:id', { preHandler: app.requireAuth, schema: { params: idParams, body: groupBody } }, async (req) => {
    const params = req.params as { id: number };
    const result = await app.repos.groups.update(params.id, req.body as GroupInput);
    return { ok: true, data: result };
  });

  app.delete('/api/groups/:id', { preHandler: app.requireAuth, schema: { params: idParams } }, async (req) => {
    const params = req.params as { id: number };
    await app.repos.groups.remove(params.id);
    return { ok: true, data: { deleted: params.id } };
  });

  app.post('/api/reorder/groups', { preHandler: app.requireAuth, schema: { body: reorderBody } }, async (req) => {
    const body = req.body as { ids: number[] };
    const groups = await app.repos.groups.reorder(body.ids);
    return { ok: true, data: { groups } };
  });
}
