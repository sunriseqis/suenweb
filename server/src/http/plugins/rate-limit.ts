import { tooManyRequests } from '../../domain/errors.ts';

/** 登录失败限速：内存计数，逐 IP 逐个窗口；成功即清零 */
export class FailureLimiter {
  private readonly max: number;
  private readonly windowMs: number;
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(max = 5, windowMs = 60000) {
    this.max = max;
    this.windowMs = windowMs;
  }

  assertAllowed(key: string): void {
    const hit = this.hits.get(key);
    if (!hit) return;
    if (Date.now() > hit.resetAt) {
      this.hits.delete(key);
      return;
    }
    if (hit.count >= this.max) {
      const seconds = Math.max(1, Math.ceil((hit.resetAt - Date.now()) / 1000));
      throw tooManyRequests('尝试过于频繁，请 ' + seconds + ' 秒后再试');
    }
  }

  fail(key: string): void {
    const hit = this.hits.get(key);
    if (!hit || Date.now() > hit.resetAt) {
      this.hits.set(key, { count: 1, resetAt: Date.now() + this.windowMs });
      return;
    }
    hit.count += 1;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  cleanup(now = Date.now()): void {
    for (const [key, hit] of this.hits) {
      if (now > hit.resetAt) this.hits.delete(key);
    }
  }
}
