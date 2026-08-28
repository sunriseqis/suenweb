import { Context, Next } from 'hono';
import { Env } from './types';

// PBKDF2-SHA256 password hashing matching Python implementation
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 100000;
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: iterations,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );
  const saltHex = bufferToHex(salt);
  const keyHex = bufferToHex(new Uint8Array(derivedBits));
  return `pbkdf2_sha256$${iterations}$${saltHex}$${keyHex}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash) return false;

  // Legacy SHA256 (64 hex characters)
  if (/^[0-9a-f]{64}$/i.test(storedHash)) {
    const raw = await sha256Hex(password);
    return raw.toLowerCase() === storedHash.toLowerCase();
  }

  const parts = storedHash.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') {
    return false;
  }

  const iterations = parseInt(parts[1], 10);
  const salt = hexToBuffer(parts[2]);
  const expectedKeyHex = parts[3];

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: iterations,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );

  const derivedHex = bufferToHex(new Uint8Array(derivedBits));
  return constantTimeCompare(derivedHex.toLowerCase(), expectedKeyHex.toLowerCase());
}

export async function sha256Hex(input: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return bufferToHex(new Uint8Array(hash));
}

export function generateTokenHex(bytes: number = 24): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return bufferToHex(arr);
}

function bufferToHex(buf: Uint8Array): string {
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function isTokenValid(token: string, db: D1Database): Promise<boolean> {
  if (!token) return false;
  const tokenHash = await sha256Hex(token);
  const now = Math.floor(Date.now() / 1000);
  const row = await db
    .prepare('SELECT expires_at FROM auth_tokens WHERE token_hash = ?')
    .bind(tokenHash)
    .first<{ expires_at: number }>();
  if (!row) return false;
  return row.expires_at > now;
}

export async function issueAuthToken(db: D1Database): Promise<string> {
  const token = generateTokenHex(24);
  const tokenHash = await sha256Hex(token);
  const expiresAt = Math.floor(Date.now() / 1000) + 30 * 86400; // 30 days
  await db
    .prepare('INSERT INTO auth_tokens (token_hash, expires_at) VALUES (?, ?)')
    .bind(tokenHash, expiresAt)
    .run();
  return token;
}

// Hono Middleware for checking authentication
export async function requireAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const db = c.env.DB;
  const pwRow = await db.prepare("SELECT value FROM settings WHERE key = 'auth_password_hash'").first<{ value: string }>();
  const pwHash = pwRow?.value || '';

  // If no password is set, authentication is open
  if (!pwHash) {
    return await next();
  }

  let token = '';
  const authHeader = c.req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else {
    // Check cookie
    const cookie = c.req.header('Cookie') || '';
    const match = cookie.match(/suenweb_token=([^;]+)/);
    if (match) {
      token = match[1].trim();
    }
  }

  if (!token) {
    return c.json({ detail: '未授权，请先登录' }, 401);
  }

  const valid = await isTokenValid(token, db);
  if (!valid) {
    // Check if token matches raw password for backward compatibility
    const pwValid = await verifyPassword(token, pwHash);
    if (!pwValid) {
      return c.json({ detail: '登录已过期或无效' }, 401);
    }
  }

  return await next();
}
