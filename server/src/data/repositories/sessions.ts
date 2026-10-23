import type { DataPool } from '../proxy.ts';

export type SessionRow = {
  token_hash: string;
  device: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
};

const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export class SessionsRepo {
  private readonly db: DataPool;

  constructor(db: DataPool) {
    this.db = db;
  }

  async create(tokenHash: string, device: string | null, ttlDays: number): Promise<SessionRow> {
    const expiresAt = new Date(Date.now() + ttlDays * 86400000).toISOString();
    await this.db.run(
      'INSERT INTO sessions (token_hash, device, expires_at) VALUES (?, ?, ?)',
      [tokenHash, device, expiresAt],
    );
    const row = await this.db.get<SessionRow>('SELECT * FROM sessions WHERE token_hash = ?', [tokenHash]);
    if (!row) throw new Error('会话写入失败');
    return row;
  }

  async findValid(tokenHash: string): Promise<SessionRow | null> {
    const row = await this.db.get<SessionRow>(
      'SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?',
      [tokenHash, new Date().toISOString()],
    );
    return row ?? null;
  }

  async touch(tokenHash: string): Promise<void> {
    await this.db.run('UPDATE sessions SET last_seen_at = ' + NOW_SQL + ' WHERE token_hash = ?', [tokenHash]);
  }

  async remove(tokenHash: string): Promise<void> {
    await this.db.run('DELETE FROM sessions WHERE token_hash = ?', [tokenHash]);
  }

  async removeOthers(keepHash: string): Promise<void> {
    await this.db.run('DELETE FROM sessions WHERE token_hash <> ?', [keepHash]);
  }

  async purgeExpired(): Promise<number> {
    const res = await this.db.run('DELETE FROM sessions WHERE expires_at <= ?', [new Date().toISOString()]);
    return res.changes;
  }

  async list(): Promise<Array<Pick<SessionRow, 'token_hash' | 'device' | 'created_at' | 'last_seen_at' | 'expires_at'>>> {
    return this.db.all('SELECT token_hash, device, created_at, last_seen_at, expires_at FROM sessions ORDER BY created_at DESC');
  }
}
