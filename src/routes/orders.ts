import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../env';
import type { AppVars } from '../middleware/auth';
import { requireUser } from '../middleware/auth';
import { AppError, badRequest, conflict, internal, notFound } from '../lib/errors';
import { requireBody, requireString, isOneOf } from '../lib/validation';
import { randomHex } from '../lib/crypto';
import { checkRateLimit } from '../lib/ratelimit';
import { logAudit } from '../lib/audit';
import { applyLedgerEntry, AppInsufficientBalanceError } from '../lib/ledger';
import { getSettings } from '../lib/settings';
import { getAdapter, resolveProviderForMode } from '../providers/registry';
import { ProviderNotConfiguredError, UnsupportedOperationError } from '../providers/types';
import { hashRequestBody, idempotencyLookup, idempotencyStore } from '../lib/idempotency';

export const orderRoutes = new Hono<{ Bindings: Env; Variables: AppVars }>();
orderRoutes.use('*', requireUser);

interface OrderRow {
  id: string; user_id: string; provider_id: string; country_code: string; service_code: string;
  mode: 'test' | 'live'; status: string; price_cents: number; provider_cost_cents: number;
  margin_cents: number; phone_number: string | null; provider_order_ref: string | null;
  sms_code: string | null; sms_received_at: string | null; expires_at: string | null;
  error_detail: string | null; provider_state_json: string; created_at: string; updated_at: string;
}

/** Shapes an order for its OWNER. SMS code included only for the owner (this route is owner-only). */
function orderForOwner(o: OrderRow) {
  const now = Date.now();
  const expired = o.expires_at ? new Date(o.expires_at).getTime() < now : false;
  return {
    id: o.id,
    countryCode: o.country_code,
    serviceCode: o.service_code,
    providerId: o.provider_id,
    mode: o.mode,
    isTestData: o.mode === 'test',
    status: expired && ['pending', 'awaiting_sms'].includes(o.status) ? 'expired' : o.status,
    priceCents: o.price_cents,
    phoneNumber: o.phone_number,
    smsCode: o.sms_code, // owner-only route; admin route gates separately
    smsReceivedAt: o.sms_received_at,
    expiresAt: o.expires_at,
    errorDetail: o.error_detail,
    createdAt: o.created_at,
    updatedAt: o.updated_at,
  };
}

function orderForList(o: OrderRow) {
  const full = orderForOwner(o);
  return { ...full, smsCode: full.status === 'completed' ? full.smsCode : null };
}

