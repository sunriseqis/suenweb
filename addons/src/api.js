// 与 SuenWeb 服务端通信的最小封装：所有请求都带 Bearer token
const DEFAULTS = { baseUrl: '', token: '', device: 'firefox', groupId: null };

export async function getConfig() {
  const stored = await browser.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...stored, baseUrl: String(stored.baseUrl || '').replace(/\/+$/, '') };
}

export async function setConfig(patch) {
  await browser.storage.local.set(patch);
}

async function call(path, options = {}) {
  const config = await getConfig();
  if (!config.baseUrl) throw new Error('还没配置服务端地址');
  const response = await fetch(config.baseUrl + path, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(config.token ? { authorization: 'Bearer ' + config.token } : {}),
      ...(options.headers || {}),
    },
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!payload || payload.ok !== true) {
    const message = payload && payload.error ? payload.error.message : '请求失败（HTTP ' + response.status + '）';
    const error = new Error(message);
    error.code = payload && payload.error ? payload.error.code : 'HTTP_' + response.status;
    error.details = payload && payload.error ? payload.error.details : undefined;
    throw error;
  }
  return payload.data;
}

export async function login(password) {
  const config = await getConfig();
  if (!config.baseUrl) throw new Error('先在设置里填写服务端地址');
  const response = await fetch(config.baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password, device: config.device }),
  });
  const payload = await response.json().catch(() => null);
  if (!payload || payload.ok !== true) {
    throw new Error(payload && payload.error ? payload.error.message : '登录失败');
  }
  await setConfig({ token: payload.data.token });
  return payload.data;
}

export const api = {
  data: () => call('/api/data'),
  createLink: (payload) => call('/api/links', { method: 'POST', body: JSON.stringify(payload) }),
  pending: () => call('/api/sync/pending'),
  ack: (ids, ok = true) => call('/api/sync/ack', { method: 'POST', body: JSON.stringify({ ids, ok }) }),
  heartbeat: () => call('/api/sync/heartbeat', { method: 'POST', body: JSON.stringify({ device: 'firefox-extension' }) }),
  status: () => call('/api/sync/status'),
};
