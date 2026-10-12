import { Hono } from 'hono';
import type { Env } from '../env';
import type { AppVars } from '../middleware/auth';
import { requireAdmin } from '../middleware/auth';
import { badRequest, conflict, notFound } from '../lib/errors';
import { isOneOf, requireBody, requireInt, requireString, sanitizeText } from '../lib/validation';
import { logAudit } from '../lib/audit';
import { applyLedgerEntry } from '../lib/ledger';
import { getSettings, publicSettings, setSetting, type AppSettings } from '../lib/settings';
import { getAdapter } from '../providers/registry';
import { randomHex } from '../lib/crypto';

export const adminRoutes = new Hono<{ Bindings: Env; Variables: AppVars }>();
adminRoutes.use('*', requireAdmin);

function ip(c: any): string | null {
  return c.req.header('cf-connecting-ip') ?? null;
}

/** GET /api/admin/overview */
adminRoutes.get('/overview', async (c) => {
  const db = c.env.DB;
  const [users, orders, revenue, tickets, reports] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'customer'").first<{ n: number }>(),
    db.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all<{ status: string; n: number }>(),
    db.prepare("SELECT COALESCE(SUM(price_cents),0) AS gross, COALESCE(SUM(margin_cents),0) AS margin FROM orders WHERE status IN ('awaiting_sms','completed')").first<{ gross: number; margin: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM support_tickets WHERE status = 'open'").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM abuse_reports WHERE status = 'open'").first<{ n: number }>(),
  ]);
  const settings = await getSettings(db);
  return c.json({
    settings: publicSettings(settings),
    customers: users?.n ?? 0,
    ordersByStatus: orders.results ?? [],
    grossRevenueCents: revenue?.gross ?? 0,
    grossMarginCents: revenue?.margin ?? 0,
    marginNote: 'Gross margin before provider failures, refunds, payment fees, hosting limits and support costs. It is NOT guaranteed profit.',
    openTickets: tickets?.n ?? 0,
    openAbuseReports: reports?.n ?? 0,
  });
});

/** GET /api/admin/users */
adminRoutes.get('/users', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, email, role, status, created_at FROM users ORDER BY created_at DESC LIMIT 500',
  ).all();
  return c.json({ users: results ?? [] }); // password_hash deliberately excluded
});

/** POST /api/admin/users/:id/status — suspend / reactivate */
adminRoutes.post('/users/:id/status', async (c) => {
  const admin = c.get('user')!;
  const body = requireBody(await c.req.json().catch(() => null));
  const status = isOneOf(body.status, ['active', 'suspended'] as const, 'Status');
  const target = await c.env.DB.prepare('SELECT id, email, role FROM users WHERE id = ?1').bind(c.req.param('id')).first<{ id: string; email: string; role: string }>();
  if (!target) throw notFound('User not found.');
  if (target.id === admin.id && status === 'suspended') throw conflict('You cannot suspend your own account.');
  await c.env.DB.prepare('UPDATE users SET status = ?1, updated_at = ?2 WHERE id = ?3')
    .bind(status, new Date().toISOString(), target.id).run();
  if (status === 'suspended') {
    // Kill active sessions of the suspended user.
    await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(target.id).run();
  }
  await logAudit(c.env.DB, { actorId: admin.id, actorRole: 'admin', action: `user_${status}`, targetType: 'user', targetId: target.id, ip: ip(c) });
  return c.json({ ok: true, userId: target.id, status });
});

/** GET /api/admin/orders */
adminRoutes.get('/orders', async (c) => {
  const status = c.req.query('status');
  const sql = status
    ? 'SELECT o.*, u.email FROM orders o JOIN users u ON u.id = o.user_id WHERE o.status = ?1 ORDER BY o.created_at DESC LIMIT 200'
    : 'SELECT o.*, u.email FROM orders o JOIN users u ON u.id = o.user_id ORDER BY o.created_at DESC LIMIT 200';
  const stmt = status ? c.env.DB.prepare(sql).bind(status) : c.env.DB.prepare(sql);
  const { results } = await stmt.all();
  return c.json({
    orders: (results ?? []).map((o: any) => ({
      id: o.id, userEmail: o.email, providerId: o.provider_id, mode: o.mode, status: o.status,
      countryCode: o.country_code, serviceCode: o.service_code, priceCents: o.price_cents,
      providerCostCents: o.provider_cost_cents, marginCents: o.margin_cents,
      phoneNumber: o.phone_number, providerOrderRef: o.provider_order_ref,
      errorDetail: o.error_detail, createdAt: o.created_at,
      // sms_code intentionally NOT included in the admin list view (minimal data exposure)
    })),
  });
});