/** POST /api/orders — create an order. Idempotent per (user, Idempotency-Key). */
orderRoutes.post('/', async (c) => {
  const user = c.get('user')!;
  await checkRateLimit(c.env.DB, `orders:${user.id}`, 20, 60);

  const body = requireBody(await c.req.json().catch(() => null));
  const countryCode = requireString(body.country_code, 'Country code', 1, 64);
  const serviceCode = requireString(body.service_code, 'Service code', 1, 64);
  const idemKey = requireString(
    body.idempotency_key ?? c.req.header('idempotency-key'),
    'Idempotency key', 8, 128,
  );

  const requestHash = await hashRequestBody({ countryCode, serviceCode });
  const existing = await idempotencyLookup(c.env.DB, 'create-order', user.id, idemKey, requestHash);
  if (existing) {
    if ('conflict' in existing) throw conflict('This idempotency key was already used with different parameters. Generate a fresh key.');
    return existing.replay;
  }

  // A prior attempt with this key may exist without a stored response (e.g. a 402 that
  // aborted early). Replay that order instead of creating a duplicate purchase.
  const priorOrder = await c.env.DB.prepare('SELECT * FROM orders WHERE user_id = ?1 AND idempotency_key = ?2')
    .bind(user.id, idemKey).first<OrderRow>();
  if (priorOrder) {
    return c.json({ order: orderForOwner(priorOrder), replayed: true }, 200);
  }

  const settings = await getSettings(c.env.DB);
  const mode = settings.operating_mode;

  // Purchase limit: count non-terminal orders.
  const active = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM orders WHERE user_id = ?1 AND status IN ('pending','awaiting_sms')",
  ).bind(user.id).first<{ n: number }>();
  if ((active?.n ?? 0) >= settings.max_active_orders_per_user) {
    throw conflict(`Purchase limit reached (${settings.max_active_orders_per_user} active orders). Wait for active orders to complete, cancel, or expire.`);
  }

  // Resolve provider for the operating mode; clear error when nothing is connected.
  let adapter;
  try {
    adapter = (await resolveProviderForMode(c.env.DB, c.env, mode)).adapter;
  } catch (e) {
    if (e instanceof ProviderNotConfiguredError) throw conflict(e.message, 'provider_not_configured');
    throw e;
  }

  // Server-side price: never trust the client. Missing price = not purchasable.
  const price = await c.env.DB.prepare(
    'SELECT provider_cost_cents, markup_percent, retail_price_cents FROM service_prices WHERE provider_id = ?1 AND country_code = ?2 AND service_code = ?3 AND active = 1',
  ).bind(adapter.id, countryCode, serviceCode).first<{ provider_cost_cents: number; markup_percent: number; retail_price_cents: number }>();
  if (!price) throw notFound('That country/service combination is not currently offered. The catalogue only lists what the configured provider actually supports.');

  const retail = Math.max(0, Math.round(price.provider_cost_cents * (1 + (price.markup_percent ?? settings.default_markup_percent) / 100)));
  const walletKind = mode === 'test' ? 'test' : 'live';
  const orderId = randomHex(12);

  // 1) Record the order as 'pending' FIRST — ledger entries have an FK to orders.
  await insertOrder(c, {
    orderId, user, adapterId: adapter.id, mode, countryCode, serviceCode, retail,
    providerCost: price.provider_cost_cents, status: 'pending', idemKey,
    phone: null, ref: null, expiresAt: null, errorDetail: null,
  });

  // 2) Debit the wallet (idempotent ledger key = order id). Insufficient balance aborts
  //    without any money moving; the pending order is marked failed for transparency.
  try {
    await applyLedgerEntry(c.env.DB, {
      userId: user.id, kind: walletKind, entryType: 'order_charge', amountCents: -retail,
      orderId, reason: `Order charge: ${serviceCode} @ ${countryCode}`, createdBy: 'system',
      idempotencyKey: `order-charge:${orderId}`,
    });
  } catch (e) {
    if (e instanceof AppInsufficientBalanceError) {
      await c.env.DB.prepare("UPDATE orders SET status = 'failed', error_detail = ?1, updated_at = ?2 WHERE id = ?3")
        .bind('Insufficient balance — no charge was made.', new Date().toISOString(), orderId).run();
      const label = walletKind === 'test' ? 'TEST wallet (simulator credits — not real money)' : 'wallet';
      throw new AppError(402, 'insufficient_balance',
        `Insufficient ${label} balance. Price: $${(retail / 100).toFixed(2)}. Current balance: $${(e.currentBalanceCents / 100).toFixed(2)}.`);
    }
    throw e;
  }

  // 3) Request the number from the provider.
  let numberResult;
  try {
    numberResult = await adapter.requestNumber({ db: c.env.DB, env: c.env }, { countryCode, serviceCode });
  } catch (e) {
    const failDetail = (e instanceof UnsupportedOperationError || e instanceof ProviderNotConfiguredError)
      ? e.message
      : 'Provider request errored before provisioning. Your wallet was refunded.';
    await c.env.DB.prepare("UPDATE orders SET status = 'failed', error_detail = ?1, updated_at = ?2 WHERE id = ?3")
      .bind(failDetail, new Date().toISOString(), orderId).run();
    await refundFailedOrder(c, { orderId, user, walletKind, retail, reason: 'Provider request errored before provisioning.' });
    await c.env.DB.prepare("UPDATE orders SET status = 'refunded', updated_at = ?1 WHERE id = ?2").bind(new Date().toISOString(), orderId).run();
    const row = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?1').bind(orderId).first<OrderRow>();
    if (e instanceof UnsupportedOperationError || e instanceof ProviderNotConfiguredError) {
      const resp = c.json({ order: orderForOwner(row!), error: { code: 'provider_unsupported', message: e.message } }, 409);
      await idempotencyStore(c.env.DB, 'create-order', user.id, idemKey, requestHash, resp);
      return resp;
    }
    await logAudit(c.env.DB, { actorId: user.id, actorRole: user.role, action: 'order_provider_error', targetType: 'order', targetId: orderId });
    const resp = c.json({ order: orderForOwner(row!) }, 200);
    await idempotencyStore(c.env.DB, 'create-order', user.id, idemKey, requestHash, resp);
    return resp;
  }

  if (numberResult.state !== 'provisioned' || !numberResult.phoneNumber || !numberResult.providerOrderRef) {
    const detail = numberResult.failureReason ?? 'Number request failed. Your wallet was refunded.';
    await c.env.DB.prepare("UPDATE orders SET status = 'failed', error_detail = ?1, updated_at = ?2 WHERE id = ?3")
      .bind(detail, new Date().toISOString(), orderId).run();
    await refundFailedOrder(c, { orderId, user, walletKind, retail, reason: numberResult.failureReason ?? 'Provider could not provision a number.' });
    await c.env.DB.prepare("UPDATE orders SET status = 'refunded', updated_at = ?1 WHERE id = ?2").bind(new Date().toISOString(), orderId).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?1').bind(orderId).first<OrderRow>();
    const resp = c.json({ order: orderForOwner(fresh!) }, 200);
    await idempotencyStore(c.env.DB, 'create-order', user.id, idemKey, requestHash, resp);
    return resp;
  }

  // 4) Provisioned: record the number + provider reference and move to awaiting_sms.
  const expiresAt = numberResult.expiresAt ?? new Date(Date.now() + settings.test_order_ttl_seconds * 1000).toISOString();
  await c.env.DB.prepare(
    "UPDATE orders SET status = 'awaiting_sms', phone_number = ?1, provider_order_ref = ?2, expires_at = ?3, updated_at = ?4 WHERE id = ?5",
  ).bind(numberResult.phoneNumber, numberResult.providerOrderRef, expiresAt, new Date().toISOString(), orderId).run();
  const row = (await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?1').bind(orderId).first<OrderRow>())!;
  await logAudit(c.env.DB, { actorId: user.id, actorRole: user.role, action: 'order_created', targetType: 'order', targetId: orderId, detail: { mode, provider: adapter.id, price_cents: retail } });
  const resp = c.json({ order: orderForOwner(row), marginCents: retail - price.provider_cost_cents }, 201);
  await idempotencyStore(c.env.DB, 'create-order', user.id, idemKey, requestHash, resp);
  return resp;
});

