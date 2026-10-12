import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { json, makeContext, newClient, registerUser, type TestContext, type ClientState } from './helpers';

let t: TestContext;

async function userWithCredit(email: string, creditCents = 0): Promise<{ client: ClientState; id: string }> {
  const client = newClient();
  const { body } = await registerUser(t, email, 'correct-horse-battery', client);
  if (creditCents > 0) {
    // Top up TEST credits via the in-worker ledger harness (same code path admin grants use).
    const res = await t.lib('/apply', {
      userId: body.user.id, kind: 'test', entryType: 'test_credit', amountCents: creditCents,
      reason: 'test top-up', createdBy: 'test', idempotencyKey: `topup-${email}`,
    });
    expect(res.ok).toBe(true);
  }
  return { client, id: body.user.id };
}

async function createOrder(client: ClientState, countryCode = 'test-us', serviceCode = 'demo', key = `idem-${Math.random().toString(36).slice(2)}${Date.now()}`) {
  return t.fetch('/api/orders', {
    method: 'POST',
    body: JSON.stringify({ country_code: countryCode, service_code: serviceCode, idempotency_key: key }),
    client,
  });
}

beforeAll(async () => { t = await makeContext(); });
afterAll(async () => { await t.stop(); });

describe('catalogue', () => {
  it('lists only test-mode services with server-computed prices, labelled as TEST DATA', async () => {
    const body = await json(await t.fetch('/api/catalog'));
    expect(body.operatingMode).toBe('test');
    expect(body.services.length).toBeGreaterThan(0);
    for (const s of body.services) {
      expect(s.providerId).toBe('test');
      expect(s.isTestData).toBe(true);
    }
    const demo = body.prices.find((p: any) => p.serviceCode === 'demo' && p.countryCode === 'test-us');
    expect(demo.retailPriceCents).toBe(60); // 50 cost + 20% markup, computed server-side
  });

  it('does not list numberotp services (provider not connected)', async () => {
    const body = await json(await t.fetch('/api/catalog'));
    expect(body.services.some((s: any) => s.providerId === 'numberotp')).toBe(false);
    expect(body.countries.some((ct: any) => ct.providerId === 'numberotp')).toBe(false);
  });
});

