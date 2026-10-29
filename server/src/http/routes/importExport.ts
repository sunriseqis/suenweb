import type { FastifyInstance } from 'fastify';
import { badRequest } from '../../domain/errors.ts';
import { parseBookmarksHtml, renderBookmarksHtml } from '../../domain/bookmarkIo.ts';
import { commitImport, previewImport, restoreFullSnapshot } from '../../domain/importExport.ts';
import { decryptBackup, encryptBackup } from '../../infra/backupCrypto.ts';
import { verifyPassword } from '../../infra/crypto.ts';

// M12：导入/恢复的 base64 快照体积可观，路由级放宽（server 级 4MB 不动）
const IMPORT_BODY_LIMIT = 64 * 1024 * 1024;

type Snapshot = {
  version: number;
  exportedAt: string;
  groups: Array<{ name: string; links: Array<{ title: string; url: string; description?: string | null; created_at?: string }> }>;
};

export async function importExportRoutes(app: FastifyInstance): Promise<void> {
  const adminPasswordHash = async (): Promise<string | null> => {
    const { ADMIN_HASH_KEY } = await import('../../domain/authService.ts');
    return app.repos.settings.getValue<string>(ADMIN_HASH_KEY, '');
  };

  /** IMP-01/02 预览：上传 HTML（或浏览器 JSON），返回每组统计，不入库 */
  app.post('/api/import/preview', { preHandler: app.requireAuth }, async (req, reply) => {
    const contentType = req.headers['content-type'] ?? '';
    let html = '';
    if (contentType.includes('multipart/form-data')) {
      // @fastify/multipart（attachFieldsToBody: false）：await req.file() 流式取第一个文件字段
      const file = await req.file();
      if (!file) throw badRequest('NO_FILE', '没有收到文件');
      const buf = await file.toBuffer();
      html = buf.toString('utf8');
    } else {
      const body = (req.body ?? {}) as { html?: string };
      html = String(body.html ?? '');
    }
    if (!html.trim()) throw badRequest('EMPTY_IMPORT', '导入内容为空');
    const parsed = parseBookmarksHtml(html);
    const preview = await previewImport(app.db, parsed.folders);
    return {
      ok: true,
      data: {
        ...preview,
        parseInvalid: parsed.invalid,
      },
    };
  });

  /** IMP-01/02 提交：body 可带 html 重解析（预览与提交共用一份内容），cross_group=allow|skip */
  app.post('/api/import/commit', { preHandler: app.requireAuth }, async (req) => {
    const body = (req.body ?? {}) as { html?: string; cross_group?: 'allow' | 'skip' };
    const html = String(body.html ?? '');
    if (!html.trim()) throw badRequest('EMPTY_IMPORT', '导入内容为空');
    const parsed = parseBookmarksHtml(html);
    const result = await commitImport(app.db, parsed.folders, body.cross_group === 'skip' ? 'skip' : 'allow');
    app.events.emit('links-changed', { url: '/api/import/commit', method: 'POST' });
    return { ok: true, data: result };
  });

  /** 备份还原通道：插件/网页从 WebDAV 解密出的快照直接恢复（密码已在 download 接口验证过，这里再验一次） */
  app.post('/api/config/restore-snapshot', { preHandler: app.requireAuth, bodyLimit: IMPORT_BODY_LIMIT }, async (req) => {
    const body = (req.body ?? {}) as { password?: string; snapshot?: { groups?: Array<{ name: string; links?: Array<{ title: string; url: string }> }> }; confirm?: boolean };
    const password = String(body.password ?? '');
    const hash = await adminPasswordHash();
    if (!(await verifyPassword(password, hash))) throw badRequest('WRONG_PASSWORD', '密码不正确');
    const snapshot = body.snapshot;
    if (!snapshot || !Array.isArray(snapshot.groups)) throw badRequest('CORRUPT_BACKUP', '备份内容无法识别');
    if (body.confirm !== true) {
      const total = snapshot.groups.reduce((sum, g) => sum + (g.links?.length ?? 0), 0);
      return { ok: true, data: { needsConfirm: true, groups: snapshot.groups.length, links: total } };
    }
    const result = await restoreFullSnapshot(app.db, { groups: snapshot.groups.map((g) => ({ name: g.name, items: (g.links ?? []).map((l) => ({ title: l.title, url: l.url })) })) });
    app.events.emit('groups-changed', { url: '/api/config/restore-snapshot', method: 'POST' });
    app.events.emit('links-changed', { url: '/api/config/restore-snapshot', method: 'POST' });
    return { ok: true, data: { restored: result } };
  });

  /** IMP-03 导出：Netscape HTML（attachment 下载） */
  app.get('/api/export/bookmarks', { preHandler: app.requireAuth }, async (_req, reply) => {
    const groups = await app.repos.groups.list();
    const allLinks = await app.repos.links.listAll();
    const payload = groups.map((group) => ({
      name: group.name,
      links: allLinks
        .filter((link) => link.group_id === group.id)
        .map((link) => ({ title: link.title, url: link.url, description: link.description, created_at: link.created_at })),
    }));
    const html = renderBookmarksHtml(payload);
    reply.header('content-type', 'text/html; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="suenweb-bookmarks-' + new Date().toISOString().slice(0, 10) + '.html"');
    return html;
  });

  /** IMP-04 全量导出（SWB1 加密，密钥 = 管理密码） */
  app.post('/api/config/export', { preHandler: app.requireAuth }, async (req) => {
    const body = (req.body ?? {}) as { password?: string };
    const password = String(body.password ?? '');
    const hash = await adminPasswordHash();
    if (!password) throw badRequest('PASSWORD_REQUIRED', '导出加密需要输入管理密码');
    if (!(await verifyPassword(password, hash))) throw badRequest('WRONG_PASSWORD', '密码不正确');
    const groups = await app.repos.groups.list();
    const allLinks = await app.repos.links.listAll();
    const snapshot: Snapshot = {
      version: 1,
      exportedAt: new Date().toISOString(),
      groups: groups.map((group) => ({
        name: group.name,
        links: allLinks
          .filter((link) => link.group_id === group.id)
          .map((link) => ({ title: link.title, url: link.url, description: link.description, created_at: link.created_at })),
      })),
    };
    const blob = await encryptBackup(password, JSON.stringify(snapshot));
    return {
      ok: true,
      data: {
        format: 'SWB1',
        exportedAt: snapshot.exportedAt,
        groups: snapshot.groups.length,
        links: snapshot.groups.reduce((sum, g) => sum + g.links.length, 0),
        // base64 交付（前端存成 .swb1 文件）
        file: blob.toString('base64'),
      },
    };
  });

  /** IMP-05 全量导入：先验密码解密，再展示/确认由前端负责；这里提供恢复执行 */
  app.post('/api/config/import', { preHandler: app.requireAuth, bodyLimit: IMPORT_BODY_LIMIT }, async (req) => {
    const body = (req.body ?? {}) as { password?: string; file?: string; confirm?: boolean };
    const password = String(body.password ?? '');
    const fileB64 = String(body.file ?? '');
    if (!password || !fileB64) throw badRequest('PASSWORD_REQUIRED', '需要密码与备份文件');
    const hash = await adminPasswordHash();
    // 用管理密码双保险：先验证密码本身，再解密（GCM 校验）
    if (!(await verifyPassword(password, hash))) throw badRequest('WRONG_PASSWORD', '密码不正确');
    let snapshot: Snapshot;
    try {
      snapshot = JSON.parse(await decryptBackup(password, Buffer.from(fileB64, 'base64'))) as Snapshot;
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'CORRUPT_BACKUP';
      throw badRequest(code === 'WRONG_PASSWORD' ? 'WRONG_PASSWORD' : 'CORRUPT_BACKUP', '密码不正确或备份文件已损坏');
    }
    if (!snapshot || !Array.isArray(snapshot.groups)) throw badRequest('CORRUPT_BACKUP', '备份内容无法识别');
    if (body.confirm !== true) {
      const total = snapshot.groups.reduce((sum, g) => sum + (g.links?.length ?? 0), 0);
      return {
        ok: true,
        data: {
          needsConfirm: true,
          groups: snapshot.groups.length,
          links: total,
          exportedAt: snapshot.exportedAt ?? null,
        },
      };
    }
    const result = await restoreFullSnapshot(app.db, { groups: snapshot.groups.map((g) => ({ name: g.name, items: (g.links ?? []).map((l) => ({ title: l.title, url: l.url })) })) });
    app.events.emit('groups-changed', { url: '/api/config/import', method: 'POST' });
    app.events.emit('links-changed', { url: '/api/config/import', method: 'POST' });
    return { ok: true, data: { restored: result } };
  });
}
