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
  updateGroup: (id: number, patch: { name?: string; type?: 'fixed' | 'tab'; display_mode?: 'grid' | 'list' | 'icon' }) =>
    request<{ group: Group; merged: boolean }>('/api/groups/' + id, { method: 'PUT', ...json(patch) }),
  renameGroup: (id: number, name: string) =>
    request<{ group: Group; merged: boolean }>('/api/groups/' + id, { method: 'PUT', ...json({ name }) }),
  deleteGroup: (id: number) => request<{ deleted: number }>('/api/groups/' + id, { method: 'DELETE' }),
  reorderGroups: (ids: number[]) => request<{ groups: Group[] }>('/api/reorder/groups', { method: 'POST', ...json({ ids }) }),

  createLink: (payload: { group_id: number; url: string; title?: string; on_duplicate?: DuplicatePolicy }) =>
    request<{ link: Link; merged: boolean; skipped?: boolean }>('/api/links', { method: 'POST', ...json(payload) }),
  updateLink: (id: number, payload: { title?: string; url?: string; description?: string | null; icon?: string | null }) =>
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
};
