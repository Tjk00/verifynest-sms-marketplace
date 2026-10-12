import type { D1Database } from '@cloudflare/workers-types';
import { tooManyRequests } from './errors';

/**
 * Fixed-window rate limiter backed by D1. Good enough for login/registration
 * abuse control on a free plan; no external services required.
 */
export async function checkRateLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSeconds);
  const bucket = `${key}:${windowStart}`;
  const row = await db
    .prepare('SELECT hits, window_start FROM rate_limits WHERE bucket = ?1')
    .bind(bucket)
    .first<{ hits: number; window_start: number }>();
  if (!row) {
    await db
      .prepare('INSERT INTO rate_limits (bucket, hits, window_start) VALUES (?1, 1, ?2)')
      .bind(bucket, windowStart)
      .run();
    return;
  }
  if (row.hits >= limit) {
    throw tooManyRequests();
  }
  await db.prepare('UPDATE rate_limits SET hits = hits + 1 WHERE bucket = ?1').bind(bucket).run();
}

/** Housekeeping: drop old buckets (called opportunistically). */
export async function pruneRateLimits(db: D1Database): Promise<void> {
  const cutoff = Math.floor(Date.now() / 1000) - 3600;
  await db.prepare('DELETE FROM rate_limits WHERE window_start < ?1').bind(cutoff).run();
}
