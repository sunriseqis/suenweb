import type { DataPool } from '../data/proxy.ts';
import type { SettingsRepo } from '../data/repositories/settings.ts';
import type { SessionRow, SessionsRepo } from '../data/repositories/sessions.ts';
import { badRequest, conflict, unauthorized } from './errors.ts';
import { hashPassword, randomToken, sha256Hex, verifyPassword } from '../infra/crypto.ts';

export const ADMIN_HASH_KEY = 'auth.password_hash';
export const ADMIN_INIT_KEY = 'auth.initialized_at';

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

export type IssuedSession = { token: string; expiresAt: string; row: SessionRow };

/** 管理密码 = 备份口令：一套口令，两处用途，不设独立 token */
export class AuthService {
  private readonly settings: SettingsRepo;
  private readonly sessions: SessionsRepo;
  private readonly ttlDays: number;
  private readonly onPasswordChanged: (() => Promise<void>) | null;

  constructor(opts: {
    db: DataPool;
    settings: SettingsRepo;
    sessions: SessionsRepo;
    ttlDays: number;
    onPasswordChanged?: () => Promise<void>;
  }) {
    this.settings = opts.settings;
    this.sessions = opts.sessions;
    this.ttlDays = opts.ttlDays;
    this.onPasswordChanged = opts.onPasswordChanged ?? null;
  }

  async isInitialized(): Promise<boolean> {
    const hash = await this.settings.getValue<string>(ADMIN_HASH_KEY, '');
    return typeof hash === 'string' && hash.length > 0;
  }

  async setup(password: unknown, device: string | null): Promise<IssuedSession> {
    if (await this.isInitialized()) throw conflict('ALREADY_INITIALIZED', '已完成初始化，请直接登录');
    const normalized = assertPassword(password);
    const hash = await hashPassword(normalized);
    await this.settings.set(ADMIN_HASH_KEY, hash);
    await this.settings.set(ADMIN_INIT_KEY, new Date().toISOString());
    return this.issue(device);
  }

  async login(password: unknown, device: string | null): Promise<IssuedSession> {
    const stored = await this.settings.getValue<string>(ADMIN_HASH_KEY, '');
    if (!stored) throw conflict('NOT_INITIALIZED', '尚未初始化，请先设置管理密码');
    const ok = await verifyPassword(typeof password === 'string' ? password : '', stored);
    if (!ok) throw unauthorized('管理密码错误');
    await this.sessions.purgeExpired();
    return this.issue(device);
  }

  async issue(device: string | null): Promise<IssuedSession> {
    const token = randomToken(32);
    const row = await this.sessions.create(sha256Hex(token), device, this.ttlDays);
    return { token, expiresAt: row.expires_at, row };
  }

  async authenticate(token: string | null): Promise<SessionRow | null> {
    if (!token) return null;
    const row = await this.sessions.findValid(sha256Hex(token));
    if (!row) return null;
    void this.sessions.touch(row.token_hash).catch(() => {});
    return row;
  }

  async logout(token: string | null): Promise<void> {
    if (!token) return;
    await this.sessions.remove(sha256Hex(token));
  }

  async changePassword(currentPassword: unknown, newPassword: unknown, keepToken: string | null): Promise<void> {
    const stored = await this.settings.getValue<string>(ADMIN_HASH_KEY, '');
    if (!stored) throw conflict('NOT_INITIALIZED', '尚未初始化，请先设置管理密码');
    const ok = await verifyPassword(typeof currentPassword === 'string' ? currentPassword : '', stored);
    if (!ok) throw unauthorized('当前密码错误');
    const next = assertPassword(newPassword);
    await this.settings.set(ADMIN_HASH_KEY, await hashPassword(next));
    if (keepToken) await this.sessions.removeOthers(sha256Hex(keepToken));
    if (this.onPasswordChanged) await this.onPasswordChanged();
  }
}

function assertPassword(password: unknown): string {
  if (typeof password !== 'string') throw badRequest('INVALID_PASSWORD', '密码不能为空');
  const value = password.normalize('NFKC');
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw badRequest('WEAK_PASSWORD', '密码至少 ' + MIN_PASSWORD_LENGTH + ' 位');
  }
  if (value.length > MAX_PASSWORD_LENGTH) {
    throw badRequest('INVALID_PASSWORD', '密码最长 ' + MAX_PASSWORD_LENGTH + ' 位');
  }
  return value;
}
