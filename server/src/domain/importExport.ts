import type { DataPool } from '../data/proxy.ts';
import { displayName, displayTitle, normalizeNameKey, normalizeUrl } from './normalize.ts';

export type ImportFolder = { name: string; items: Array<{ title: string; url: string }> };
export type ImportPreview = {
  folders: Array<{ name: string; total: number; duplicates_in_file: number; new_links: number; existing_elsewhere: number }>;
  grandTotal: number;
  newTotal: number;
  duplicateInFile: number;
  existsAnywhere: number;
};

/** 导入预览（IMP-01）：不入库，只统计 */
export async function previewImport(db: DataPool, folders: ImportFolder[]): Promise<ImportPreview> {
  const existing = new Set<string>(
    (await db.all<{ url_normalized: string }>('SELECT DISTINCT url_normalized FROM links')).map((r: { url_normalized: string }) => r.url_normalized),
  );
  const seenInFile = new Set<string>();
  let duplicateInFile = 0;
  let existsAnywhere = 0;
  let newTotal = 0;
  const out: ImportPreview['folders'] = [];
  for (const folder of folders) {
    let newLinks = 0;
    let dupInFile = 0;
    let elsewhere = 0;
    const localSeen = new Set<string>();
    for (const item of folder.items) {
      let normalized: string;
      try {
        normalized = normalizeUrl(item.url).normalized;
      } catch {
        continue;
      }
      if (seenInFile.has(normalized) || localSeen.has(normalized)) {
        dupInFile += 1;
        continue;
      }
      localSeen.add(normalized);
      seenInFile.add(normalized);
      if (existing.has(normalized)) {
        elsewhere += 1;
      } else {
        newLinks += 1;
      }
    }
    duplicateInFile += dupInFile;
    existsAnywhere += elsewhere;
    newTotal += newLinks;
    out.push({ name: folder.name, total: folder.items.length, duplicates_in_file: dupInFile, new_links: newLinks, existing_elsewhere: elsewhere });
  }
  return {
    folders: out,
    grandTotal: folders.reduce((sum, f) => sum + f.items.length, 0),
    newTotal,
    duplicateInFile,
    existsAnywhere,
  };
}

export type ImportResult = { groupsCreated: number; groupsMerged: number; linksCreated: number; linksSkipped: number };

/**
 * 导入提交（IMP-01）：同名分组自动合并（含服务端已有分组），同 URL 不重复入库。
 * 整体一个事务：任何一条非法 URL 不阻断导入（跳过计数）。
 */
