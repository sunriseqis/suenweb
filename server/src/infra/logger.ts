import pino from 'pino';

export type Logger = pino.Logger;

const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  'req.url', // 脱敏 URL（含 query token）
];

export function createLogger(level = 'info'): Logger {
  return pino({
    level,
    base: { svc: 'suenweb' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    serializers: {
      // 只保留 path，不带 query（SSE token 在 query 里，避免进日志）
      req: (req: { method?: string; url?: string; ip?: string }) => ({
        method: req.method,
        url: req.url ? req.url.split('?')[0] : req.url,
        remoteAddress: req.ip,
      }),
    },
  });
}
