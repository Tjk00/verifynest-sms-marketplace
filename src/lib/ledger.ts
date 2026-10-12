import type { D1Database } from '@cloudflare/workers-types';
import { randomHex } from './crypto';
import { badRequest, conflict } from './errors';

export type WalletKind = 'test' | 'live';
export type LedgerEntryType =
  | 'test_credit'
  | 'deposit_pending'
  | 'deposit_approved'
  | 'order_charge'
  | 'refund'
  | 'admin_adjustment';

export interface LedgerResult {
  entryId: string;
  balanceAfterCents: number;
}

/**
 * All balance changes go through here using an atomic D1 batch():
 *   1. Ensure the wallet account exists (test and live wallets are separate rows).
 *   2. Append the immutable ledger entry FIRST. The `ledger_balance_consistency`
 *      trigger aborts the whole batch unless the wallet's stored balance equals the
 *      entry's implied prior balance — this is what makes concurrent double-spending
 *      impossible even though interactive D1 transactions are not used.
 *   3. Update the wallet balance (CHECK balance_cents >= 0 blocks overspending).
 *   4. Duplicate idempotency keys hit the UNIQUE constraint and roll the batch back.
 * The ledger itself is append-only (ledger_no_update / ledger_no_delete triggers).
 */
export async function applyLedgerEntry(
  db: D1Database,
  opts: {
    userId: string;
    kind: WalletKind;
    entryType: LedgerEntryType;
    amountCents: number;
    orderId?: string | null;
    depositId?: string | null;
    reason?: string | null;
    createdBy?: string;
    idempotencyKey?: string | null;
  },
): Promise<LedgerResult> {
  const amount = opts.amountCents;
  if (!Number.isInteger(amount) || amount === 0) throw badRequest('Ledger amount must be a non-zero integer.');
  if (opts.kind === 'test' && opts.entryType === 'deposit_approved') {
    throw badRequest('Real deposits can never be credited to a TEST wallet.');
  }
  if (opts.kind === 'live' && opts.entryType === 'test_credit') {
    throw badRequest('TEST credits can never be credited to a live wallet.');
  }

  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT OR IGNORE INTO wallet_accounts (id, user_id, kind, balance_cents, created_at, updated_at)
       VALUES (?1, ?2, ?3, 0, ?4, ?4)`,
    )
    .bind(randomHex(12), opts.userId, opts.kind, now)
    .run();

  const wallet = await db
    .prepare('SELECT id, balance_cents FROM wallet_accounts WHERE user_id = ?1 AND kind = ?2')
    .bind(opts.userId, opts.kind)
    .first<{ id: string; balance_cents: number }>();
  if (!wallet) throw conflict('Wallet unavailable. Please retry.');

  const newBalance = wallet.balance_cents + amount;
  if (newBalance < 0) throw new AppInsufficientBalanceError(wallet.balance_cents);

  const entryId = randomHex(12);
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO ledger_entries
             (id, wallet_account_id, user_id, entry_type, amount_cents, balance_after_cents,
              order_id, deposit_id, reason, created_by, idempotency_key, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
        )
        .bind(
          entryId, wallet.id, opts.userId, opts.entryType, amount, newBalance,
          opts.orderId ?? null, opts.depositId ?? null, opts.reason ?? null,
          opts.createdBy ?? 'system', opts.idempotencyKey ?? null, now,
        ),
      db
        .prepare('UPDATE wallet_accounts SET balance_cents = balance_cents + ?1, updated_at = ?2 WHERE id = ?3')
        .bind(amount, now, wallet.id),
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('balance_mismatch')) {
      throw conflict('Balance changed concurrently. Please retry the operation.');
    }
    if (/UNIQUE constraint failed: ledger_entries\.idempotency_key/.test(msg)) {
      throw conflict('This ledger operation was already applied (duplicate idempotency key).');
    }
    throw e;
  }

  return { entryId, balanceAfterCents: newBalance };
}

export class AppInsufficientBalanceError extends Error {
  constructor(public currentBalanceCents: number) {
    super('Insufficient wallet balance for this purchase.');
    this.name = 'AppInsufficientBalanceError';
  }
}

export async function getWallets(db: D1Database, userId: string) {
  const { results } = await db
    .prepare('SELECT kind, balance_cents, updated_at FROM wallet_accounts WHERE user_id = ?1')
    .bind(userId)
    .all<{ kind: WalletKind; balance_cents: number; updated_at: string }>();
  const wallets: Record<WalletKind, { balanceCents: number; updatedAt: string } | null> = { test: null, live: null };
  for (const r of results ?? []) wallets[r.kind] = { balanceCents: r.balance_cents, updatedAt: r.updated_at };
  return wallets;
}
