import { badRequest } from './errors';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function requireString(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string') throw badRequest(`${field} must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw badRequest(`${field} must be between ${min} and ${max} characters.`);
  }
  return trimmed;
}

export function requireEmail(value: unknown): string {
  const email = requireString(value, 'Email', 5, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) throw badRequest('Email is not a valid address.');
  return email;
}

export function requirePassword(value: unknown): string {
  if (typeof value !== 'string') throw badRequest('Password must be a string.');
  if (value.length < 10) throw badRequest('Password must be at least 10 characters.');
  if (value.length > 128) throw badRequest('Password must be at most 128 characters.');
  return value;
}

export function optionalString(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw badRequest(`${field} must be a string.`);
  if (value.length > max) throw badRequest(`${field} must be at most ${max} characters.`);
  return value.trim() === '' ? null : value.trim();
}

export function requireInt(value: unknown, field: string, min: number, max: number): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
    throw badRequest(`${field} must be an integer between ${min} and ${max}.`);
  }
  return n;
}

export function requireBody(json: unknown): Record<string, unknown> {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    throw badRequest('Request body must be a JSON object.');
  }
  return json as Record<string, unknown>;
}

export function isOneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw badRequest(`${field} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

/** Strips control characters; used before storing free text. Rendering is escaped by React (XSS-safe). */
export function sanitizeText(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}
