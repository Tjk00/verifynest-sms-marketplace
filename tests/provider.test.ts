import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { json, makeContext, newClient, setupAdmin, type TestContext, type ClientState } from './helpers';
import { NumberOtpAdapter } from '../src/providers/numberotp';
import { TestProviderAdapter } from '../src/providers/test';
import { UnsupportedOperationError } from '../src/providers/types';

let t: TestContext;
let adminClient: ClientState;
beforeAll(async () => {
  t = await makeContext();
  adminClient = newClient();
  await setupAdmin(t, 'admin@verifynest.local', 'admin-strong-pass-123', adminClient);
});
afterAll(async () => { await t.stop(); });

describe('NumberOTP adapter (unconfigured skeleton)', () => {
  const adapter = new NumberOtpAdapter();
  const ctx = () => ({ db: t.db, env: { DB: t.db } as any });

  it('reports honest diagnostics: disabled, no credentials, no verified endpoints', async () => {
    const d = await adapter.diagnostics(ctx());
    expect(d.enabled).toBe(false);
    expect(d.credentialsConfigured).toBe(false); // no secret set in this env
    expect(d.endpointsVerified).toBe(false);
    expect(d.resellerApprovalConfirmed).toBe(false);
    expect(d.supportedOperations).toHaveLength(0);
    expect(d.unsupportedOperations.length).toBeGreaterThan(0);
  });

  it('every operation reports unsupported instead of fabricating success', async () => {
    await expect(adapter.listCountries(ctx())).rejects.toBeInstanceOf(UnsupportedOperationError);
    await expect(adapter.listServices(ctx())).rejects.toBeInstanceOf(UnsupportedOperationError);
    await expect(adapter.listPrices(ctx())).rejects.toBeInstanceOf(UnsupportedOperationError);
    await expect(adapter.requestNumber(ctx(), { countryCode: 'x', serviceCode: 'y' })).rejects.toBeInstanceOf(UnsupportedOperationError);
    await expect(adapter.checkSms(ctx(), { providerOrderRef: 'x', phoneNumber: 'y', countryCode: 'c', serviceCode: 's', providerState: {}, orderCreatedAt: '' })).rejects.toBeInstanceOf(UnsupportedOperationError);
    await expect(adapter.cancelOrder(ctx(), { providerOrderRef: 'x', phoneNumber: 'y' })).rejects.toBeInstanceOf(UnsupportedOperationError);
    await expect(adapter.parseWebhook(ctx(), '{}', {})).rejects.toBeInstanceOf(UnsupportedOperationError);
  });

  it('admin cannot switch the platform to live mode without a verified provider', async () => {
    const res = await t.fetch('/api/admin/settings', {
      method: 'PUT', body: JSON.stringify({ operating_mode: 'live' }), client: adminClient,
    });
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.error.code).toBe('live_blocked');
    const settings = await json(await t.fetch('/api/admin/settings', { client: adminClient }));
    expect(settings.settings.operating_mode).toBe('test'); // unchanged
  });

  it('admin cannot enable deposits before a payment provider exists', async () => {
    const res = await t.fetch('/api/admin/settings', {
      method: 'PUT', body: JSON.stringify({ deposits_enabled: true }), client: adminClient,
    });
    expect(res.status).toBe(409);
    expect((await json(res)).error.code).toBe('deposits_blocked');
  });

  it('customer deposit attempts are refused with an honest explanation', async () => {
    const client = newClient();
    const { registerUser } = await import('./helpers');
    await registerUser(t, 'depositor@example.com', 'correct-horse-battery', client);
    const res = await t.fetch('/api/wallet/deposits', { method: 'POST', body: JSON.stringify({ amount_cents: 5000 }), client });
    expect(res.status).toBe(409);
    expect((await json(res)).error.code).toBe('deposits_disabled');
  });

  it('unknown provider webhooks 404 and known-but-unsupported webhooks are rejected, never faked', async () => {
    const unknown = await t.fetch('/api/webhooks/doesnotexist', { method: 'POST', body: '{}' });
    expect(unknown.status).toBe(404);
    const testWh = await t.fetch('/api/webhooks/test', { method: 'POST', body: '{"event":"code"}' });
    expect(testWh.status).toBe(404); // simulator does not accept webhooks
    const body = await json(testWh);
    expect(body.error.code).toBe('webhook_unsupported');
  });
});

describe('Test simulator adapter', () => {
  const adapter = new TestProviderAdapter();
  const ctx = () => ({ db: t.db, env: { DB: t.db } as any });

  it('is explicitly labelled as producing TEST DATA', async () => {
    const d = await adapter.diagnostics(ctx());
    expect(d.mode).toBe('test');
    expect(d.notes.join(' ')).toMatch(/TEST DATA/i);
  });

  it('provisions fictional numbers only in the reserved +999/+998 test ranges', async () => {
    for (const country of ['test-us', 'test-uk']) {
      const r = await adapter.requestNumber(ctx(), { countryCode: country, serviceCode: 'demo' });
      expect(r.state).toBe('provisioned');
      expect(r.phoneNumber).toMatch(/^\+99[89]555\d{4}$/);
      expect(r.providerOrderRef).toMatch(/^TEST-/);
    }
  });

  it('simulates failures for the fail service', async () => {
    const r = await adapter.requestNumber(ctx(), { countryCode: 'test-us', serviceCode: 'fail' });
    expect(r.state).toBe('failed');
    expect(r.failureReason).toMatch(/TEST SIMULATION/);
  });

  it('handles malformed provider state gracefully', async () => {
    const r = await adapter.checkSms(ctx(), {
      providerOrderRef: 'TEST-ABC', phoneNumber: '+9995550000', countryCode: 'test-us',
      serviceCode: 'demo', providerState: { polls: 'not-a-number' }, orderCreatedAt: new Date().toISOString(),
    });
    // 'not-a-number' → Number(...) NaN → polls NaN >= 2 is false → awaiting, never crashes
    expect(['awaiting', 'received']).toContain(r.state);
  });
});
