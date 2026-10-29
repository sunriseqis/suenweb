import type { FastifyInstance } from 'fastify';
import { badRequest } from '../../domain/errors.ts';
import { extractToken } from '../plugins/auth.ts';

const HEARTBEAT_KEY = 'sync.last_heartbeat';
const DEVICE_KEY = 'sync.last_device';

const ackBody = {
  type: 'object',
  required: ['ids'],
  additionalProperties: false,
  properties: {
    ids: { type: 'array', minItems: 1, maxItems: 500, items: { type: 'integer', minimum: 1 } },
    ok: { type: 'boolean' },
  },
};

const heartbeatBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    device: { type: 'string', maxLength: 120 },
  },
};

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  /** 插件心跳：记录设备与时间，顺手返回待同步数量 */
  app.post('/api/sync/heartbeat', { preHandler: app.requireAuth, schema: { body: heartbeatBody } }, async (req) => {
    const body = (req.body ?? {}) as { device?: string };
    const device = body.device ?? req.session?.device ?? 'unknown';
    const now = new Date().toISOString();
    await app.repos.settings.set(HEARTBEAT_KEY, now);
    await app.repos.settings.set(DEVICE_KEY, device);
    const pending = await app.db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM links WHERE sync_state = 'pending'",
    );
    return { ok: true, data: { at: now, device, pending: pending ? Number(pending.count) : 0 } };
  });

  app.get('/api/sync/status', { preHandler: app.requireAuth }, async () => {
    const rows = await app.db.all<{ sync_state: string; count: number }>(
      'SELECT sync_state, COUNT(*) AS count FROM links GROUP BY sync_state',
    );
    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.sync_state] = Number(row.count);
    const lastHeartbeat = await app.repos.settings.getValue<string>(HEARTBEAT_KEY, '');
    const lastDevice = await app.repos.settings.getValue<string>(DEVICE_KEY, '');
    return {
      ok: true,
      data: {
        pending: counts.pending ?? 0,
        synced: counts.synced ?? 0,
        failed: counts.failed ?? 0,
        lastHeartbeat,
        lastDevice,
        sseClients: app.events.listenerCount('links-changed'),
      },
    };
  });

  /** 插件取待同步书签：按入队时间排序，一次最多 200 条 */
  app.get('/api/sync/pending', { preHandler: app.requireAuth }, async (req) => {
    const limitRaw = Number((req.query as { limit?: string }).limit ?? 200);
    const limit = Number.isFinite(limitRaw) ? Math.trunc(Math.min(Math.max(limitRaw, 1), 500)) : 200;
    const links = await app.db.all(
      "SELECT id, group_id, title, url FROM links WHERE sync_state = 'pending' ORDER BY id LIMIT " + limit,
    );
    return { ok: true, data: { links } };
  });

  /** 插件回执：只有真正写进浏览器书签后才允许调用（失败也要回报 ok=false） */
  app.post('/api/sync/ack', { preHandler: app.requireAuth, schema: { body: ackBody } }, async (req) => {
    const body = req.body as { ids: number[]; ok?: boolean };
    if (!Array.isArray(body.ids) || body.ids.length === 0) throw badRequest('INVALID_IDS', 'ids 不能为空');
    const ok = body.ok !== false;
    const sql = ok
      ? 'UPDATE links SET sync_state = ?, synced_at = strftime(?, ?) WHERE id = ?'
      : 'UPDATE links SET sync_state = ? WHERE id = ?';
    const statements = body.ids.map((id) =>
      ok
        ? { sql, params: ['synced', '%Y-%m-%dT%H:%M:%fZ', 'now', id] }
        : { sql, params: ['failed', id] },
    );
    await app.db.batch(statements);
    app.events.emit('links-changed', { reason: 'ack', ok, count: body.ids.length });
    return { ok: true, data: { acked: body.ids.length, state: ok ? 'synced' : 'failed' } };
  });

  /**
   * SSE：网页与插件保持长连接，收到 links-changed 就刷新。
   * M11：与页面一致的鉴权（会话 cookie 或 Bearer）。EventSource 不支持自定义 header，
   * 插件走 URL query 传 token（?token=），extractToken 对 query 参数兜底解析。
   */
  app.get('/api/events/stream', { preHandler: app.requireAuth }, async (req, reply) => {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.write(': connected' + String.fromCharCode(10, 10));

    const send = (event: string, payload: unknown): void => {
      // M11：连接可能已在中途销毁，写之前检查
      if (reply.raw.destroyed) return;
      reply.raw.write('event: ' + event + String.fromCharCode(10) + 'data: ' + JSON.stringify(payload) + String.fromCharCode(10, 10));
    };
    const offLink = app.events.on('links-changed', (payload) => send('links-changed', payload));
    const offGroup = app.events.on('groups-changed', (payload) => send('groups-changed', payload));
    const ping = setInterval(() => send('ping', { at: Date.now() }), 25000);

    const cleanup = (): void => {
      clearInterval(ping);
      offLink();
      offGroup();
    };
    req.raw.on('close', cleanup);
    req.raw.on('error', cleanup);
    return reply;
  });
}