/** GET /api/admin/providers/diagnostics — configuration status WITHOUT secret values. */
adminRoutes.get('/providers/diagnostics', async (c) => {
  const out = [];
  for (const pid of ['test', 'numberotp']) {
    const adapter = getAdapter(pid);
    out.push(await adapter.diagnostics({ db: c.env.DB, env: c.env }));
  }
  return c.json({
    providers: out,
    secretPolicy: 'Secrets live only in Wrangler/Workers secret storage. This API reports presence as booleans and never returns values.',
  });
});

/** POST /api/admin/providers/:id/enabled — immediately enable/disable a provider (audit-logged). */
adminRoutes.post('/providers/:id/enabled', async (c) => {
  const admin = c.get('user')!;
  const pid = c.req.param('id');
  if (!['test', 'numberotp'].includes(pid)) throw notFound('Unknown provider.');
  const body = requireBody(await c.req.json().catch(() => null));
  const enabled = body.enabled === true ? 1 : 0;
  await c.env.DB.prepare('UPDATE providers SET enabled = ?1, updated_at = ?2 WHERE id = ?3')
    .bind(enabled, new Date().toISOString(), pid).run();
  await logAudit(c.env.DB, { actorId: admin.id, actorRole: 'admin', action: enabled ? 'provider_enabled' : 'provider_disabled', targetType: 'provider', targetId: pid, ip: ip(c) });
  return c.json({ ok: true, providerId: pid, enabled: Boolean(enabled) });
});

/** GET /api/admin/settings */
adminRoutes.get('/settings', async (c) => {
  return c.json({ settings: await getSettings(c.env.DB) });
});

/**
 * PUT /api/admin/settings — update application settings.
 * Changing operating_mode is an explicit, authorized, audit-logged admin action.
 */
adminRoutes.put('/settings', async (c) => {
  const admin = c.get('user')!;
  const body = requireBody(await c.req.json().catch(() => null));
  const current = await getSettings(c.env.DB);
  const updates: Partial<AppSettings> = {};

  if (body.operating_mode !== undefined) {
    const mode = isOneOf(body.operating_mode, ['test', 'live'] as const, 'Operating mode');
    if (mode === 'live') {
      // Guard: refuse to go live while no provider adapter is verified & credentialed.
      const adapter = getAdapter('numberotp');
      const diag = await adapter.diagnostics({ db: c.env.DB, env: c.env });
      const row = await c.env.DB.prepare('SELECT enabled FROM providers WHERE id = ?1').bind('numberotp').first<{ enabled: number }>();
      if (!(row?.enabled && diag.credentialsConfigured && diag.endpointsVerified)) {
        throw conflict('Cannot switch to LIVE mode: no upstream provider is enabled with verified endpoints and configured credentials. VerifyNest will not go live without a real, authorized provider.', 'live_blocked');
      }
    }
    updates.operating_mode = mode;
  }
  if (body.support_email !== undefined) {
    const address = requireString((body.support_email as any).address ?? body.support_email, 'Support email', 5, 254);
    const verified = Boolean((body.support_email as any).verified);
    updates.support_email = { address, verified, note: verified ? undefined : 'Mailbox must be created and verified before being displayed as a working contact address.' };
  }
  if (body.default_markup_percent !== undefined) {
    updates.default_markup_percent = requireInt(body.default_markup_percent, 'Markup percent', 0, 500);
  }
  if (body.max_active_orders_per_user !== undefined) {
    updates.max_active_orders_per_user = requireInt(body.max_active_orders_per_user, 'Max active orders', 1, 100);
  }
  if (body.test_signup_credit_cents !== undefined) {
    updates.test_signup_credit_cents = requireInt(body.test_signup_credit_cents, 'Test signup credit', 0, 1_000_000);
  }
  if (body.test_order_ttl_seconds !== undefined) {
    updates.test_order_ttl_seconds = requireInt(body.test_order_ttl_seconds, 'Test order TTL', 30, 86_400);
  }
  if (body.deposits_enabled !== undefined) {
    if (body.deposits_enabled === true && !current.payment_provider) {
      throw conflict('Deposits cannot be enabled before a payment provider is configured and its webhook verification implemented. See docs/PAYMENTS.md.', 'deposits_blocked');
    }
    updates.deposits_enabled = body.deposits_enabled === true;
  }

  if (Object.keys(updates).length === 0) throw badRequest('No valid settings supplied.');
  for (const [k, v] of Object.entries(updates)) {
    await setSetting(c.env.DB, k as keyof AppSettings, v, admin.id);
  }
  if (updates.operating_mode && updates.operating_mode !== current.operating_mode) {
    await logAudit(c.env.DB, { actorId: admin.id, actorRole: 'admin', action: 'operating_mode_changed', detail: { from: current.operating_mode, to: updates.operating_mode }, ip: ip(c) });
  } else {
    await logAudit(c.env.DB, { actorId: admin.id, actorRole: 'admin', action: 'settings_updated', detail: { keys: Object.keys(updates) }, ip: ip(c) });
  }
  return c.json({ settings: await getSettings(c.env.DB) });
});