export async function commitImport(
  db: DataPool,
  folders: ImportFolder[],
  crossGroupPolicy: 'allow' | 'skip' = 'allow',
  presetStatements?: Array<{ sql: string; params?: unknown[] }>,
): Promise<ImportResult> {
  const inTransaction = presetStatements !== undefined;
  // 事务模式（快照恢复）下 DELETE 已排在 batch 首位：库内旧链接在重建时视为已清空，
  // 不能再用旧表数据做「已存在」判定（否则全部被误判为重复而跳过）
  const linksPreCleared = inTransaction;
  // 事务模式下预分配新分组 id（现有 max(id) 递增），保证分组 INSERT 与链接外键进同一 batch
  const maxId = await db.get<{ m: number | null }>('SELECT MAX(id) AS m FROM groups');
  let nextGroupId = Number(maxId?.m ?? 0) + 1;
  const statements: Array<{ sql: string; params?: unknown[] }> = presetStatements ?? [];
  let groupsCreated = 0;
  let groupsMerged = 0;
  let linksCreated = 0;
  let linksSkipped = 0;

  // 事务模式（快照恢复）下分组表同样即将清空重建，不能用旧分组表做「同名合并」判定
  const groupRows = linksPreCleared
    ? []
    : await db.all<{ id: number; name_key: string }>('SELECT id, name_key FROM groups');
  const groupMap = new Map<string, number>(groupRows.map((g: { name_key: string; id: number }) => [g.name_key, g.id]));
  const existingUrls = new Set(
    linksPreCleared
      ? []
      : (await db.all<{ url_normalized: string }>('SELECT DISTINCT url_normalized FROM links')).map((r) => r.url_normalized),
  );
  const groupMax = await db.get<{ m: number | null }>('SELECT MAX(sort_order) AS m FROM groups');
  let groupOrder = Number(groupMax?.m ?? 0);

  for (const folder of folders) {
    const name = displayName(folder.name) || '未命名';
    const key = normalizeNameKey(name);
    let groupId = groupMap.get(key);
    if (groupId === undefined) {
      groupOrder += 10;
      if (inTransaction) {
        // 事务模式下没有中间 run 可取 lastInsertRowid：分组 INSERT 也进 batch，
        // 用确定性 id（现有 max(id)+序号），链接外键直接引用它
        groupId = nextGroupId;
        nextGroupId += 1;
        statements.push({
          sql: 'INSERT INTO groups (id, name, name_key, type, display_mode, layout_mode, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
          params: [groupId, name, key, 'tab', 'icon', 'multi', groupOrder],
        });
      } else {
        // M16 取舍：非事务模式下这里的分组逐条 run 与后面的 links batch 不在同一事务，
        // 导入中途失败会留下「分组已建、部分链接缺失」的半截数据——可接受：导入可重跑
        // （重跑时同名分组合并、同 URL 跳过，幂等收敛），不值得为此引入大事务包裹。
        const res = await db.run('INSERT INTO groups (name, name_key, type, display_mode, layout_mode, sort_order) VALUES (?, ?, ?, ?, ?, ?)', [
          name, key, 'tab', 'icon', 'multi', groupOrder,
        ]);
        groupId = Number(res.lastInsertRowid);
      }
      groupMap.set(key, groupId);
      groupsCreated += 1;
    } else {
      groupsMerged += 1;
    }

    const perGroupSeen = new Set<string>();
    for (const item of folder.items) {
      let url: string, normalized: string;
      try {
        const n = normalizeUrl(item.url);
        url = n.url;
        normalized = n.normalized;
      } catch {
        linksSkipped += 1;
        continue;
      }
      // 库内已存在（任何分组）：跨组，按策略
      if (existingUrls.has(normalized)) {
        if (crossGroupPolicy === 'skip') { linksSkipped += 1; continue; }
        if (perGroupSeen.has(normalized)) { linksSkipped += 1; continue; }
        // allow：允许跨组存在，但同组内已有则跳过 —— 需要查同组
        // （事务模式下链接表即将清空重建，无需查旧表）
        if (!linksPreCleared) {
          const inGroup = await db.get('SELECT 1 AS hit FROM links WHERE group_id = ? AND url_normalized = ?', [groupId, normalized]);
          if (inGroup) { linksSkipped += 1; continue; }
        }
      } else if (perGroupSeen.has(normalized)) {
        linksSkipped += 1;
        continue;
      }
      perGroupSeen.add(normalized);
      existingUrls.add(normalized);
      statements.push({
        sql: "INSERT INTO links (group_id, title, url, url_normalized, sort_order, sync_state) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM links WHERE group_id = ?), 'pending')",
        params: [groupId, displayTitle(item.title, url), url, normalized, groupId],
      });
      linksCreated += 1;
    }
  }
  if (statements.length > 0) await db.batch(statements);
  return { groupsCreated, groupsMerged, linksCreated, linksSkipped };
}

/**
 * 全量覆盖恢复（IMP-05）：清空 groups/links/dedupe_ignores 并重建，settings/extensions 保留。
 * DELETE 与全部 INSERT（分组 + 链接）拼进同一个 batch —— worker.ts 的 batch 实现为
 * BEGIN IMMEDIATE ... COMMIT / ROLLBACK（真事务），中途任何一条失败整体回滚，库内数据保持原样。
 */
export async function restoreFullSnapshot(db: DataPool, snapshot: { groups: ImportFolder[] }): Promise<ImportResult> {
  const preset: Array<{ sql: string; params?: unknown[] }> = [
    { sql: 'DELETE FROM links' },
    { sql: 'DELETE FROM groups' },
    { sql: 'DELETE FROM dedupe_ignores' },
  ];
  return commitImport(db, snapshot.groups, 'allow', preset);
}
