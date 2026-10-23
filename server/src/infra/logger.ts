import pino from 'pino';

export type Logger = pino.Logger;

const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
];

export function createLogger(level = 'info'): Logger {
  return pino({
    level,
    base: { svc: 'suenweb' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  });
}
