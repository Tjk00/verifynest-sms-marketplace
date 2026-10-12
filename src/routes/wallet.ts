import { Hono } from 'hono';
import type { Env } from '../env';
import type { AppVars } from '../middleware/auth';
import { requireUser } from '../middleware/auth';
import { getWallets } from '../lib/ledger';
import { getSettings } from '../lib/settings';
import { conflict } from '../lib/errors';

export const walletRoutes = new Hono<{ Bindings: Env; Variables: AppVars }>();
walletRoutes.use('*', requireUser);

/** GET /api/wallet — balances (test and live shown separately and labelled). */
walletRoutes.get('/', async (c) => {
  const user = c.get('user')!;
  const wallets = await getWallets(c.env.DB, user.id);
  const settings = await getSettings(c.env.DB);
  return c.json({
    test: {
      balanceCents: wallets.test?.balanceCents ?? 0,
      label: 'TEST credits (simulator only — not real money, never withdrawable or transferable)',
      isTestData: true,
    },
    live: {
      balanceCents: wallets.live?.balanceCents ?? 0,
      label: 'Live wallet (USD)',
      isTestData: false,
      depositsEnabled: settings.deposits_enabled && settings.payment_provider !== null,
      depositsNotice: settings.deposits_enabled && settings.payment_provider !== null
        ? undefined
        : 'Live deposits are DISABLED: no payment provider is configured yet. You can still explore the full product in TEST MODE using TEST credits.',
    },
  });
});

/** GET /api/wallet/ledger — own immutable transaction history. */
walletRoutes.get('/ledger', async (c) => {
  const user = c.get('user')!;
  const { results } = await c.env.DB.prepare(
    `SELECT l.entry_type, l.amount_cents, l.balance_after_cents, l.reason, l.created_at, w.kind, l.order_id
       FROM ledger_entries l JOIN wallet_accounts w ON w.id = l.wallet_account_id
      WHERE l.user_id = ?1 ORDER BY l.created_at DESC LIMIT 200`,
  ).bind(user.id).all();
  return c.json({
    entries: (results ?? []).map((r: any) => ({
      entryType: r.entry_type,
      amountCents: r.amount_cents,
      balanceAfterCents: r.balance_after_cents,
      reason: r.reason,
      createdAt: r.created_at,
      walletKind: r.kind,
      orderId: r.order_id,
      isTestData: r.kind === 'test',
    })),
  });
});

/**
 * POST /api/wallet/deposits — modular deposit boundary.
 * Stays DISABLED until a payment provider is selected, credentials and verified
 * webhooks are configured, and an administrator turns deposits on. A screenshot or
 * browser redirect is never treated as proof of payment; crediting happens only
 * after server-side verification of a signed provider webhook/callback.
 */
walletRoutes.post('/deposits', async (c) => {
  const settings = await getSettings(c.env.DB);
  if (!settings.deposits_enabled || !settings.payment_provider) {
    throw conflict(
      'Live deposits are not enabled. No payment provider has been configured and verified. Until then, use TEST MODE — every new account receives TEST credits for the simulator. See docs/PAYMENTS.md for the activation checklist.',
      'deposits_disabled',
    );
  }
  // Reached only after an admin enables deposits AND a payment adapter is wired in.
  throw conflict('The configured payment provider integration is not complete yet.', 'deposits_not_implemented');
});

/** GET /api/wallet/orders-history — combined order + transaction view for the dashboard. */
walletRoutes.get('/orders-history', async (c) => {
  const user = c.get('user')!;
  const { results } = await c.env.DB.prepare(
    'SELECT id, status, mode, price_cents, service_code, country_code, created_at FROM orders WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 100',
  ).bind(user.id).all();
  return c.json({ orders: results ?? [] });
});
