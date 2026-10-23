export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function badRequest(code: string, message: string, details?: unknown): AppError {
  return new AppError(code, message, 400, details);
}

export function unauthorized(message = '请先登录'): AppError {
  return new AppError('UNAUTHENTICATED', message, 401);
}

export function forbidden(message = '没有权限'): AppError {
  return new AppError('FORBIDDEN', message, 403);
}

export function notFound(message = '资源不存在'): AppError {
  return new AppError('NOT_FOUND', message, 404);
}

export function conflict(code: string, message: string, details?: unknown): AppError {
  return new AppError(code, message, 409, details);
}

export function tooManyRequests(message: string, details?: unknown): AppError {
  return new AppError('TOO_MANY_REQUESTS', message, 429, details);
}
