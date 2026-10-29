export type ApiError = { code: string; message: string; details?: unknown };
export type ApiOk<T> = { ok: true; data: T };
export type ApiFail = { ok: false; error: ApiError };
export type ApiResult<T> = ApiOk<T> | ApiFail;

export type Link = {
  id: number;
  group_id: number;
  title: string;
  url: string;
  url_normalized: string;
  description: string | null;
  icon: string | null;
  icon_type: string;
  sort_order: number;
  sync_state: string;
  created_at: string;
  updated_at: string;
};

export type Group = {
  id: number;
  name: string;
  name_key: string;
  icon: string | null;
  type: 'fixed' | 'tab';
  display_mode: string;
  layout_mode: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type GroupWithLinks = Group & { links: Link[] };

export type DataPayload = {
  groups: GroupWithLinks[];
  settings: Record<string, unknown>;
  meta: { groupCount: number; linkCount: number; mode: string };
};

export type AuthStatus = {
  initialized: boolean;
  authenticated: boolean;
  device: string | null;
  expiresAt: string | null;
};

export type DuplicateDetails = {
  url_normalized: string;
  target_group_id: number;
  existing: { id: number; title: string; url: string; group_id: number; group_name: string };
  options: string[];
};

export type DuplicatePolicy = 'prompt' | 'allow' | 'ignore' | 'skip';

async function request<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    return { ok: false, error: { code: 'NETWORK_ERROR', message: '网络不可用，请检查服务端是否已启动' } };
  }
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (payload && typeof payload === 'object' && 'ok' in payload) {
    return payload as ApiResult<T>;
  }
  return {
    ok: false,
    error: { code: 'HTTP_' + response.status, message: '请求失败（HTTP ' + response.status + '）' },
  };
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

