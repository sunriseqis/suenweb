import type { FastifyInstance } from 'fastify';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { notFound } from '../../domain/errors.ts';

/**
 * OPS-02：插件包自托管下载。
 * 产物位于 <repoRoot>/addons/dist/（构建生成、不入库）；目录缺失或文件不存在时返回 404 + 指引。
 */
export async function addonDownloadRoutes(app: FastifyInstance): Promise<void> {
  const distDir = join(app.config.repoRoot, 'addons', 'dist');

  app.get('/extension/download/list', async () => {
    if (!existsSync(distDir)) {
      return { ok: true, data: { available: false, files: [], hint: '构建产物目录不存在，先在仓库根目录执行 npm --prefix addons run pack' } };
    }
    const { readdirSync } = await import('node:fs');
    const files = readdirSync(distDir).filter((f) => f.endsWith('.zip') || f.endsWith('.xpi') || f.endsWith('.crx'));
    return { ok: true, data: { available: files.length > 0, files } };
  });

  app.get('/extension/download/:file', async (req, reply) => {
    const name = String((req.params as { file: string }).file);
    if (!/^[\w.-]+\.(zip|xpi|crx)$/.test(name)) throw notFound('文件名不合法');
    const path = join(distDir, name);
    if (!existsSync(path) || !statSync(path).isFile()) throw notFound('插件包不存在：先执行 npm --prefix addons run pack');
    const ext = name.endsWith('.xpi') ? 'application/x-xpinstall' : name.endsWith('.crx') ? 'application/x-chrome-extension' : 'application/zip';
    reply.header('content-type', ext);
    reply.header('content-disposition', 'attachment; filename="' + name + '"');
    return reply.send(createReadStream(path));
  });
}
