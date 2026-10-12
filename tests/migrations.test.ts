import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeContext, splitSql, type TestContext } from './helpers';

let t: TestContext;
beforeAll(async () => { t = await makeContext(); });
afterAll(async () => { await t.stop(); });

describe('database migrations', () => {
  it('creates all core tables', async () => {
    const { results } = await t.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const tables = (results as any[]).map((r) => r.name);
    for (const expected of [
      'users', 'sessions', 'providers', 'countries', 'services', 'service_prices',
      'orders', 'wallet_accounts', 'ledger_entries', 'deposits', 'refunds',
      'support_tickets', 'ticket_messages', 'abuse_reports', 'audit_events',
      'settings', 'idempotency_records', 'webhook_events', 'rate_limits',
    ]) {
      expect(tables, `missing table ${expected}`).toContain(expected);
    }
  });

  it('creates append-only triggers on the ledger', async () => {
    const { results } = await t.db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all();
    const triggers = (results as any[]).map((r) => r.name);
    expect(triggers).toContain('ledger_no_update');
    expect(triggers).toContain('ledger_no_delete');
    expect(triggers).toContain('ledger_balance_consistency');
  });

  it('seeds test provider, catalog and settings', async () => {
    const providers = await t.db.prepare('SELECT id, enabled FROM providers').all();
    const test = (providers.results as any[]).find((p) => p.id === 'test');
    const numberotp = (providers.results as any[]).find((p) => p.id === 'numberotp');
    expect(test?.enabled).toBe(1);
    expect(numberotp?.enabled).toBe(0); // NumberOTP must start DISABLED

    const mode = await t.db.prepare("SELECT value_json FROM settings WHERE key = 'operating_mode'").first();
    expect(JSON.parse((mode as any).value_json)).toBe('test');

    const prices = await t.db.prepare("SELECT COUNT(*) AS n FROM service_prices WHERE provider_id = 'test'").first();
    expect((prices as any).n).toBeGreaterThan(0);
  });

  it('SQL splitter handles trigger blocks correctly', () => {
    const stmts = splitSql('CREATE TRIGGER x BEFORE UPDATE ON t BEGIN SELECT RAISE(ABORT, \'no\'); END;\nINSERT INTO t VALUES (1);');
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toContain('END;');
  });

  it('health endpoint responds without a database user', async () => {
    const res = await t.fetch('/api/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect((body as any).ok).toBe(true);
  });
});