async function insertOrder(c: any, o: {
  orderId: string; user: { id: string }; adapterId: string; mode: 'test' | 'live';
  countryCode: string; serviceCode: string; retail: number; providerCost: number;
  status: string; idemKey: string; phone: string | null; ref: string | null;
  expiresAt: string | null; errorDetail: string | null;
}): Promise<OrderRow> {
  const now = new Date().toISOString();
  try {
    await c.env.DB.prepare(
      `INSERT INTO orders (id, user_id, provider_id, country_code, service_code, mode, status,
          price_cents, provider_cost_cents, margin_cents, phone_number, provider_order_ref,
          expires_at, error_detail, idempotency_key, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?16)`,
    ).bind(o.orderId, o.user.id, o.adapterId, o.countryCode, o.serviceCode, o.mode, o.status,
      o.retail, o.providerCost, o.retail - o.providerCost, o.phone, o.ref, o.expiresAt, o.errorDetail, o.idemKey, now).run();
  } catch (e) {
    // UNIQUE (user_id, idempotency_key): a previous attempt with this key exists —
    // return that order instead of creating a duplicate purchase.
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('UNIQUE constraint failed')) {
      throw conflict('An order with this idempotency key already exists. Use a fresh key for a new purchase.');
    }
    throw e;
  }
  const db = c.env.DB as D1Database;
  const row = await db.prepare('SELECT * FROM orders WHERE id = ?1').bind(o.orderId).first<OrderRow>();
  if (!row) throw internal();
  return row;
}