describe('test-mode order flow', () => {
  it('creates an order, charges the TEST wallet, and labels everything TEST DATA', async () => {
    const { client } = await userWithCredit('order-basic@example.com', 1000);
    const res = await createOrder(client);
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.order.isTestData).toBe(true);
    expect(body.order.status).toBe('awaiting_sms');
    expect(body.order.phoneNumber).toMatch(/^\+999/); // fictional test number range
    expect(body.order.priceCents).toBe(60);

    const wallet = await json(await t.fetch('/api/wallet', { client }));
    expect(wallet.test.balanceCents).toBe(1000 + 500 - 60); // signup credit + top-up - price
    expect(wallet.test.isTestData).toBe(true);
  });

  it('delivers a simulated TEST code on the second status check for the demo service', async () => {
    const { client } = await userWithCredit('order-sms@example.com', 1000);
    const created = await json(await createOrder(client));
    const orderId = created.order.id;

    const check1 = await json(await t.fetch(`/api/orders/${orderId}/check`, { method: 'POST', client }));
    expect(check1.order.status).toBe('awaiting_sms');
    expect(check1.order.smsCode).toBeNull();

    const check2 = await json(await t.fetch(`/api/orders/${orderId}/check`, { method: 'POST', client }));
    expect(check2.order.status).toBe('completed');
    expect(check2.order.smsCode).toMatch(/^\d{6}$/);
  });

  it('the "fail" service refunds automatically and never fabricates a number', async () => {
    const { client } = await userWithCredit('order-fail@example.com', 1000);
    const res = await createOrder(client, 'test-us', 'fail');
    const body = await json(res);
    expect(['failed', 'refunded']).toContain(body.order.status);
    expect(body.order.phoneNumber).toBeNull();
    expect(body.order.smsCode ?? null).toBeNull();

    const wallet = await json(await t.fetch('/api/wallet', { client }));
    expect(wallet.test.balanceCents).toBe(1500); // 500 signup + 1000 top-up, charge refunded
    const ledger = await json(await t.fetch('/api/wallet/ledger', { client }));
    const types = ledger.entries.map((e: any) => e.entryType);
    expect(types).toContain('order_charge');
    expect(types).toContain('refund');
  });

  it('cancellation refunds the wallet when the provider approves it', async () => {
    const { client } = await userWithCredit('order-cancel@example.com', 1000);
    const created = await json(await createOrder(client));
    const res = await t.fetch(`/api/orders/${created.order.id}/cancel`, { method: 'POST', client });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.order.status).toBe('refunded');
    const wallet = await json(await t.fetch('/api/wallet', { client }));
    expect(wallet.test.balanceCents).toBe(1500);
  });

  it('completed orders cannot be cancelled', async () => {
    const { client } = await userWithCredit('order-cancel2@example.com', 1000);
    const created = await json(await createOrder(client));
    await t.fetch(`/api/orders/${created.order.id}/check`, { method: 'POST', client });
    await t.fetch(`/api/orders/${created.order.id}/check`, { method: 'POST', client });
    const res = await t.fetch(`/api/orders/${created.order.id}/cancel`, { method: 'POST', client });
    expect(res.status).toBe(409);
  });

  it('expired numbers are refunded when polled after TTL', async () => {
    const { client, id } = await userWithCredit('order-expire@example.com', 1000);
    const created = await json(await createOrder(client, 'test-us', 'slow'));
    // Simulate the TTL passing (operational action, not a client capability).
    await t.db.prepare("UPDATE orders SET expires_at = ?1 WHERE id = ?2")
      .bind(new Date(Date.now() - 1000).toISOString(), created.order.id).run();
    const check = await json(await t.fetch(`/api/orders/${created.order.id}/check`, { method: 'POST', client }));
    expect(check.order.status).toBe('refunded');
    const wallet = await json(await t.fetch('/api/wallet', { client }));
    expect(wallet.test.balanceCents).toBe(1500);
    expect(id).toBeTruthy();
  });

  it('rejects purchases with insufficient balance (402) and does not create a dangling charge', async () => {
    const client = newClient();
    await registerUser(t, 'order-poor@example.com', 'correct-horse-battery', client);
    // Burn the 500-cent signup credit by COMPLETING orders (completed = no refund)
    // until the balance drops below the 60-cent demo price.
    for (let i = 0; i < 12; i++) {
      const res = await createOrder(client, 'test-us', 'demo');
      if (res.status === 402) {
        const body = await json(res);
        expect(body.error.code).toBe('insufficient_balance');
        const wallet = await json(await t.fetch('/api/wallet', { client }));
        expect(wallet.test.balanceCents).toBeLessThan(60);
        expect(wallet.test.balanceCents).toBeGreaterThanOrEqual(0);
        const ledger = await json(await t.fetch('/api/wallet/ledger', { client }));
        const charges = ledger.entries.filter((e: any) => e.entryType === 'order_charge');
        const refunds = ledger.entries.filter((e: any) => e.entryType === 'refund');
        expect(charges.length - refunds.length).toBe(charges.length); // completed orders: no refunds
        return;
      }
      expect(res.status).toBe(201);
      // Drive the demo order to completion so the charge sticks and it stops counting as active.
      const created = await json(res);
      await t.fetch(`/api/orders/${created.order.id}/check`, { method: 'POST', client });
      await t.fetch(`/api/orders/${created.order.id}/check`, { method: 'POST', client });
    }
    throw new Error('expected a 402 within 12 attempts');
  });

  it('enforces the active-order purchase limit', async () => {
    const { client } = await userWithCredit('order-limit@example.com', 100000);
    let hitLimit = false;
    for (let i = 0; i < 7; i++) {
      const res = await createOrder(client, 'test-us', 'slow'); // slow orders stay awaiting_sms
      if (res.status === 409) {
        const body = await json(res);
        expect(body.error.code).toBe('conflict');
        expect(body.error.message).toMatch(/limit/i);
        hitLimit = true;
        break;
      }
      expect(res.status).toBe(201);
    }
    expect(hitLimit).toBe(true);
  });

  it('rejects orders for country/service pairs that are not offered', async () => {
    const { client } = await userWithCredit('order-unknown@example.com', 1000);
    const res = await createOrder(client, 'test-us', 'does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('idempotency & duplicate protection', () => {
  it('replays the same response for the same idempotency key and charges once', async () => {
    const { client } = await userWithCredit('order-idem@example.com', 1000);
    const key = 'fixed-idempotency-key-123456';
    const res1 = await createOrder(client, 'test-us', 'demo', key);
    const res2 = await createOrder(client, 'test-us', 'demo', key);
    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    expect(res2.headers.get('x-idempotent-replay')).toBe('true');
    const b1 = await json(res1);
    const b2 = await json(res2);
    expect(b1.order.id).toBe(b2.order.id);

    const ledger = await json(await t.fetch('/api/wallet/ledger', { client }));
    const charges = ledger.entries.filter((e: any) => e.entryType === 'order_charge');
    expect(charges).toHaveLength(1); // exactly one charge despite two requests
  });

  it('rejects key reuse with different parameters', async () => {
    const { client } = await userWithCredit('order-idem2@example.com', 1000);
    const key = 'reused-idempotency-key-999999';
    const res1 = await createOrder(client, 'test-us', 'demo', key);
    expect(res1.status).toBe(201);
    const res2 = await createOrder(client, 'test-uk', 'demo', key);
    expect(res2.status).toBe(409);
  });
});

describe('order ownership', () => {
  it('other users cannot view, poll, or cancel someone else\'s order (404, no existence leak)', async () => {
    const owner = await userWithCredit('owner@example.com', 1000);
    const intruder = await userWithCredit('intruder@example.com', 1000);
    const created = await json(await createOrder(owner.client));
    const id = created.order.id;

    expect((await t.fetch(`/api/orders/${id}`, { client: intruder.client })).status).toBe(404);
    expect((await t.fetch(`/api/orders/${id}/check`, { method: 'POST', client: intruder.client })).status).toBe(404);
    expect((await t.fetch(`/api/orders/${id}/cancel`, { method: 'POST', client: intruder.client })).status).toBe(404);

    const list = await json(await t.fetch('/api/orders', { client: intruder.client }));
    expect(list.orders.some((o: any) => o.id === id)).toBe(false);
  });

  it('the owner can see the SMS code but list view hides it for non-completed orders', async () => {
    const { client } = await userWithCredit('owner-sms@example.com', 1000);
    const created = await json(await createOrder(client, 'test-us', 'social-x'));
    const list1 = await json(await t.fetch('/api/orders', { client }));
    expect(list1.orders.find((o: any) => o.id === created.order.id).smsCode).toBeNull();
    await t.fetch(`/api/orders/${created.order.id}/check`, { method: 'POST', client });
    await t.fetch(`/api/orders/${created.order.id}/check`, { method: 'POST', client });
    const done = await json(await t.fetch(`/api/orders/${created.order.id}/check`, { method: 'POST', client }));
    expect(done.order.status).toBe('completed');
    expect(done.order.smsCode).toMatch(/^\d{6}$/);
  });
});