export const api = {
  data: () => request<DataPayload>('/api/data'),
  authStatus: () => request<AuthStatus>('/api/auth/status'),
  setup: (password: string) => request<{ token: string }>('/api/auth/setup', { method: 'POST', ...json({ password }) }),
  login: (password: string) => request<{ token: string }>('/api/auth/login', { method: 'POST', ...json({ password }) }),
  logout: () => request<{ loggedOut: boolean }>('/api/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ changed: boolean }>('/api/auth/change-password', { method: 'POST', ...json({ currentPassword, newPassword }) }),

  createGroup: (name: string) => request<{ group: Group; merged: boolean }>('/api/groups', { method: 'POST', ...json({ name }) }),
  updateGroup: (id: number, patch: { name?: string; type?: 'fixed' | 'tab'; display_mode?: 'grid' | 'list' | 'icon'; layout_mode?: 'single' | 'multi' }) =>
    request<{ group: Group; merged: boolean }>('/api/groups/' + id, { method: 'PUT', ...json(patch) }),
  renameGroup: (id: number, name: string) =>
    request<{ group: Group; merged: boolean }>('/api/groups/' + id, { method: 'PUT', ...json({ name }) }),
  deleteGroup: (id: number) => request<{ deleted: number }>('/api/groups/' + id, { method: 'DELETE' }),
  reorderGroups: (ids: number[]) => request<{ groups: Group[] }>('/api/reorder/groups', { method: 'POST', ...json({ ids }) }),

  createLink: (payload: { group_id: number; url: string; title?: string; icon?: string | null; icon_type?: 'auto' | 'url' | 'none'; on_duplicate?: DuplicatePolicy }) =>
    request<{ link: Link; merged: boolean; skipped?: boolean }>('/api/links', { method: 'POST', ...json(payload) }),
  updateLink: (id: number, payload: { title?: string; url?: string; description?: string | null; icon?: string | null; icon_type?: 'auto' | 'url' | 'none' }) =>
    request<{ link: Link; merged: boolean }>('/api/links/' + id, { method: 'PUT', ...json(payload) }),
  deleteLink: (id: number) => request<{ deleted: number }>('/api/links/' + id, { method: 'DELETE' }),
  moveLink: (id: number, groupId: number) =>
    request<{ link: Link; merged: boolean }>('/api/links/' + id + '/move', { method: 'POST', ...json({ group_id: groupId }) }),
  reorderLinks: (groupId: number, ids: number[]) =>
    request<{ links: Link[] }>('/api/reorder/links', { method: 'POST', ...json({ group_id: groupId, ids }) }),

  updateSettings: (patch: Record<string, unknown>) =>
    request<{ settings: Record<string, unknown> }>('/api/settings', { method: 'PUT', ...json(patch) }),

  listIgnores: () =>
    request<{ ignores: Array<{ url_normalized: string; group_id: number; group_name: string | null; created_at: string }> }>(
      '/api/dedupe/ignores',
    ),
  forgetIgnore: (url_normalized: string, group_id: number) =>
    request<{ removed: number }>('/api/dedupe/ignores', { method: 'DELETE', ...json({ url_normalized, group_id }) }),

  // ---- M4: 导入导出 + 备份 ----
  importPreview: (html: string) =>
    request<ImportPreview>('/api/import/preview', { method: 'POST', ...json({ html }) }),
  importCommit: (html: string, crossGroup: 'allow' | 'skip' = 'allow') =>
    request<ImportResult>('/api/import/commit', { method: 'POST', ...json({ html, cross_group: crossGroup }) }),
  exportBookmarksUrl: '/api/export/bookmarks' as const,
  configExport: (password: string) =>
    request<{ format: string; exportedAt: string; groups: number; links: number; file: string }>('/api/config/export', { method: 'POST', ...json({ password }) }),
  configImportCheck: (password: string, file: string) =>
    request<{ needsConfirm: boolean; groups: number; links: number; exportedAt: string | null }>('/api/config/import', { method: 'POST', ...json({ password, file }) }),
  configImportFromSnapshot: (password: string, snapshot: { groups: Array<{ name: string; links: Array<{ title: string; url: string }> }> }) =>
    request<{ restored: { groupsCreated: number; groupsMerged: number; linksCreated: number; linksSkipped: number } }>('/api/config/restore-snapshot', { method: 'POST', ...json({ password, snapshot, confirm: true }) }),
  configImport: (password: string, file: string) =>
    request<{ restored: { groupsCreated: number; groupsMerged: number; linksCreated: number; linksSkipped: number } }>('/api/config/import', { method: 'POST', ...json({ password, file, confirm: true }) }),

  backupStatus: () =>
    request<BackupStatusInfo>('/api/backup/status'),
  backupConfig: (payload: { url: string; username: string; password: string; keepCount: number; adminPassword: string }) =>
    request<{ saved: boolean; ok: boolean; writable: boolean; error: string | null }>('/api/backup/config', { method: 'POST', ...json(payload) }),
  backupTest: () =>
    request<{ ok: boolean; writable: boolean; error: string | null }>('/api/backup/test'),
  backupRun: (kind: 'auto' | 'manual' = 'manual') =>
    request<{ file: string; size: number; rotated: number }>('/api/backup/run', { method: 'POST', ...json({ kind }) }),
  backupList: () =>
    request<{ backups: Array<{ name: string; size: number; lastModified: string | null }> }>('/api/backup/list'),
  backupDownload: (name: string, password: string) =>
    request<{ snapshot: { groups: Array<{ name: string; links: Array<{ title: string; url: string }> }>; exportedAt: string | null } }>('/api/backup/download', { method: 'POST', ...json({ name, password }) }),

  // ---- M5: 扩展清单 ----
  extensionList: () =>
    request<ExtensionInventory>('/api/extensions'),
  extensionDelete: (id: number) =>
    request<{ removed: number }>('/api/extensions/' + id, { method: 'DELETE' }),

  // ---- M6: 治理工具 ----
  duplicates: () =>
    request<{ duplicates: Array<{ url_normalized: string; occurrences: Array<{ id: number; group_id: number; title: string; url: string; group_name: string }> }>; total: number }>('/api/tools/duplicates'),
  deleteDuplicates: (ids: number[]) =>
    request<{ deleted: number }>('/api/tools/duplicates/delete', { method: 'POST', ...json({ keepIds: ids }) }),
  checkLinks: (limit = 200) =>
    request<{ checked: number; deadCount: number; dead: Array<{ id: number; title: string; url: string; group_name: string; ok: boolean; status: number | null }> }>('/api/tools/check-links', { method: 'POST', ...json({ limit }) }),
  savedCheck: () =>
    request<{ result: { checkedAt: string; dead: Array<{ id: number; title: string; url: string; group_name: string; status: number | null }> } | null }>('/api/tools/check-links'),
  deleteDead: (ids: number[]) =>
    request<{ deleted: number }>('/api/tools/dead-links/delete', { method: 'POST', ...json({ ids }) }),
  iconRefresh: (domain: string) =>
    request<{ purged: boolean; refetched: boolean; status?: string; reason?: string }>('/api/tools/icon-refresh', { method: 'POST', ...json({ domain }) }),

  // ---- OPS-02: 插件自托管下载 ----
  syncStatus: () =>
    request<{ pending: number; synced: number; failed: number; lastHeartbeat: string | null; lastDevice: string; sseClients: number }>('/api/sync/status'),
  addonList: () =>
    request<{ available: boolean; files: string[]; hint?: string }>('/extension/download/list'),
};
export const ADDON_DOWNLOAD_BASE = '/extension/download/';

export type ExtensionEntry = { id: number; ext_id: string; name: string; version: string; url: string | null };
export type ExtensionInventory = { byBrowser: Record<string, ExtensionEntry[]>; total: number };

export type ImportPreview = {
  folders: Array<{ name: string; total: number; duplicates_in_file: number; new_links: number; existing_elsewhere: number }>;
  grandTotal: number;
  newTotal: number;
  duplicateInFile: number;
  existsAnywhere: number;
  parseInvalid: number;
};
export type ImportResult = { groupsCreated: number; groupsMerged: number; linksCreated: number; linksSkipped: number };
export type BackupStatusInfo = { configured: boolean; keepCount: number; lastRunAt: string | null; address: string };