async function refundFailedOrder(c: any, o: { orderId: string; user: { id: string; role: string }; walletKind: 'test' | 'live'; retail: number; reason: string }) {
  try {
    await applyLedgerEntry(c.env.DB, {
      userId: o.user.id, kind: o.walletKind, entryType: 'refund', amountCents: o.retail,
      orderId: o.orderId, reason: `Automatic refund — ${o.reason}`, createdBy: 'system',
      idempotencyKey: `auto-refund:${o.orderId}`,
    });
  } catch {
    await logAudit(c.env.DB, { actorId: o.user.id, actorRole: o.user.role, action: 'auto_refund_failed', targetType: 'order', targetId: o.orderId, detail: { reason: o.reason } });
  }
}

/** GET /api/orders — own orders only. */
orderRoutes.get('/', async (c) => {
  const user = c.get('user')!;
  const { results } = await c.env.DB.prepare('SELECT * FROM orders WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 100')
    .bind(user.id).all<OrderRow>();
  return c.json({ orders: (results ?? []).map(orderForList) });
});

/** GET /api/orders/:id — ownership enforced; other users get 404 (no existence leak). */
orderRoutes.get('/:id', async (c) => {
  const user = c.get('user')!;
  const row = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?1 AND user_id = ?2')
    .bind(c.req.param('id'), user.id).first<OrderRow>();
  if (!row) throw notFound('Order not found.');
  return c.json({ order: orderForOwner(row) });
});

/** POST /api/orders/:id/check — poll provider for SMS/status (rate-limited). */
orderRoutes.post('/:id/check', async (c) => {
  const user = c.get('user')!;
  await checkRateLimit(c.env.DB, `check:${user.id}`, 30, 60);
  const row = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?1 AND user_id = ?2')
    .bind(c.req.param('id'), user.id).first<OrderRow>();
  if (!row) throw notFound('Order not found.');

  if (['completed', 'cancelled', 'failed', 'refunded'].includes(row.status)) {
    return c.json({ order: orderForOwner(row), note: 'Order is in a terminal state.' });
  }

  // Expiry handling (TTL passed without a code).
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now() && row.status !== 'expired') {
    await expireAndRefund(c, row, user);
    const fresh = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?1').bind(row.id).first<OrderRow>();
    return c.json({ order: orderForOwner(fresh!) });
  }

  const adapter = getAdapter(row.provider_id);
  let result;
  try {
    result = await adapter.checkSms({ db: c.env.DB, env: c.env }, {
      providerOrderRef: row.provider_order_ref ?? '',
      phoneNumber: row.phone_number ?? '',
      countryCode: row.country_code,
      serviceCode: row.service_code,
      providerState: safeJson(row.provider_state_json),
      orderCreatedAt: row.created_at,
    });
  } catch (e) {
    if (e instanceof UnsupportedOperationError || e instanceof ProviderNotConfiguredError) throw conflict(e.message, 'provider_unsupported');
    await logAudit(c.env.DB, { actorId: user.id, actorRole: user.role, action: 'order_check_provider_error', targetType: 'order', targetId: row.id });
    throw badRequest('The provider could not be reached. Try again shortly — your order is unchanged.');
  }

  const now = new Date().toISOString();
  if (result.providerState) {
    await c.env.DB.prepare('UPDATE orders SET provider_state_json = ?1, updated_at = ?2 WHERE id = ?3')
      .bind(JSON.stringify(result.providerState), now, row.id).run();
  }

  if (result.state === 'received' && result.smsCode) {
    await c.env.DB.prepare(
      "UPDATE orders SET status = 'completed', sms_code = ?1, sms_received_at = ?2, updated_at = ?2 WHERE id = ?3 AND status != 'completed'",
    ).bind(result.smsCode, now, row.id).run();
  } else if (result.state === 'failed' || result.state === 'cancelled') {
    await c.env.DB.prepare('UPDATE orders SET status = ?1, error_detail = ?2, updated_at = ?3 WHERE id = ?4')
      .bind(result.state === 'failed' ? 'failed' : 'cancelled', result.failureReason ?? null, now, row.id).run();
    if (result.state === 'failed') {
      await refundFailedOrder(c, { orderId: row.id, user, walletKind: row.mode, retail: row.price_cents, reason: result.failureReason ?? 'Provider reported failure.' });
      await c.env.DB.prepare("UPDATE orders SET status = 'refunded', updated_at = ?1 WHERE id = ?2").bind(now, row.id).run();
    }
  } else if (result.state === 'expired') {
    await expireAndRefund(c, row, user);
  }

  const fresh = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?1').bind(row.id).first<OrderRow>();
  return c.json({ order: orderForOwner(fresh!) });
});

