import type { D1Database } from '@cloudflare/workers-types';
import { sha256Hex } from './crypto';

export interface StoredIdempotency {
  requestHash: string;
  responseJson: string;
  statusCode: number;
}

/**
 * Idempotency protection: the first request for (scope, user, key) stores the response;
 * retries with the same key and body replay the stored response instead of re-executing.
 * Retries with the same key but a DIFFERENT body are rejected (key reuse).
 */
export async function idempotencyLookup(
  db: D1Database,
  scope: string,
  userId: string,
  key: string,
  requestHash: string,
): Promise<{ replay: Response } | { conflict: true } | null> {
  const row = await db
    .prepare('SELECT request_hash, response_json, status_code FROM idempotency_records WHERE scope = ?1 AND user_id = ?2 AND key = ?3')
    .bind(scope, userId, key)
    .first<{ request_hash: string; response_json: string; status_code: number }>();
  if (!row) return null;
  if (row.request_hash !== requestHash) return { conflict: true };
  return {
    replay: new Response(row.response_json, {
      status: row.status_code,
      headers: { 'content-type': 'application/json', 'x-idempotent-replay': 'true' },
    }),
  };
}

export async function idempotencyStore(
  db: D1Database,
  scope: string,
  userId: string,
  key: string,
  requestHash: string,
  response: Response,
): Promise<void> {
  const body = await response.clone().text();
  await db
    .prepare(
      `INSERT OR IGNORE INTO idempotency_records (key, user_id, scope, request_hash, response_json, status_code, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(key, userId, scope, requestHash, body, response.status, new Date().toISOString())
    .run();
}

export async function hashRequestBody(body: unknown): Promise<string> {
  return sha256Hex(JSON.stringify(body ?? null));
}
