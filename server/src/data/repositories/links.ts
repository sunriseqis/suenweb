import type { DataPool } from '../proxy.ts';
import { badRequest, notFound } from '../../domain/errors.ts';
import { displayTitle, normalizeUrl } from '../../domain/normalize.ts';

export type SyncState = 'pending' | 'synced' | 'failed';

export type LinkRow = {
  id: number;
  group_id: number;
  title: string;
  url: string;
  url_normalized: string;
  description: string | null;
  icon: string | null;
  icon_type: string;
  sort_order: number;
  sync_state: SyncState;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
};

export type LinkInput = {
  group_id?: unknown;
  title?: unknown;
  url?: unknown;
  description?: unknown;
  icon?: unknown;
  icon_type?: unknown;
};

const ICON_TYPES = new Set(['auto', 'emoji', 'url', 'none']);
const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export class LinksRepo {
  private readonly db: DataPool;

  constructor(db: DataPool) {
    this.db = db;
  }

  async listAll(): Promise<LinkRow[]> {
    return this.db.all<LinkRow>('SELECT * FROM links ORDER BY group_id, sort_order, id');
  }

  async listByGroup(groupId: number): Promise<LinkRow[]> {
    return this.db.all<LinkRow>('SELECT * FROM links WHERE group_id = ? ORDER BY sort_order, id', [groupId]);
  }

  async getById(id: number): Promise<LinkRow | null> {
    return this.db.get<LinkRow>('SELECT * FROM links WHERE id = ?', [id]);
  }

  async requireById(id: number): Promise<LinkRow> {
    const row = await this.getById(id);
    if (!row) throw notFound('链接不存在');
    return row;
  }

  async findByUrl(groupId: number, normalized: string): Promise<LinkRow | null> {
    return this.db.get<LinkRow>('SELECT * FROM links WHERE group_id = ? AND url_normalized = ?', [groupId, normalized]);
  }

  async create(input: LinkInput): Promise<{ link: LinkRow; merged: boolean }> {
    const groupId = toId(input.group_id);
    if (groupId === null) throw badRequest('INVALID_GROUP', '分组不存在');
    const group = await this.db.get('SELECT id FROM groups WHERE id = ?', [groupId]);
    if (!group) throw badRequest('INVALID_GROUP', '分组不存在');

    const { url, normalized } = normalizeUrl(input.url);
    const existing = await this.findByUrl(groupId, normalized);
    if (existing) return { link: existing, merged: true };

    const res = await this.db.run(
      "INSERT INTO links (group_id, title, url, url_normalized, description, icon, icon_type, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM links WHERE group_id = ?))",
      [
        groupId,
        displayTitle(input.title, url),
        url,
        normalized,
        toOptionalText(input.description),
        toOptionalText(input.icon),
        toIconType(input.icon_type),
        groupId,
      ],
    );
    return { link: await this.requireById(res.lastInsertRowid), merged: false };
  }

  async update(id: number, patch: LinkInput): Promise<{ link: LinkRow; merged: boolean }> {
    const current = await this.requireById(id);
    const sets: string[] = [];
    const params: unknown[] = [];

    if (patch.url !== undefined) {
      const { url, normalized } = normalizeUrl(patch.url);
      const clash = await this.findByUrl(current.group_id, normalized);
      if (clash && clash.id !== id) {
        await this.db.run('DELETE FROM links WHERE id = ?', [id]);
        return { link: clash, merged: true };
      }
      sets.push('url = ?', 'url_normalized = ?');
      params.push(url, normalized);
    }
    if (patch.title !== undefined) {
      sets.push('title = ?');
      params.push(displayTitle(patch.title, current.url));
    }
    if (patch.description !== undefined) {
      sets.push('description = ?');
      params.push(toOptionalText(patch.description));
    }
    if (patch.icon !== undefined) {
      sets.push('icon = ?');
      params.push(toOptionalText(patch.icon));
    }
    if (patch.icon_type !== undefined) {
      if (typeof patch.icon_type !== 'string' || !ICON_TYPES.has(patch.icon_type)) throw badRequest('INVALID_ICON_TYPE', '图标类型不合法');
      sets.push('icon_type = ?');
      params.push(patch.icon_type);
    }
    if (sets.length === 0) return { link: current, merged: false };
    sets.push('updated_at = ' + NOW_SQL);
    params.push(id);
    await this.db.run('UPDATE links SET ' + sets.join(', ') + ' WHERE id = ?', params);
    return { link: await this.requireById(id), merged: false };
  }

  async remove(id: number): Promise<void> {
    await this.requireById(id);
    await this.db.run('DELETE FROM links WHERE id = ?', [id]);
  }

  /** 跨组移动；目标组已有同一 URL 时按去重口径合并（删源、返回目标） */
  async move(id: number, groupIdRaw: unknown): Promise<{ link: LinkRow; merged: boolean }> {
    const current = await this.requireById(id);
    const groupId = toId(groupIdRaw);
    if (groupId === null) throw badRequest('INVALID_GROUP', '分组不存在');
    const group = await this.db.get('SELECT id FROM groups WHERE id = ?', [groupId]);
    if (!group) throw badRequest('INVALID_GROUP', '分组不存在');
    if (groupId === current.group_id) return { link: current, merged: false };

    const clash = await this.findByUrl(groupId, current.url_normalized);
    if (clash) {
      await this.db.run('DELETE FROM links WHERE id = ?', [id]);
      return { link: clash, merged: true };
    }
    await this.db.run(
      'UPDATE links SET group_id = ?, sort_order = (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM links WHERE group_id = ?), updated_at = ' + NOW_SQL + ' WHERE id = ?',
      [groupId, groupId, id],
    );
    return { link: await this.requireById(id), merged: false };
  }

  async reorder(groupId: number, ids: number[]): Promise<LinkRow[]> {
    const statements = ids.map((id, index) => ({
      sql: 'UPDATE links SET sort_order = ?, updated_at = ' + NOW_SQL + ' WHERE id = ? AND group_id = ?',
      params: [index * 10, id, groupId],
    }));
    if (statements.length > 0) await this.db.batch(statements);
    return this.listByGroup(groupId);
  }
}

function toId(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function toOptionalText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed.slice(0, 2000) : null;
}

function toIconType(raw: unknown): string {
  return typeof raw === 'string' && ICON_TYPES.has(raw) ? raw : 'auto';
}
