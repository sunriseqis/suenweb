import { createHash } from 'node:crypto';

/**
 * 最小 WebDAV 客户端（BAK-05）：Basic 认证，PROPFIND 列表 / PUT 上传 / GET 下载 / DELETE 删除。
 * 地址统一收尾斜杠；目标目录默认 <base>/SuenWeb（已指向 SuenWeb 目录则直接用）。
 */
export type WebDavConfig = { url: string; username: string; password: string; keepCount: number };

export function normalizeWebDavUrl(raw: string): string {
  return String(raw ?? '').trim().replace(/\/+$/, '');
}

export function targetDir(cfg: WebDavConfig): string {
  const base = normalizeWebDavUrl(cfg.url);
  return base.toLowerCase().endsWith('/suenweb') ? base : base + '/SuenWeb';
}

function authHeader(cfg: WebDavConfig): string {
  return 'Basic ' + Buffer.from(cfg.username + ':' + cfg.password).toString('base64');
}

const WEBDAV_TIMEOUT_MS = 10_000;

function webdavFetch(url: string, init: RequestInit = {}): Promise<Response> {
  // 30x 一律不跟随（redirect: 'manual'），按 describeStatus 报错；10 秒超时防挂死
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBDAV_TIMEOUT_MS);
  return fetch(url, { ...init, redirect: 'manual', signal: controller.signal }).finally(() => clearTimeout(timer));
}

function describeStatus(resp: Response): string {
  if (resp.status >= 300 && resp.status < 400 || resp.redirected) return '请求被重定向（请检查地址是否精确到目录，HTTP ' + resp.status + '）';
  if (resp.status === 401 || resp.status === 403) return '认证失败（HTTP ' + resp.status + '）';
  if (resp.status === 404) return '目录或路径不存在（HTTP 404）';
  if (resp.status === 409) return '父目录不存在（HTTP 409）';
  if (resp.status === 507) return '存储空间不足（HTTP 507）';
  return 'HTTP ' + resp.status;
}

async function ensureDir(cfg: WebDavConfig): Promise<void> {
  const dir = targetDir(cfg);
  if (dir === normalizeWebDavUrl(cfg.url)) return;
  try {
    await webdavFetch(dir, { method: 'MKCOL', headers: { authorization: authHeader(cfg) } });
  } catch {
    // 有些服务器根目录直接可写，MKCOL 已存在报错可忽略
  }
}

export type WebDavTestResult = { ok: boolean; writable: boolean; error: string | null };

/** BAK-05 连接测试：区分「认证失败」「目录不存在」「连通但不可写」 */
export async function testWebDav(cfg: WebDavConfig): Promise<WebDavTestResult> {
  const base = normalizeWebDavUrl(cfg.url);
  if (!/^https?:\/\//i.test(base)) return { ok: false, writable: false, error: '地址必须以 http(s) 开头' };
  let resp: Response;
  try {
    resp = await webdavFetch(base, { method: 'PROPFIND', headers: { authorization: authHeader(cfg), depth: '0' } });
  } catch (err) {
    return { ok: false, writable: false, error: '无法连接: ' + (err as Error).message };
  }
  if (resp.status === 401 || resp.status === 403) return { ok: false, writable: false, error: '认证失败，请检查用户名与密码（HTTP ' + resp.status + '）' };
  if (!resp.ok && resp.status !== 405 && resp.status !== 404) return { ok: false, writable: false, error: describeStatus(resp) };

  try {
    await ensureDir(cfg);
    const probe = targetDir(cfg) + '/.suenweb-probe';
    const put = await webdavFetch(probe, { method: 'PUT', headers: { authorization: authHeader(cfg), 'content-type': 'text/plain' }, body: 'ok' });
    if (!put.ok) return { ok: true, writable: false, error: '连通但不可写: ' + describeStatus(put) };
    await webdavFetch(probe, { method: 'DELETE', headers: { authorization: authHeader(cfg) } }).catch(() => {});
    return { ok: true, writable: true, error: null };
  } catch (err) {
    return { ok: true, writable: false, error: '写入测试失败: ' + (err as Error).message };
  }
}

export type BackupEntry = { name: string; href: string; size: number; lastModified: string | null };

export async function listBackups(cfg: WebDavConfig): Promise<BackupEntry[]> {
  const dir = targetDir(cfg);
  const resp = await webdavFetch(dir, {
    method: 'PROPFIND',
    headers: { authorization: authHeader(cfg), depth: '1', 'content-type': 'application/xml' },
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getlastmodified/><d:getcontentlength/></d:prop></d:propfind>',
  });
  if (resp.status === 404) return [];
  if (!resp.ok) throw Object.assign(new Error(describeStatus(resp)), { code: 'WEBDAV_ERROR' });
  const xml = await resp.text();
  const entries: BackupEntry[] = [];
  const re = /<(?:[\w.-]+:)?response[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?response>/gi;
  const tag = (block: string, name: string): string => {
    const m = block.match(new RegExp('<(?:[\\w.-]+:)?' + name + '[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?' + name + '>', 'i'));
    return m ? m[1] : '';
  };
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const href = tag(block, 'href');
    const name = decodeURIComponent(href.split('/').pop()?.split('?')[0] ?? '');
    if (!name.startsWith('suenweb-backup-') || !name.endsWith('.swb1')) continue;
    entries.push({
      name,
      href,
      size: Number(tag(block, 'getcontentlength')) || 0,
      lastModified: tag(block, 'getlastmodified') || null,
    });
  }
  entries.sort((a, b) => (a.lastModified ?? '').localeCompare(b.lastModified ?? ''));
  return entries;
}

export async function uploadBackup(cfg: WebDavConfig, name: string, body: Buffer): Promise<void> {
  await ensureDir(cfg);
  const resp = await webdavFetch(targetDir(cfg) + '/' + name, {
    method: 'PUT',
    headers: { authorization: authHeader(cfg), 'content-type': 'application/octet-stream' },
    body: new Uint8Array(body),
  });
  if (!resp.ok) throw Object.assign(new Error(describeStatus(resp)), { code: 'WEBDAV_ERROR' });
}

export async function downloadBackup(cfg: WebDavConfig, name: string): Promise<Buffer> {
  const dir = targetDir(cfg);
  const resp = await webdavFetch(dir + '/' + encodeURIComponent(name), { headers: { authorization: authHeader(cfg) } });
  if (!resp.ok) throw Object.assign(new Error(describeStatus(resp)), { code: 'WEBDAV_ERROR' });
  return Buffer.from(await resp.arrayBuffer());
}

export async function deleteBackup(cfg: WebDavConfig, name: string): Promise<void> {
  await webdavFetch(targetDir(cfg) + '/' + encodeURIComponent(name), { method: 'DELETE', headers: { authorization: authHeader(cfg) } }).catch(() => {});
}

export function backupFileName(prefix: string): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    prefix +
    '-' + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) +
    '-' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds()) +
    '.swb1'
  );
}

export function checksum(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 16);
}