async function expireAndRefund(c: any, row: OrderRow, user: { id: string; role: string }) {
  const now = new Date().toISOString();
  await c.env.DB.prepare("UPDATE orders SET status = 'expired', error_detail = ?1, updated_at = ?2 WHERE id = ?3 AND status IN ('pending','awaiting_sms')")
    .bind('The number expired before an SMS arrived.', now, row.id).run();
  await applyLedgerEntry(c.env.DB, {
    userId: user.id, kind: row.mode, entryType: 'refund', amountCents: row.price_cents,
    orderId: row.id, reason: 'Automatic refund — number expired without SMS delivery.', createdBy: 'system',
    idempotencyKey: `expiry-refund:${row.id}`,
  }).catch(async () => {
    await logAudit(c.env.DB, { actorId: user.id, actorRole: user.role, action: 'expiry_refund_failed', targetType: 'order', targetId: row.id });
  });
  await c.env.DB.prepare("UPDATE orders SET status = 'refunded', updated_at = ?1 WHERE id = ?2 AND status = 'expired'").bind(now, row.id).run();
}

/** POST /api/orders/:id/cancel — cancel when the provider supports it; refund per policy. */
orderRoutes.post('/:id/cancel', async (c) => {
  const user = c.get('user')!;
  const row = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?1 AND user_id = ?2')
    .bind(c.req.param('id'), user.id).first<OrderRow>();
  if (!row) throw notFound('Order not found.');
  if (!['pending', 'awaiting_sms'].includes(row.status)) {
    throw conflict(`Order cannot be cancelled in status "${row.status}".`);
  }
  const adapter = getAdapter(row.provider_id);
  let cancelResult;
  try {
    cancelResult = await adapter.cancelOrder({ db: c.env.DB, env: c.env }, {
      providerOrderRef: row.provider_order_ref ?? '', phoneNumber: row.phone_number ?? '',
    });
  } catch (e) {
    if (e instanceof UnsupportedOperationError) throw conflict(e.message, 'cancellation_unsupported');
    throw badRequest('The provider could not be reached. The order was NOT cancelled and no refund was issued.');
  }
  const now = new Date().toISOString();
  if (cancelResult.state === 'failed') {
    throw conflict(cancelResult.failureReason ?? 'The provider refused the cancellation.');
  }
  // cancelled / refund_approved → refund in full; refund_denied → cancelled without refund.
  await c.env.DB.prepare("UPDATE orders SET status = 'cancelled', updated_at = ?1 WHERE id = ?2").bind(now, row.id).run();
  if (cancelResult.state !== 'refund_denied') {
    await applyLedgerEntry(c.env.DB, {
      userId: user.id, kind: row.mode, entryType: 'refund', amountCents: row.price_cents,
      orderId: row.id, reason: 'Cancellation refund.', createdBy: 'system',
      idempotencyKey: `cancel-refund:${row.id}`,
    });
    await c.env.DB.prepare("UPDATE orders SET status = 'refunded', updated_at = ?1 WHERE id = ?2").bind(now, row.id).run();
    await c.env.DB.prepare(
      "INSERT INTO refunds (id, order_id, user_id, amount_cents, reason, status, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 'issued', 'system', ?6)")
      .bind(randomHex(12), row.id, user.id, row.price_cents, 'Customer cancellation (provider approved refund).', now)
      .run();
  }
  await logAudit(c.env.DB, { actorId: user.id, actorRole: user.role, action: 'order_cancelled', targetType: 'order', targetId: row.id, detail: { refund: cancelResult.state !== 'refund_denied' } });
  const fresh = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?1').bind(row.id).first<OrderRow>();
  return c.json({ order: orderForOwner(fresh!) });
});

function safeJson(s: string): Record<string, unknown> {
  try { return JSON.parse(s); } catch { return {}; }
}
