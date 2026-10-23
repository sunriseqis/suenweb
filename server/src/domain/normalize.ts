import { badRequest } from './errors.ts';

// 分组名归一化：NFKC + 空白折叠 + 去首尾 + 小写（重名自动合并的判定键）
const WHITESPACE = /[\s\u3000]+/g;

export function displayName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.normalize('NFKC').replace(WHITESPACE, ' ').trim();
}

export function normalizeNameKey(raw: string): string {
  return displayName(raw).toLowerCase();
}

// 链接去重归一化：协议/主机小写、去默认端口、去尾斜杠、去跟踪参数、query 排序、丢 hash
const TRACKING_EXACT = new Set([
  'fbclid', 'gclid', 'msclkid', 'yclid', 'dclid', 'spm', 'scm', 'ref', 'ref_src', 'from',
  'share_source', 'mkt_tok', 'igshid', 'mc_cid', 'mc_eid', '_hsenc', '_hsmi', 's_kwcid',
]);

function isTracking(key: string): boolean {
  const k = key.toLowerCase();
  return k.startsWith('utm_') || TRACKING_EXACT.has(k);
}

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

export type NormalizedUrl = { url: string; normalized: string };

export function normalizeUrl(input: unknown): NormalizedUrl {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) throw badRequest('INVALID_URL', '网址不能为空');
  const withScheme = SCHEME.test(raw) ? raw : 'https://' + raw;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    throw badRequest('INVALID_URL', '无法识别的网址: ' + raw, { url: raw });
  }
  const protocol = u.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw badRequest('INVALID_URL', '只支持 http/https 网址', { url: raw });
  }
  const host = u.hostname.toLowerCase().replace(/\.+$/, '');
  if (!host) throw badRequest('INVALID_URL', '网址缺少主机名', { url: raw });
  let port = u.port;
  if ((protocol === 'http:' && port === '80') || (protocol === 'https:' && port === '443')) port = '';
  const authority = port ? host + ':' + port : host;
  const path = u.pathname || '/';
  const kept: Array<[string, string]> = [];
  for (const [k, v] of u.searchParams) {
    if (!isTracking(k)) kept.push([k, v]);
  }
  const sorted = kept.slice().sort((a, b) => {
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
    if (a[1] === b[1]) return 0;
    return a[1] < b[1] ? -1 : 1;
  });
  const canonicalQuery = new URLSearchParams(sorted).toString();
  const trimmedPath = path.replace(/\/+$/, '');
  const normalized = protocol + '//' + authority + trimmedPath + (canonicalQuery ? '?' + canonicalQuery : '');
  const displayQuery = new URLSearchParams(kept).toString();
  const url = protocol + '//' + authority + path + (displayQuery ? '?' + displayQuery : '') + (u.hash || '');
  return { url, normalized };
}

export function displayTitle(title: unknown, fallbackUrl: string): string {
  const t = typeof title === 'string' ? title.trim() : '';
  if (t) return t.slice(0, 200);
  try {
    const u = new URL(fallbackUrl);
    return (u.hostname + u.pathname).slice(0, 200);
  } catch {
    return fallbackUrl.slice(0, 200);
  }
}
