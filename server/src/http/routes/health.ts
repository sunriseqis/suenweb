import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  const handler = async () => ({
    ok: true,
    data: {
      status: 'ok',
      version: app.config.version,
      uptime: Math.round(process.uptime()),
      time: new Date().toISOString(),
    },
  });
  app.get('/health', handler);
  app.get('/api/health', handler);
}
