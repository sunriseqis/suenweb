import { AppError, badRequest } from '../domain/errors.ts';
import type { DataPool } from '../data/proxy.ts';
import type { SettingsRepo } from '../data/repositories/settings.ts';
import { encryptBackup, decryptBackup } from './backupCrypto.ts';
import { verifyPassword } from './crypto.ts';
import { ADMIN_HASH_KEY } from '../domain/authService.ts';
import {
  backupFileName,
  deleteBackup,
  downloadBackup,
  listBackups,
  normalizeWebDavUrl,
  testWebDav,
  uploadBackup,
  type WebDavConfig,
} from './webdav.ts';

const WEBDAV_KEY_PREFIX = 'webdav.';
const WRAP_PREFIX = 'backup.wrapped.';
const KEEP_KEY = 'backup.keep_count';
const LAST_RUN_KEY = 'backup.last_run_at';

export type BackupStatus = {
  configured: boolean;
  keepCount: number;
  lastRunAt: string | null;
  address: string;
};

function fail(code: string, message: string): AppError {
  return new AppError(code, message, 400);
}

/** WebDAV 配置读写（内部键，密码明文只存库内 settings，绝不进任何响应） */
export class BackupService {
  private readonly db: DataPool;
  private readonly settings: SettingsRepo;

  constructor(db: DataPool, settings: SettingsRepo) {
    this.db = db;
    this.settings = settings;
  }

  async readConfig(): Promise<WebDavConfig | null> {
    const url = await this.settings.getValue<string>(WEBDAV_KEY_PREFIX + 'url', '');
    const username = await this.settings.getValue<string>(WEBDAV_KEY_PREFIX + 'username', '');
    const password = await this.settings.getValue<string>(WEBDAV_KEY_PREFIX + 'password', '');
    if (!normalizeWebDavUrl(url)) return null;
    const keep = await this.settings.getValue<number>(KEEP_KEY, 30);
    return { url: normalizeWebDavUrl(url), username, password, keepCount: Number(keep) || 30 };
  }

  async status(): Promise<BackupStatus> {
    const cfg = await this.readConfig();
    return {
      configured: Boolean(cfg),
      keepCount: cfg?.keepCount ?? 30,
      lastRunAt: await this.settings.getValue<string | null>(LAST_RUN_KEY, null),
      address: cfg ? cfg.url : '',
    };
  }

  async saveConfig(input: { url: string; username: string; password: string; keepCount?: number }): Promise<void> {
    if (input.keepCount !== undefined) {
      const n = Number(input.keepCount);
      if (!Number.isInteger(n) || n < 1 || n > 365) throw badRequest('INVALID_KEEP_COUNT', '保留份数需在 1-365 之间');
    }
    await this.settings.set(WEBDAV_KEY_PREFIX + 'url', normalizeWebDavUrl(input.url));
    await this.settings.set(WEBDAV_KEY_PREFIX + 'username', input.username);
    await this.settings.set(WEBDAV_KEY_PREFIX + 'password', input.password);
    if (input.keepCount !== undefined) await this.settings.set(KEEP_KEY, Number(input.keepCount));
  }

  async test(): Promise<{ ok: boolean; writable: boolean; error: string | null }> {
    const cfg = await this.readConfig();
    if (!cfg) return { ok: false, writable: false, error: '尚未配置 WebDAV' };
    return testWebDav(cfg);
  }

