import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type CachedIcon = { data: Buffer; type: string };

const MAX_BYTES = 200 * 1024;
const TIMEOUT_MS = 6000;
const TTL_MS = 30 * 24 * 3600 * 1000;

const inflight = new Map<string, Promise<CachedIcon | null>>();

function keyOf(origin: string): string {
  return createHash('sha1').update(origin).digest('hex');
}

function sniffType(buffer: Buffer, fallback: string): string {
  const head = buffer.subarray(0, 12);
  if (head[0] === 0x89 && head[1] === 0x50) return 'image/png';
  if (head[0] === 0x00 && head[1] === 0x00 && head[2] === 0x01) return 'image/x-icon';
  if (head.subarray(0, 3).toString('ascii') === 'GIF') return 'image/gif';
  if (head.subarray(0, 4).toString('ascii') === '<svg' || head.subarray(0, 5).toString('ascii') === '<?xml') return 'image/svg+xml';
  if (head.subarray(0, 4).toString('ascii') === 'RIFF') return 'image/webp';
  return fallback;
}

/**
 * favicon 抓取 + 磁盘缓存：只在设置开启时被调用。
 * 只认 http/https，限制体积与超时，失败一律返回 null（前端回退到首字母磁贴）。
 */
export class IconCache {
  private readonly dir: string;

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'icons');
  }

  private fileOf(origin: string): string {
    return join(this.dir, keyOf(origin));
  }

  async read(origin: string): Promise<CachedIcon | null> {
    try {
      const metaRaw = await readFile(this.fileOf(origin) + '.json', 'utf8');
      const meta = JSON.parse(metaRaw) as { type: string; savedAt: number };
      if (Date.now() - meta.savedAt > TTL_MS) return null;
      const data = await readFile(this.fileOf(origin));
      return { data, type: meta.type };
    } catch {
      return null;
    }
  }

  async fetchAndStore(origin: string): Promise<CachedIcon | null> {
    const pending = inflight.get(origin);
    if (pending) return pending;
    const task = this.doFetch(origin).finally(() => inflight.delete(origin));
    inflight.set(origin, task);
    return task;
  }

  private async doFetch(origin: string): Promise<CachedIcon | null> {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(parsed.origin + '/favicon.ico', {
        signal: controller.signal,
        redirect: 'follow',
        headers: { accept: 'image/*', 'user-agent': 'SuenWeb/2.0 (+icon-cache)' },
      });
      if (!response.ok) return null;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) return null;
      const type = sniffType(buffer, response.headers.get('content-type') ?? 'image/x-icon');
      if (!type.startsWith('image/')) return null;
      await mkdir(this.dir, { recursive: true });
      await writeFile(this.fileOf(origin), buffer);
      await writeFile(this.fileOf(origin) + '.json', JSON.stringify({ type, savedAt: Date.now() }));
      return { data: buffer, type };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
