import type { FastifyRequest } from 'fastify';

export const SESSION_COOKIE = 'sw_session';

/** 浏览器走 Cookie，插件走 Authorization: Bearer <token> */
export function extractToken(req: FastifyRequest): string | null {
  const fromCookie = req.cookies ? req.cookies[SESSION_COOKIE] : undefined;
  if (fromCookie) return fromCookie;
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    const token = header.slice(7).trim();
    return token || null;
  }
  return null;
}

export function deviceLabel(req: FastifyRequest): string | null {
  const ua = req.headers['user-agent'];
  if (typeof ua !== 'string') return null;
  return ua.slice(0, 120);
}