  private async snapshot(): Promise<object> {
    const groups = await this.db.all<{ id: number; name: string }>('SELECT id, name FROM groups ORDER BY sort_order, id');
    const links = await this.db.all<{ group_id: number; title: string; url: string; description: string | null; created_at: string }>(
      'SELECT group_id, title, url, description, created_at FROM links ORDER BY group_id, sort_order, id',
    );
    const extensions = await this.db.all<{ ext_id: string; name: string; version: string; url: string | null; browser: string }>(
      'SELECT ext_id, name, version, url, browser FROM extensions ORDER BY browser, name',
    );
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      groups: groups.map((g) => ({
        name: g.name,
        links: links
          .filter((l) => l.group_id === g.id)
          .map((l) => ({ title: l.title, url: l.url, description: l.description, created_at: l.created_at })),
      })),
      extensions,
    };
  }

  /**
   * BAK-07：配置时校验管理密码；备份密钥由服务端随机生成并直接存 settings（本地单机部署，密钥与数据同盘已够用）。
   * M8：仅在密钥不存在时生成新密钥——已有密钥时必须保留，否则重新配置 WebDAV
   * 会让密钥轮换，历史备份全部无法解密。管理密码每次都校验。
   */
  async ensureWrappedKey(adminPassword: string): Promise<void> {
    const hash = await this.settings.getValue<string>(ADMIN_HASH_KEY, '');
    if (!(await verifyPassword(adminPassword, hash))) throw badRequest('WRONG_PASSWORD', '密码不正确');
    const existing = await this.settings.getValue<string | null>(WRAP_PREFIX + 'key', null);
    if (existing) return;
    const { webcrypto } = await import('node:crypto');
    const raw = new Uint8Array(32);
    webcrypto.getRandomValues(raw);
    await this.settings.set(WRAP_PREFIX + 'key', Buffer.from(raw).toString('base64'));
  }

  private async backupKey(): Promise<Buffer | null> {
    const stored = await this.settings.getValue<string | null>(WRAP_PREFIX + 'key', null);
    return stored ? Buffer.from(stored, 'base64') : null;
  }

  async runBackup(kind: 'auto' | 'manual'): Promise<{ file: string; size: number; rotated: number }> {
    const cfg = await this.readConfig();
    if (!cfg) throw fail('WEBDAV_NOT_CONFIGURED', '尚未配置 WebDAV');
    const key = await this.backupKey();
    if (!key) throw fail('KEY_NOT_SET', '备份密钥未初始化，请在设置里重新保存一次管理密码');

    const payload = JSON.stringify(await this.snapshot());
    const body = await encryptBackup(key.toString('base64'), payload);
    const name = backupFileName(kind === 'auto' ? 'suenweb-backup-auto' : 'suenweb-backup-manual');
    await uploadBackup(cfg, name, body);

    const rotated = await this.rotate(cfg);
    await this.settings.set(LAST_RUN_KEY, new Date().toISOString());
    await this.db.run("INSERT INTO backups (kind, location, size, status) VALUES (?, ?, ?, 'ok')", [kind, name, body.length]);
    return { file: name, size: body.length, rotated };
  }

  private async rotate(cfg: WebDavConfig): Promise<number> {
    const autos = (await listBackups(cfg)).filter((e) => e.name.startsWith('suenweb-backup-auto-'));
    let removed = 0;
    while (autos.length > cfg.keepCount) {
      const oldest = autos.shift();
      if (!oldest) break;
      await deleteBackup(cfg, oldest.name);
      removed += 1;
    }
    return removed;
  }

  async list(): Promise<Array<{ name: string; size: number; lastModified: string | null }>> {
    const cfg = await this.readConfig();
    if (!cfg) return [];
    return listBackups(cfg);
  }

  /** 下载并解密（BAK-04：需要管理密码） */
  async fetchDecrypted(name: string, adminPassword: string): Promise<string> {
    const cfg = await this.readConfig();
    if (!cfg) throw fail('WEBDAV_NOT_CONFIGURED', '尚未配置 WebDAV');
    const hash = await this.settings.getValue<string>(ADMIN_HASH_KEY, '');
    if (!(await verifyPassword(adminPassword, hash))) throw badRequest('WRONG_PASSWORD', '密码不正确');
    const body = await downloadBackup(cfg, name);
    // 服务端备份用随机备份密钥加密（BAK-07 包裹方案）；管理密码在这里只作为访问门槛。
    // 但用户在网页端还原时也要输入管理密码（BAK-04 的要求）——即本方法调用前已验证。
    const key = await this.backupKey();
    if (!key) throw fail('KEY_NOT_SET', '备份密钥未初始化');
    try {
      return await decryptBackup(key.toString('base64'), body);
    } catch {
      throw badRequest('CORRUPT_BACKUP', '备份文件已损坏或密钥已更换');
    }
  }
}
