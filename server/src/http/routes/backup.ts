import type { FastifyInstance } from 'fastify';
import { badRequest } from '../../domain/errors.ts';
import type { BackupService } from '../../infra/backupService.ts';

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  const svc = (): BackupService => (app as unknown as { backup: BackupService }).backup;

  app.get('/api/backup/status', { preHandler: app.requireAuth }, async () => ({
    ok: true,
    data: await svc().status(),
  }));

  app.post('/api/backup/config', { preHandler: app.requireAuth }, async (req) => {
    const body = (req.body ?? {}) as { url?: string; username?: string; password?: string; keepCount?: number; adminPassword?: string };
    const url = String(body.url ?? '');
    const username = String(body.username ?? '');
    const password = String(body.password ?? '');
    if (!url) throw badRequest('WEBDAV_URL_REQUIRED', 'WebDAV 地址不能为空');
    await svc().saveConfig({ url, username, password, keepCount: body.keepCount });
    // BAK-07：配置时校验管理密码并初始化备份密钥（服务端随机生成、包裹存储）
    if (body.adminPassword) await svc().ensureWrappedKey(String(body.adminPassword));
    const test = await svc().test();
    return { ok: true, data: { saved: true, ...test } };
  });

  app.post('/api/backup/test', { preHandler: app.requireAuth }, async () => {
    const test = await svc().test();
    return { ok: true, data: test };
  });

  app.post('/api/backup/run', { preHandler: app.requireAuth }, async (req) => {
    const body = (req.body ?? {}) as { kind?: 'auto' | 'manual' };
    const result = await svc().runBackup(body.kind === 'auto' ? 'auto' : 'manual');
    return { ok: true, data: result };
  });

  app.get('/api/backup/list', { preHandler: app.requireAuth }, async () => ({
    ok: true,
    data: { backups: await svc().list() },
  }));

  /** 下载解密后的内容（需管理密码）；返回明文 JSON 快照供预览/导入 */
  app.post('/api/backup/download', { preHandler: app.requireAuth }, async (req) => {
    const body = (req.body ?? {}) as { name?: string; password?: string };
    const name = String(body.name ?? '');
    const password = String(body.password ?? '');
    if (!name) throw badRequest('BACKUP_NAME_REQUIRED', '缺少备份文件名');
    const text = await svc().fetchDecrypted(name, password);
    const snapshot = JSON.parse(text) as object;
    return { ok: true, data: { snapshot } };
  });
}
