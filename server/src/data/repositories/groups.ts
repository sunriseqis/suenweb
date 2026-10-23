import type { DataPool } from '../proxy.ts';
import { badRequest, notFound } from '../../domain/errors.ts';
import { displayName, normalizeNameKey } from '../../domain/normalize.ts';

export type GroupType = 'fixed' | 'tab';

export type GroupRow = {
  id: number;
  name: string;
  name_key: string;
  icon: string | null;
  type: GroupType;
  display_mode: string;
  layout_mode: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type GroupInput = {
  name?: unknown;
  icon?: unknown;
  type?: unknown;
  display_mode?: unknown;
  layout_mode?: unknown;
};

const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const GROUP_TYPES = new Set(['fixed', 'tab']);
const DISPLAY_MODES = new Set(['grid', 'list', 'icon']);
const LAYOUT_MODES = new Set(['auto', 'compact', 'comfortable']);

export class GroupsRepo {
  private readonly db: DataPool;

  constructor(db: DataPool) {
    this.db = db;
  }

  async list(): Promise<GroupRow[]> {
    return this.db.all<GroupRow>('SELECT * FROM groups ORDER BY sort_order, id');
  }

  async getById(id: number): Promise<GroupRow | null> {
    return this.db.get<GroupRow>('SELECT * FROM groups WHERE id = ?', [id]);
  }

  async requireById(id: number): Promise<GroupRow> {
    const row = await this.getById(id);
    if (!row) throw notFound('分组不存在');
    return row;
  }

  async findByKey(key: string): Promise<GroupRow | null> {
    return this.db.get<GroupRow>('SELECT * FROM groups WHERE name_key = ?', [key]);
  }

  async create(input: GroupInput): Promise<{ group: GroupRow; merged: boolean }> {
    const name = displayName(input.name);
    if (!name) throw badRequest('INVALID_GROUP_NAME', '分组名不能为空');
    if (name.length > 40) throw badRequest('INVALID_GROUP_NAME', '分组名最长 40 个字符');
    const key = normalizeNameKey(name);
    const existing = await this.findByKey(key);
    if (existing) return { group: existing, merged: true };
    try {
      const res = await this.db.run(
        "INSERT INTO groups (name, name_key, icon, sort_order) VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM groups))",
        [name, key, normalizeIcon(input.icon)],
      );
      const group = await this.requireById(res.lastInsertRowid);
      return { group, merged: false };
    } catch (err) {
      const again = await this.findByKey(key);
      if (again) return { group: again, merged: true };
      throw err;
    }
  }

  async update(id: number, patch: GroupInput): Promise<{ group: GroupRow; merged: boolean; mergedFrom?: number }> {
    const current = await this.requireById(id);
    const sets: string[] = [];
    const params: unknown[] = [];

    if (patch.name !== undefined) {
      const name = displayName(patch.name);
      if (!name) throw badRequest('INVALID_GROUP_NAME', '分组名不能为空');
      if (name.length > 40) throw badRequest('INVALID_GROUP_NAME', '分组名最长 40 个字符');
      const key = normalizeNameKey(name);
      if (key !== current.name_key) {
        const clash = await this.findByKey(key);
        if (clash && clash.id !== id) {
          await this.mergeInto(id, clash.id);
          return { group: clash, merged: true, mergedFrom: id };
        }
      }
      sets.push('name = ?', 'name_key = ?');
      params.push(name, key);
    }
    if (patch.icon !== undefined) {
      sets.push('icon = ?');
      params.push(normalizeIcon(patch.icon));
    }
    if (patch.type !== undefined) {
      if (typeof patch.type !== 'string' || !GROUP_TYPES.has(patch.type)) throw badRequest('INVALID_GROUP_TYPE', '分组类型只支持 fixed / tab');
      sets.push('type = ?');
      params.push(patch.type);
    }
    if (patch.display_mode !== undefined) {
      if (typeof patch.display_mode !== 'string' || !DISPLAY_MODES.has(patch.display_mode)) throw badRequest('INVALID_DISPLAY_MODE', '展示模式不合法');
      sets.push('display_mode = ?');
      params.push(patch.display_mode);
    }
    if (patch.layout_mode !== undefined) {
      if (typeof patch.layout_mode !== 'string' || !LAYOUT_MODES.has(patch.layout_mode)) throw badRequest('INVALID_LAYOUT_MODE', '布局模式不合法');
      sets.push('layout_mode = ?');
      params.push(patch.layout_mode);
    }
    if (sets.length === 0) return { group: current, merged: false };
    sets.push('updated_at = ' + NOW_SQL);
    params.push(id);
    await this.db.run('UPDATE groups SET ' + sets.join(', ') + ' WHERE id = ?', params);
    return { group: await this.requireById(id), merged: false };
  }

  /** 重名合并：把 source 的链接并入 target（同组同 URL 视为重复直接丢弃），再删 source */
  async mergeInto(sourceId: number, targetId: number): Promise<void> {
    if (sourceId === targetId) return;
    await this.db.batch([
      { sql: 'UPDATE OR IGNORE links SET group_id = ? WHERE group_id = ?', params: [targetId, sourceId] },
      { sql: 'DELETE FROM links WHERE group_id = ?', params: [sourceId] },
      { sql: 'DELETE FROM groups WHERE id = ?', params: [sourceId] },
    ]);
  }

  async remove(id: number): Promise<void> {
    await this.requireById(id);
    await this.db.run('DELETE FROM groups WHERE id = ?', [id]);
  }

  async reorder(ids: number[]): Promise<GroupRow[]> {
    const statements = ids.map((id, index) => ({
      sql: 'UPDATE groups SET sort_order = ? WHERE id = ?',
      params: [index * 10, id],
    }));
    if (statements.length > 0) await this.db.batch(statements);
    return this.list();
  }
}

function normalizeIcon(icon: unknown): string | null {
  if (typeof icon !== 'string') return null;
  const trimmed = icon.trim();
  return trimmed ? trimmed.slice(0, 500) : null;
}