/** POST /api/admin/prices — set provider cost + markup for a country/service pair. */
adminRoutes.post('/prices', async (c) => {
  const admin = c.get('user')!;
  const body = requireBody(await c.req.json().catch(() => null));
  const providerId = isOneOf(body.provider_id, ['test', 'numberotp'] as const, 'Provider');
  const countryCode = requireString(body.country_code, 'Country code', 1, 64);
  const serviceCode = requireString(body.service_code, 'Service code', 1, 64);
  const cost = requireInt(body.provider_cost_cents, 'Provider cost (cents)', 0, 100_000_00);
  const markup = requireInt(body.markup_percent, 'Markup percent', 0, 500);
  const retail = Math.round(cost * (1 + markup / 100));
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO service_prices (id, provider_id, country_code, service_code, provider_cost_cents, markup_percent, retail_price_cents, currency, active, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'USD', 1, ?8)
     ON CONFLICT(provider_id, country_code, service_code)
     DO UPDATE SET provider_cost_cents = ?5, markup_percent = ?6, retail_price_cents = ?7, active = 1, updated_at = ?8`,
  ).bind(randomHex(12), providerId, countryCode, serviceCode, cost, markup, retail, now).run();
  await logAudit(c.env.DB, { actorId: admin.id, actorRole: 'admin', action: 'price_updated', targetType: 'price', targetId: `${providerId}:${countryCode}:${serviceCode}`, detail: { cost, markup, retail }, ip: ip(c) });
  return c.json({ ok: true, providerId, countryCode, serviceCode, providerCostCents: cost, markupPercent: markup, retailPriceCents: retail });
});

/** GET /api/admin/ledger — inspect ledger entries (all users). */
adminRoutes.get('/ledger', async (c) => {
  const userId = c.req.query('user_id');
  const stmt = userId
    ? c.env.DB.prepare('SELECT l.*, u.email FROM ledger_entries l JOIN users u ON u.id = l.user_id WHERE l.user_id = ?1 ORDER BY l.created_at DESC LIMIT 200').bind(userId)
    : c.env.DB.prepare('SELECT l.*, u.email FROM ledger_entries l JOIN users u ON u.id = l.user_id ORDER BY l.created_at DESC LIMIT 200');
  const { results } = await stmt.all();
  return c.json({ entries: results ?? [] });
});

/** POST /api/admin/wallet-adjust — admin adjustment with mandatory reason (audit-logged). */
adminRoutes.post('/wallet-adjust', async (c) => {
  const admin = c.get('user')!;
  const body = requireBody(await c.req.json().catch(() => null));
  const userId = requireString(body.user_id, 'User id', 1, 64);
  const kind = isOneOf(body.wallet_kind, ['test', 'live'] as const, 'Wallet kind');
  const amount = requireInt(body.amount_cents, 'Amount (cents)', -100_000_00, 100_000_00);
  const reason = sanitizeText(requireString(body.reason, 'Reason', 5, 500));
  const target = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?1').bind(userId).first();
  if (!target) throw notFound('User not found.');
  if (amount === 0) throw badRequest('Amount must be non-zero.');
  const entry = await applyLedgerEntry(c.env.DB, {
    userId, kind, entryType: 'admin_adjustment', amountCents: amount, reason, createdBy: admin.id,
    idempotencyKey: `admin-adjust:${randomHex(8)}`,
  });
  await logAudit(c.env.DB, { actorId: admin.id, actorRole: 'admin', action: 'wallet_adjusted', targetType: 'user', targetId: userId, detail: { kind, amount_cents: amount, reason }, ip: ip(c) });
  return c.json({ ok: true, entryId: entry.entryId, balanceAfterCents: entry.balanceAfterCents });
});

/** POST /api/admin/test-credit — grant TEST credits (test mode controls). */
adminRoutes.post('/test-credit', async (c) => {
  const admin = c.get('user')!;
  const body = requireBody(await c.req.json().catch(() => null));
  const userId = requireString(body.user_id, 'User id', 1, 64);
  const amount = requireInt(body.amount_cents, 'Amount (cents)', 1, 1_000_000);
  const target = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?1').bind(userId).first();
  if (!target) throw notFound('User not found.');
  const entry = await applyLedgerEntry(c.env.DB, {
    userId, kind: 'test', entryType: 'test_credit', amountCents: amount,
    reason: 'TEST credit granted by administrator (simulator funds — not real money).',
    createdBy: admin.id, idempotencyKey: `test-credit:${randomHex(8)}`,
  });
  await logAudit(c.env.DB, { actorId: admin.id, actorRole: 'admin', action: 'test_credit_granted', targetType: 'user', targetId: userId, detail: { amount_cents: amount }, ip: ip(c) });
  return c.json({ ok: true, entryId: entry.entryId, balanceAfterCents: entry.balanceAfterCents, isTestData: true });
});

/** POST /api/admin/refunds — manual refund against an order (admin-authorized, audit-logged). */
adminRoutes.post('/refunds', async (c) => {
  const admin = c.get('user')!;
  const body = requireBody(await c.req.json().catch(() => null));
  const orderId = requireString(body.order_id, 'Order id', 1, 64);
  const reason = sanitizeText(requireString(body.reason, 'Reason', 5, 500));
  const order = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?1').bind(orderId).first<any>();
  if (!order) throw notFound('Order not found.');
  const existing = await c.env.DB.prepare('SELECT id FROM refunds WHERE order_id = ?1').bind(orderId).first();
  if (existing) throw conflict('A refund has already been issued for this order.');
  if (['pending', 'awaiting_sms'].includes(order.status)) {
    throw conflict('Cancel the order first (or let it expire) before refunding.');
  }
  const entry = await applyLedgerEntry(c.env.DB, {
    userId: order.user_id, kind: order.mode, entryType: 'refund', amountCents: order.price_cents,
    orderId, reason, createdBy: admin.id, idempotencyKey: `admin-refund:${orderId}`,
  });
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO refunds (id, order_id, user_id, amount_cents, reason, status, ledger_entry_id, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 'issued', ?6, ?7, ?8)")
      .bind(randomHex(12), orderId, order.user_id, order.price_cents, reason, entry.entryId, admin.id, now),
    c.env.DB.prepare("UPDATE orders SET status = 'refunded', updated_at = ?1 WHERE id = ?2").bind(now, orderId),
  ]);
  await logAudit(c.env.DB, { actorId: admin.id, actorRole: 'admin', action: 'refund_issued', targetType: 'order', targetId: orderId, detail: { amount_cents: order.price_cents, reason }, ip: ip(c) });
  return c.json({ ok: true, refundAmountCents: order.price_cents, isTestData: order.mode === 'test' });
});

/** GET /api/admin/tickets + POST reply/status */
adminRoutes.get('/tickets', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT t.*, u.email FROM support_tickets t JOIN users u ON u.id = t.user_id ORDER BY t.updated_at DESC LIMIT 200',
  ).all();
  return c.json({ tickets: results ?? [] });
});

adminRoutes.get('/tickets/:id', async (c) => {
  const ticket = await c.env.DB.prepare('SELECT t.*, u.email FROM support_tickets t JOIN users u ON u.id = t.user_id WHERE t.id = ?1')
    .bind(c.req.param('id')).first<any>();
  if (!ticket) throw notFound('Ticket not found.');
  const { results } = await c.env.DB.prepare('SELECT author_role, body, created_at FROM ticket_messages WHERE ticket_id = ?1 ORDER BY created_at')
    .bind(ticket.id).all();
  return c.json({ ticket, messages: results ?? [] });
});

adminRoutes.post('/tickets/:id/reply', async (c) => {
  const admin = c.get('user')!;
  const ticket = await c.env.DB.prepare('SELECT * FROM support_tickets WHERE id = ?1').bind(c.req.param('id')).first<any>();
  if (!ticket) throw notFound('Ticket not found.');
  const body = requireBody(await c.req.json().catch(() => null));
  const message = sanitizeText(requireString(body.message, 'Message', 1, 4000));
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO ticket_messages (id, ticket_id, author_id, author_role, body, created_at) VALUES (?1, ?2, ?3, 'admin', ?4, ?5)")
      .bind(randomHex(12), ticket.id, admin.id, message, now),
    c.env.DB.prepare("UPDATE support_tickets SET status = 'answered', updated_at = ?1 WHERE id = ?2").bind(now, ticket.id),
  ]);
  await logAudit(c.env.DB, { actorId: admin.id, actorRole: 'admin', action: 'ticket_replied', targetType: 'ticket', targetId: ticket.id, ip: ip(c) });
  return c.json({ ok: true });
});

adminRoutes.post('/tickets/:id/close', async (c) => {
  const admin = c.get('user')!;
  const ticket = await c.env.DB.prepare('SELECT id FROM support_tickets WHERE id = ?1').bind(c.req.param('id')).first<{ id: string }>();
  if (!ticket) throw notFound('Ticket not found.');
  await c.env.DB.prepare("UPDATE support_tickets SET status = 'closed', updated_at = ?1 WHERE id = ?2")
    .bind(new Date().toISOString(), ticket.id).run();
  await logAudit(c.env.DB, { actorId: admin.id, actorRole: 'admin', action: 'ticket_closed', targetType: 'ticket', targetId: ticket.id, ip: ip(c) });
  return c.json({ ok: true });
});

/** GET /api/admin/abuse-reports + POST handle */
adminRoutes.get('/abuse-reports', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM abuse_reports ORDER BY created_at DESC LIMIT 200').all();
  return c.json({ reports: results ?? [] });
});

adminRoutes.post('/abuse-reports/:id/handle', async (c) => {
  const admin = c.get('user')!;
  const body = requireBody(await c.req.json().catch(() => null));
  const status = isOneOf(body.status, ['reviewed', 'dismissed', 'actioned'] as const, 'Status');
  const report = await c.env.DB.prepare('SELECT id FROM abuse_reports WHERE id = ?1').bind(c.req.param('id')).first<{ id: string }>();
  if (!report) throw notFound('Report not found.');
  await c.env.DB.prepare('UPDATE abuse_reports SET status = ?1, handled_by = ?2, handled_at = ?3 WHERE id = ?4')
    .bind(status, admin.id, new Date().toISOString(), report.id).run();
  await logAudit(c.env.DB, { actorId: admin.id, actorRole: 'admin', action: `abuse_report_${status}`, targetType: 'abuse_report', targetId: report.id, ip: ip(c) });
  return c.json({ ok: true });
});

/** GET /api/admin/audit — audit trail */
adminRoutes.get('/audit', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 300').all();
  return c.json({ events: results ?? [] });
});

/** GET /api/admin/payments — payment integration status (interface only; live deposits disabled). */
adminRoutes.get('/payments', async (c) => {
  const settings = await getSettings(c.env.DB);
  return c.json({
    depositsEnabled: settings.deposits_enabled,
    paymentProvider: settings.payment_provider,
    webhookSecretConfigured: typeof c.env.PAYMENT_WEBHOOK_SECRET === 'string' && c.env.PAYMENT_WEBHOOK_SECRET.length > 0,
    activationChecklist: [
      'Select a payment provider available in your country and confirm its fees/approval requirements.',
      'Store its API credentials as Wrangler secrets (never in git, never in frontend code).',
      'Implement signed-webhook verification server-side (PAYMENT_WEBHOOK_SECRET).',
      'Implement duplicate-event protection (deposits table UNIQUE constraint is ready).',
      'Define reconciliation procedure and publish payment/refund policies.',
      'Only then set payment_provider and deposits_enabled = true via admin settings.',
    ],
  });
});
