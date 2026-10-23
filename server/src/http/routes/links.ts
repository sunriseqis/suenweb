import type { FastifyInstance } from 'fastify';
import type { LinkInput } from '../../data/repositories/links.ts';

const linkProperties = {
  group_id: { type: 'integer', minimum: 1 },
  title: { type: 'string', maxLength: 200 },
  url: { type: 'string', minLength: 1, maxLength: 2048 },
  description: { type: ['string', 'null'], maxLength: 2000 },
  icon: { type: ['string', 'null'], maxLength: 500 },
  icon_type: { type: 'string', enum: ['auto', 'emoji', 'url', 'none'] },
};

const createBody = {
  type: 'object',
  required: ['group_id', 'url'],
  additionalProperties: false,
  properties: linkProperties,
};

const linkBody = {
  type: 'object',
  additionalProperties: false,
  properties: linkProperties,
};

const moveBody = {
  type: 'object',
  required: ['group_id'],
  additionalProperties: false,
  properties: { group_id: { type: 'integer', minimum: 1 } },
};

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer', minimum: 1 } },
};

const reorderBody = {
  type: 'object',
  required: ['group_id', 'ids'],
  additionalProperties: false,
  properties: {
    group_id: { type: 'integer', minimum: 1 },
    ids: { type: 'array', maxItems: 5000, items: { type: 'integer', minimum: 1 } },
  },
};

export async function linkRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/links', { preHandler: app.requireAuth, schema: { body: createBody } }, async (req, reply) => {
    const result = await app.repos.links.create(req.body as LinkInput);
    reply.code(result.merged ? 200 : 201);
    return { ok: true, data: result };
  });

  app.put('/api/links/:id', { preHandler: app.requireAuth, schema: { params: idParams, body: linkBody } }, async (req) => {
    const params = req.params as { id: number };
    const result = await app.repos.links.update(params.id, req.body as LinkInput);
    return { ok: true, data: result };
  });

  app.delete('/api/links/:id', { preHandler: app.requireAuth, schema: { params: idParams } }, async (req) => {
    const params = req.params as { id: number };
    await app.repos.links.remove(params.id);
    return { ok: true, data: { deleted: params.id } };
  });

  app.post('/api/links/:id/move', { preHandler: app.requireAuth, schema: { params: idParams, body: moveBody } }, async (req) => {
    const params = req.params as { id: number };
    const body = req.body as { group_id: number };
    const result = await app.repos.links.move(params.id, body.group_id);
    return { ok: true, data: result };
  });

  app.post('/api/reorder/links', { preHandler: app.requireAuth, schema: { body: reorderBody } }, async (req) => {
    const body = req.body as { group_id: number; ids: number[] };
    const links = await app.repos.links.reorder(body.group_id, body.ids);
    return { ok: true, data: { links } };
  });
}
