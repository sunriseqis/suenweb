// 与 SuenWeb 服务端通信的最小封装：所有请求都带 Bearer token
const DEFAULTS = { baseUrl: '', token: '', device: 'firefox', groupId: null };

/** 归一化服务端地址：无协议自动补 http://（否则 fetch 会当相对路径，必然 NetworkError） */
export function normalizeBaseUrl(raw) {
  let url = String(raw || '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export async function getConfig() {
  const stored = await browser.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...stored, baseUrl: normalizeBaseUrl(stored.baseUrl) };
}

/**
 * Firefox MV3 的 host 权限是「用户授予」制：未授予时跨域 fetch 直接抛 NetworkError
 * （请求根本发不出去，服务端日志里什么都没有）。这里在用户手势里主动申请。
 */
export async function ensureHostPermission(baseUrl) {
  const origin = normalizeBaseUrl(baseUrl);
  if (!origin) throw new Error('服务端地址不合法，请填成 http://IP:端口');
  if (!browser.permissions || !browser.permissions.request) return true; // Android MV2：无 request API，host 权限安装即授予
  // 桌面 Firefox：必须在用户手势的同步栈里发起（先 await 别的会丢失手势上下文）
  try {
    return await browser.permissions.request({ origins: [origin + '/*'] });
  } catch {
    // request 抛错（含 Android 不支持）：MV2 包 host 权限已在安装时授予，视为通过
    return true;
  }
}

export async function setConfig(patch) {
  await browser.storage.local.set(patch);
}
