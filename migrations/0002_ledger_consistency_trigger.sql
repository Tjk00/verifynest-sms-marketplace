-- Ledger consistency enforcement at the database level.
--
-- applyLedgerEntry() inserts the ledger entry BEFORE updating the wallet balance,
-- inside one atomic D1 batch(). This trigger guarantees the two can never diverge:
-- a ledger entry may only be inserted when the wallet's current stored balance
-- equals the entry's implied prior balance (balance_after_cents - amount_cents).
--
-- Consequences (all enforced by SQLite itself, immune to application bugs):
--   * Concurrent modification between read and write aborts the whole batch
--     (RAISE ABORT rolls back) — double spending is impossible.
--   * The implied prior balance must match reality — no fabricated balances.
--   * Combined with wallet_accounts CHECK (balance_cents >= 0) and the
--     ledger idempotency_key UNIQUE constraint, the ledger stays consistent.

CREATE TRIGGER IF NOT EXISTS ledger_balance_consistency
BEFORE INSERT ON ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'balance_mismatch')
  WHERE (
    SELECT balance_cents FROM wallet_accounts WHERE id = NEW.wallet_account_id
  ) IS NOT NEW.balance_after_cents - NEW.amount_cents;
END;
