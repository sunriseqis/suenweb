import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile , rm } from 'node:fs/promises';
import { join } from 'node:path';
import { isPrivateHost } from '../domain/isPrivateHost.ts';

export type CachedIcon = { data: Buffer; type: string };
export type IconLookup = { status: 'hit'; icon: CachedIcon } | { status: 'negative' } | { status: 'miss' };

const MAX_BYTES = 200 * 1024;
const FETCH_TIMEOUT_MS = 3000;
const HIT_TTL_MS = 30 * 24 * 3600 * 1000;
const NEG_TTL_MS = 24 * 3600 * 1000;

function keyOf(origin: string): string {
  return createHash('sha1').update(origin).digest('hex');
}

function sniffType(buffer: Buffer, fallback: string): string {
  const head = buffer.subarray(0, 12);
  if (head[0] === 0x89 && head[1] === 0x50) return 'image/png';
  if (head.subarray(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
  if (head.subarray(0, 4).toString('ascii') === 'RIFF') return 'image/webp';
  const start = head.toString('ascii').trimStart();
  if (start.startsWith('<svg') || start.startsWith('<?xml')) return 'image/svg+xml';
  if (head[0] === 0x00 && head[1] === 0x00 && (head[2] === 0x01 || head[2] === 0x02)) return 'image/x-icon';
  return fallback;
}

/**
 * favicon 抓取 + 磁盘缓存（参考旧版实现的多源回退与负缓存）：
 *  源顺序：https favicon.ico → https apple-touch-icon.png → http favicon.ico → DuckDuckGo 图标代理
 *  命中缓存 30 天；全部源失败写负缓存 1 天，避免反复重试；拒绝 text/html 响应。
 */
export class IconCache {
  private readonly dir: string;
  private readonly inflight = new Map<string, Promise<IconLookup>>();

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'icons');
  }

  private base(origin: string): string {
    return join(this.dir, keyOf(origin));
  }

  async read(origin: string): Promise<IconLookup> {
    try {
      const metaRaw = await readFile(this.base(origin) + '.json', 'utf8');
      const meta = JSON.parse(metaRaw) as { type: string; savedAt: number };
      if (Date.now() - meta.savedAt > HIT_TTL_MS) return { status: 'miss' };
      const data = await readFile(this.base(origin));
      return { status: 'hit', icon: { data, type: meta.type } };
    } catch {
      // fallthrough to negative check
    }
    try {
      const negRaw = await readFile(this.base(origin) + '.neg', 'utf8');
      const neg = JSON.parse(negRaw) as { savedAt: number };
      if (Date.now() - neg.savedAt < NEG_TTL_MS) return { status: 'negative' };
    } catch {
      // no cache
    }
    return { status: 'miss' };
  }

  /** TOOL-05：清掉某 origin 的正负缓存，下次请求即重抓 */
  async purge(origin: string): Promise<void> {
    const base = this.base(origin);
    await Promise.all([
      rm(base + '.json', { force: true }),
      rm(base + '.neg', { force: true }),
      rm(base, { force: true }),
    ]).catch(() => {});
  }

  async resolve(origin: string): Promise<IconLookup> {
    const pending = this.inflight.get(origin);
    if (pending) return pending;
    const task = this.doResolve(origin).finally(() => this.inflight.delete(origin));
    this.inflight.set(origin, task);
    return task;
  }

  private sourcesOf(origin: string): string[] {
    const host = origin.replace(/^https?:\/\//, '');
    // M9 SSRF：私网地址不出网，直接走 DuckDuckGo 代理之外全拒
    if (isPrivateHost(host)) return [];
    return [
      'https://' + host + '/favicon.ico',
      'https://' + host + '/apple-touch-icon.png',
      'http://' + host + '/favicon.ico',
      'https://icons.duckduckgo.com/ip3/' + host + '.ico',
    ];
  }

  private async doResolve(origin: string): Promise<IconLookup> {
    try {
      const parsed = new URL(origin);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { status: 'miss' };
    } catch {
      return { status: 'miss' };
    }

    for (const source of this.sourcesOf(origin)) {
      const icon = await this.tryFetch(source);
      if (icon) {
        await this.store(origin, icon);
        return { status: 'hit', icon };
      }
    }
    await this.storeNegative(origin);
    return { status: 'negative' };
  }

  private async tryFetch(url: string): Promise<CachedIcon | null> {
    // M9 SSRF：逐源校验（含 DuckDuckGo 代理封装的 host 参数）
    try {
      const target = new URL(url);
      if (target.hostname !== 'icons.duckduckgo.com' && isPrivateHost(target.hostname)) return null;
    } catch {
      return null;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { accept: 'image/*', 'user-agent': 'SuenWeb/2.0 (+icon-cache)' },
      });
      if (!response.ok) return null;
      const headerType = (response.headers.get('content-type') ?? '').toLowerCase();
      if (headerType.includes('text/html') || headerType.includes('text/plain')) return null;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) return null;
      const type = sniffType(buffer, headerType || 'image/x-icon');
      if (!type.startsWith('image/')) return null;
      return { data: buffer, type };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async store(origin: string, icon: CachedIcon): Promise<void> {
    try {
      await mkdir(this.dir, { recursive: true });
      await writeFile(this.base(origin), icon.data);
      await writeFile(this.base(origin) + '.json', JSON.stringify({ type: icon.type, savedAt: Date.now() }));
    } catch {
      // 缓存写失败不影响本次返回
    }
  }

  private async storeNegative(origin: string): Promise<void> {
    try {
      await mkdir(this.dir, { recursive: true });
      await writeFile(this.base(origin) + '.neg', JSON.stringify({ savedAt: Date.now() }));
    } catch {
      // ignore
    }
  }
}
