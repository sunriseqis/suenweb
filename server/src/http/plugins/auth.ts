import type { FastifyRequest } from 'fastify';

export const SESSION_COOKIE = 'sw_session';

/** 浏览器走 Cookie，插件走 Authorization: Bearer <token>；SSE（EventSource 不支持 header）允许 ?token= 查询参数兜底 */
export function extractToken(req: FastifyRequest): string | null {
  const fromCookie = req.cookies ? req.cookies[SESSION_COOKIE] : undefined;
  if (fromCookie) return fromCookie;
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    const token = header.slice(7).trim();
    return token || null;
  }
  // M11：仅 SSE 场景使用；EventSource 无法带 header，token 只能走 URL query
  const query = (req.query ?? {}) as { token?: string };
  if (typeof query.token === 'string' && query.token) return query.token;
  return null;
}

export function deviceLabel(req: FastifyRequest): string | null {
  const ua = req.headers['user-agent'];
  if (typeof ua !== 'string') return null;
  return ua.slice(0, 120);
}
