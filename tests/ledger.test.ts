import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeContext, newClient, registerUser, type TestContext } from './helpers';

let t: TestContext;
const userId = 'ledger-user';
beforeAll(async () => {
  t = await makeContext();
  await t.lib('/insert-user', { id: userId });
});
afterAll(async () => { await t.stop(); });

async function wallets() {
  const body = await t.lib('/wallets', { userId });
  return body.wallets as { test: { balanceCents: number } | null; live: { balanceCents: number } | null };
}

describe('wallet ledger (executed inside workerd with atomic D1 batches)', () => {
  it('credits and debits compute the running balance correctly', async () => {
    const credit = await t.lib('/apply', { userId, kind: 'test', entryType: 'test_credit', amountCents: 250, reason: 'grant', idempotencyKey: 'ledger-1' });
    expect(credit.ok).toBe(true);
    expect(credit.balanceAfterCents).toBe(250);
    expect((await wallets()).test?.balanceCents).toBe(250);

    const debit = await t.lib('/apply', { userId, kind: 'test', entryType: 'order_charge', amountCents: -100, reason: 'order', idempotencyKey: 'ledger-2' });
    expect(debit.ok).toBe(true);
    expect(debit.balanceAfterCents).toBe(150);
    expect((await wallets()).test?.balanceCents).toBe(150);
  });

  it('keeps test and live wallets strictly separate', async () => {
    await t.lib('/apply', { userId, kind: 'live', entryType: 'admin_adjustment', amountCents: 100, reason: 'live entry', idempotencyKey: 'ledger-live-1' });
    const w = await wallets();
    expect(w.live?.balanceCents).toBe(100);
    expect(w.test?.balanceCents).toBe(150); // untouched
  });

  it('blocks overspending (balance can never go negative)', async () => {
    const res = await t.lib('/apply', { userId, kind: 'test', entryType: 'order_charge', amountCents: -999_999, reason: 'too big', idempotencyKey: 'ledger-3' });
    expect(res.ok).toBe(false);
    expect(res.name).toBe('AppInsufficientBalanceError');
    expect((await wallets()).test?.balanceCents).toBe(150); // unchanged
  });

  it('rejects duplicate ledger entries via the idempotency key', async () => {
    const first = await t.lib('/apply', { userId, kind: 'test', entryType: 'test_credit', amountCents: 100, reason: 'dupe', idempotencyKey: 'ledger-dup' });
    expect(first.ok).toBe(true);
    const second = await t.lib('/apply', { userId, kind: 'test', entryType: 'test_credit', amountCents: 100, reason: 'dupe', idempotencyKey: 'ledger-dup' });
    expect(second.ok).toBe(false); // UNIQUE constraint on idempotency_key
    expect((await wallets()).test?.balanceCents).toBe(250); // credited exactly once
  });

  it('the ledger table is append-only at the database level', async () => {
    const entry = await t.db.prepare('SELECT id FROM ledger_entries LIMIT 1').first();
    await expect(t.db.prepare('UPDATE ledger_entries SET amount_cents = 999999 WHERE id = ?1').bind((entry as any).id).run()).rejects.toThrow(/append-only/);
    await expect(t.db.prepare('DELETE FROM ledger_entries WHERE id = ?1').bind((entry as any).id).run()).rejects.toThrow(/append-only/);
  });

  it('rejects zero-amount and non-integer entries', async () => {
    const zero = await t.lib('/apply', { userId, kind: 'test', entryType: 'test_credit', amountCents: 0, reason: 'zero' });
    expect(zero.ok).toBe(false);
    const fraction = await t.lib('/apply', { userId, kind: 'test', entryType: 'test_credit', amountCents: 1.5, reason: 'fraction' });
    expect(fraction.ok).toBe(false);
  });

  it('customers cannot edit their own balance through any API', async () => {
    const client = newClient();
    await registerUser(t, 'noedit@example.com', 'correct-horse-battery', client);
    for (const path of ['/api/wallet/balance', '/api/wallet', '/api/wallet/ledger']) {
      const put = await t.fetch(path, { method: 'PUT', body: JSON.stringify({ balance_cents: 100000 }), client });
      expect([401, 404, 403, 405]).toContain(put.status);
    }
  });
});
