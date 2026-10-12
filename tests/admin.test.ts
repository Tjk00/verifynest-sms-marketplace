import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { json, makeContext, newClient, registerUser, setupAdmin, type TestContext, type ClientState } from './helpers';

let t: TestContext;
let adminClient: ClientState;
beforeAll(async () => {
  t = await makeContext();
  adminClient = newClient();
  await setupAdmin(t, 'admin@verifynest.local', 'admin-strong-pass-123', adminClient);
});
afterAll(async () => { await t.stop(); });

async function orderCompleted(client: ClientState): Promise<string> {
  const key = `idem-${Math.random().toString(36).slice(2)}`;
  const created = await json(await t.fetch('/api/orders', {
    method: 'POST', body: JSON.stringify({ country_code: 'test-us', service_code: 'demo', idempotency_key: key }), client,
  }));
  await t.fetch(`/api/orders/${created.order.id}/check`, { method: 'POST', client });
  await t.fetch(`/api/orders/${created.order.id}/check`, { method: 'POST', client });
  return created.order.id;
}

describe('admin dashboard APIs', () => {
  it('overview reports system state with an honest margin disclaimer', async () => {
    const body = await json(await t.fetch('/api/admin/overview', { client: adminClient }));
    expect(body.settings.operatingMode).toBe('test');
    expect(body.settings.depositsEnabled).toBe(false);
    expect(body.marginNote).toMatch(/NOT guaranteed profit/);
    expect(typeof body.customers).toBe('number');
  });

  it('users list excludes password hashes', async () => {
    await registerUser(t, 'listed@example.com', 'correct-horse-battery');
    const body = await json(await t.fetch('/api/admin/users', { client: adminClient }));
    const dump = JSON.stringify(body.users);
    expect(dump).not.toContain('password_hash');
    expect(dump).toContain('listed@example.com');
  });

  it('admin orders list hides SMS codes (minimal data exposure)', async () => {
    const client = newClient();
    await registerUser(t, 'order-admin@example.com', 'correct-horse-battery', client);
    await orderCompleted(client);
    const body = await json(await t.fetch('/api/admin/orders', { client: adminClient }));
    expect(body.orders.length).toBeGreaterThan(0);
    for (const o of body.orders) expect(o.smsCode).toBeUndefined();
  });

  it('grants TEST credit with audit trail', async () => {
    const client = newClient();
    const { body: reg } = await registerUser(t, 'credited@example.com', 'correct-horse-battery', client);
    const res = await t.fetch('/api/admin/test-credit', {
      method: 'POST', body: JSON.stringify({ user_id: reg.user.id, amount_cents: 1234 }), client: adminClient,
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.isTestData).toBe(true);
    expect(body.balanceAfterCents).toBe(500 + 1234);

    const wallet = await json(await t.fetch('/api/wallet', { client }));
    expect(wallet.test.balanceCents).toBe(1734);
    expect(wallet.live.balanceCents).toBe(0); // live wallet untouched

    const audit = await json(await t.fetch('/api/admin/audit', { client: adminClient }));
    expect(audit.events.some((e: any) => e.action === 'test_credit_granted')).toBe(true);
  });

  it('wallet adjustments require a reason', async () => {
    const client = newClient();
    const { body: reg } = await registerUser(t, 'adjust@example.com', 'correct-horse-battery', client);
    const noReason = await t.fetch('/api/admin/wallet-adjust', {
      method: 'POST', body: JSON.stringify({ user_id: reg.user.id, wallet_kind: 'live', amount_cents: 100 }), client: adminClient,
    });
    expect(noReason.status).toBe(400);
    const shortReason = await t.fetch('/api/admin/wallet-adjust', {
      method: 'POST', body: JSON.stringify({ user_id: reg.user.id, wallet_kind: 'live', amount_cents: 100, reason: 'x' }), client: adminClient,
    });
    expect(shortReason.status).toBe(400);
    const ok = await t.fetch('/api/admin/wallet-adjust', {
      method: 'POST',
      body: JSON.stringify({ user_id: reg.user.id, wallet_kind: 'live', amount_cents: 100, reason: 'Goodwill credit for support ticket #1' }),
      client: adminClient,
    });
    expect(ok.status).toBe(200);
    const ledger = await json(await t.fetch('/api/admin/ledger', { client: adminClient }));
    const entry = ledger.entries.find((e: any) => e.user_id === reg.user.id && e.entry_type === 'admin_adjustment');
    expect(entry.reason).toMatch(/Goodwill/);
  });

  it('issues a manual refund for a completed order and blocks double refunds', async () => {
    const client = newClient();
    await registerUser(t, 'refunded@example.com', 'correct-horse-battery', client);
    const orderId = await orderCompleted(client);
    const before = await json(await t.fetch('/api/wallet', { client }));

    const res = await t.fetch('/api/admin/refunds', {
      method: 'POST', body: JSON.stringify({ order_id: orderId, reason: 'Customer reported platform rejection' }), client: adminClient,
    });
    expect(res.status).toBe(200);
    const after = await json(await t.fetch('/api/wallet', { client }));
    expect(after.test.balanceCents).toBe(before.test.balanceCents + 60);

    const again = await t.fetch('/api/admin/refunds', {
      method: 'POST', body: JSON.stringify({ order_id: orderId, reason: 'Second refund attempt should fail' }), client: adminClient,
    });
    expect(again.status).toBe(409);
  });

  it('updates pricing and the customer catalogue reflects the new server-side price', async () => {
    const res = await t.fetch('/api/admin/prices', {
      method: 'POST',
      body: JSON.stringify({ provider_id: 'test', country_code: 'test-us', service_code: 'demo', provider_cost_cents: 100, markup_percent: 50 }),
      client: adminClient,
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.retailPriceCents).toBe(150);

    const catalog = await json(await t.fetch('/api/catalog'));
    const demo = catalog.prices.find((p: any) => p.serviceCode === 'demo' && p.countryCode === 'test-us');
    expect(demo.retailPriceCents).toBe(150);
  });

  it('logs operating-mode changes and provider toggles to the audit trail', async () => {
    const disable = await t.fetch('/api/admin/providers/test/enabled', {
      method: 'POST', body: JSON.stringify({ enabled: false }), client: adminClient,
    });
    expect(disable.status).toBe(200);
    const enable = await t.fetch('/api/admin/providers/test/enabled', {
      method: 'POST', body: JSON.stringify({ enabled: true }), client: adminClient,
    });
    expect(enable.status).toBe(200);
    const audit = await json(await t.fetch('/api/admin/audit', { client: adminClient }));
    const actions = audit.events.map((e: any) => e.action);
    expect(actions).toContain('provider_disabled');
    expect(actions).toContain('provider_enabled');
  });

  it('support email stays hidden from the public until marked verified', async () => {
    let status = await json(await t.fetch('/api/catalog/status'));
    expect(status.settings.supportEmail).toBeNull();
    expect(status.settings.supportEmailConfigured).toBe(false);

    await t.fetch('/api/admin/settings', {
      method: 'PUT', body: JSON.stringify({ support_email: { address: 'verifynest.support@gmail.com', verified: true } }), client: adminClient,
    });
    status = await json(await t.fetch('/api/catalog/status'));
    expect(status.settings.supportEmail).toBe('verifynest.support@gmail.com');
  });

  it('payments endpoint returns the activation checklist while live deposits are off', async () => {
    const body = await json(await t.fetch('/api/admin/payments', { client: adminClient }));
    expect(body.depositsEnabled).toBe(false);
    expect(body.paymentProvider).toBeNull();
    expect(body.activationChecklist.length).toBeGreaterThan(3);
  });
});

describe('support tickets & abuse reports', () => {
  it('customer opens a ticket, admin replies, customer sees the reply', async () => {
    const client = newClient();
    const { body: reg } = await registerUser(t, 'ticketed@example.com', 'correct-horse-battery', client);
    expect(reg.user.id).toBeTruthy();

    const created = await t.fetch('/api/support/tickets', {
      method: 'POST', body: JSON.stringify({ subject: 'Order question', message: 'Where is my test code? This is TEST MODE.' }), client,
    });
    expect(created.status).toBe(201);
    const { ticket } = await json(created);

    const adminList = await json(await t.fetch('/api/admin/tickets', { client: adminClient }));
    expect(adminList.tickets.some((x: any) => x.id === ticket.id)).toBe(true);

    const reply = await t.fetch(`/api/admin/tickets/${ticket.id}/reply`, {
      method: 'POST', body: JSON.stringify({ message: 'Your TEST code arrives on the second status check.' }), client: adminClient,
    });
    expect(reply.status).toBe(200);

    const detail = await json(await t.fetch(`/api/support/tickets/${ticket.id}`, { client }));
    expect(detail.ticket.status).toBe('answered');
    expect(detail.messages.length).toBe(2);
    expect(detail.messages[1].author_role).toBe('admin');

    // Other customers cannot read this ticket.
    const other = newClient();
    await registerUser(t, 'other-ticket@example.com', 'correct-horse-battery', other);
    expect((await t.fetch(`/api/support/tickets/${ticket.id}`, { client: other })).status).toBe(404);
  });

  it('customer files an abuse report, admin handles it', async () => {
    const client = newClient();
    await registerUser(t, 'reporter@example.com', 'correct-horse-battery', client);
    const res = await t.fetch('/api/support/abuse-report', {
      method: 'POST', body: JSON.stringify({ category: 'spam', details: 'User appears to be creating bulk accounts for spam purposes.' }), client,
    });
    expect(res.status).toBe(201);
    const { reportId } = await json(res);

    const list = await json(await t.fetch('/api/admin/abuse-reports', { client: adminClient }));
    expect(list.reports.some((r: any) => r.id === reportId)).toBe(true);

    const handled = await t.fetch(`/api/admin/abuse-reports/${reportId}/handle`, {
      method: 'POST', body: JSON.stringify({ status: 'reviewed' }), client: adminClient,
    });
    expect(handled.status).toBe(200);
  });

  it('ticket referencing another user\'s order is rejected', async () => {
    const owner = newClient();
    await registerUser(t, 'ticket-owner@example.com', 'correct-horse-battery', owner);
    const orderId = await orderCompleted(owner);
    const intruder = newClient();
    await registerUser(t, 'ticket-intruder@example.com', 'correct-horse-battery', intruder);
    const res = await t.fetch('/api/support/tickets', {
      method: 'POST', body: JSON.stringify({ subject: 'Snooping', message: 'Referencing someone else order', order_id: orderId }), client: intruder,
    });
    expect(res.status).toBe(404);
  });
});
