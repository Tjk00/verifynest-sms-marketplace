import type { D1Database } from '@cloudflare/workers-types';
import { randomHex } from './crypto';

export interface AuditInput {
  actorId?: string | null;
  actorRole?: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  detail?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * Appends an audit event. detail must never include secrets, password hashes,
 * session tokens, or full SMS bodies.
 */
export async function logAudit(db: D1Database, input: AuditInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO audit_events (id, actor_id, actor_role, action, target_type, target_id, detail_json, ip, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(
      randomHex(16),
      input.actorId ?? null,
      input.actorRole ?? 'system',
      input.action,
      input.targetType ?? null,
      input.targetId ?? null,
      JSON.stringify(input.detail ?? {}),
      input.ip ?? null,
      new Date().toISOString(),
    )
    .run();
}
