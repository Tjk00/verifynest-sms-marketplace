export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, code = 'bad_request') => new AppError(400, code, msg);
export const unauthorized = (msg = 'Authentication required.') => new AppError(401, 'unauthorized', msg);
export const forbidden = (msg = 'You do not have permission to perform this action.') => new AppError(403, 'forbidden', msg);
export const notFound = (msg = 'Not found.') => new AppError(404, 'not_found', msg);
export const conflict = (msg: string, code = 'conflict') => new AppError(409, code, msg);
export const tooManyRequests = (msg = 'Too many requests. Please slow down and try again later.') =>
  new AppError(429, 'rate_limited', msg);
export const internal = (msg = 'An unexpected error occurred. Details have been logged for review.') =>
  new AppError(500, 'internal_error', msg);

/** JSON error envelope. Never leaks stack traces, secrets, or raw provider payloads. */
export function errorResponse(err: unknown): Response {
  if (err instanceof AppError) {
    return Response.json({ error: { code: err.code, message: err.message, details: err.details ?? undefined } }, { status: err.status });
  }
  console.error('unhandled_error', err instanceof Error ? err.message : String(err));
  return Response.json({ error: { code: 'internal_error', message: 'An unexpected error occurred.' } }, { status: 500 });
}
