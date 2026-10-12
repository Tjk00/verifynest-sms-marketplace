import { Hono } from 'hono';
import type { Env } from '../env';
import type { AppVars } from '../middleware/auth';
import { notFound } from '../lib/errors';
import { getAdapter } from '../providers/registry';
import { logAudit } from '../lib/audit';
import { randomHex } from '../lib/crypto';

export const webhookRoutes = new Hono<{ Bindings: Env; Variables: AppVars }>();

/**
 * POST /api/webhooks/:provider — provider webhook receiver.
 * - Unknown provider → 404.
 * - Adapter without verified webhook support → 404 with an honest message.
 * - Events are recorded with duplicate protection (UNIQUE provider/event id).
 * - Payloads are stored redacted; signature verification is adapter-specific and
 *   must be implemented from the provider's official docs before go-live.
 */
webhookRoutes.post('/:provider', async (c) => {
  const pid = c.req.param('provider');
  const adapter = (() => { try { return getAdapter(pid); } catch { return null; } })();
  if (!adapter) throw notFound('Unknown provider webhook.');

  const raw = await c.req.text();
  if (raw.length > 64 * 1024) throw notFound('Payload too large.');

  let parsed;
  try {
    parsed = await adapter.parseWebhook({ db: c.env.DB, env: c.env }, raw, Object.fromEntries(c.req.raw.headers.entries()));
  } catch {
    // Unsupported or unverifiable webhook → never fabricate processing.
    await logAudit(c.env.DB, { actorRole: 'system', action: 'webhook_rejected', targetType: 'provider', targetId: pid, detail: { reason: 'unsupported_or_invalid' } });
    return c.json({ error: { code: 'webhook_unsupported', message: 'Webhooks are not supported/verified for this provider yet.' } }, 404);
  }
  if (!parsed) return c.json({ ok: true, ignored: true });

  const now = new Date().toISOString();
  try {
    await c.env.DB.prepare(
      `INSERT INTO webhook_events (id, provider_id, external_event_id, event_type, payload_json, signature_valid, processed, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7)`,
    ).bind(randomHex(12), pid, parsed.externalEventId, parsed.eventType, JSON.stringify(parsed.payload).slice(0, 8000), 1, now).run();
  } catch {
    // UNIQUE constraint → duplicate event; acknowledge without reprocessing.
    return c.json({ ok: true, duplicate: true });
  }
  await logAudit(c.env.DB, { actorRole: 'system', action: 'webhook_received', targetType: 'provider', targetId: pid, detail: { event_type: parsed.eventType } });
  return c.json({ ok: true, received: true });
});
