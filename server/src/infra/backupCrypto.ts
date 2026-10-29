import { createCipheriv, createDecipheriv, pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * SWB1 备份文件格式（IMP-06）：
 *   魔数 "SWB1" | salt(16) | iv(12) | AES-256-GCM(payload, authTag 16)
 * 密钥 = PBKDF2-SHA256(管理密码, salt, 120000, 32)
 * 校验失败（密码错误或文件被篡改）统一抛 WRONG_PASSWORD / CORRUPT_BACKUP
 */
const MAGIC = Buffer.from('SWB1', 'ascii');
const ITERATIONS = 120_000;

const pbkdf2Async = promisify(pbkdf2) as (
  password: string | Buffer,
  salt: string | Buffer,
  iterations: number,
  keylen: number,
  digest: string,
) => Promise<Buffer>;

/** M13：异步派生（主线程不阻塞）；迭代次数与格式与旧同步版一致，密文兼容 */
export async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return pbkdf2Async(password.normalize('NFKC'), salt, ITERATIONS, 32, 'sha256');
}

export async function encryptBackup(password: string, plaintext: string): Promise<Buffer> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, body, cipher.getAuthTag()]);
}

export async function decryptBackup(password: string, file: Buffer): Promise<string> {
  if (file.length < MAGIC.length + 16 + 12 + 16 || !file.subarray(0, 4).equals(MAGIC)) {
    throw Object.assign(new Error('不是有效的 SuenWeb 备份文件'), { code: 'CORRUPT_BACKUP' });
  }
  const salt = file.subarray(4, 20);
  const iv = file.subarray(20, 32);
  const body = file.subarray(32, file.length - 16);
  const tag = file.subarray(file.length - 16);
  const key = await deriveKey(password, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    throw Object.assign(new Error('密码不正确或文件已损坏'), { code: 'WRONG_PASSWORD' });
  }
}

/** 时序安全比较（小工具） */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
