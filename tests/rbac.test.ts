import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { json, makeContext, newClient, registerUser, setupAdmin, type TestContext, type ClientState } from './helpers';

let t: TestContext;
let adminClient: ClientState;
let adminId: string;
beforeAll(async () => {
  t = await makeContext();
  adminClient = newClient();
  const { res, body } = await setupAdmin(t, 'admin@verifynest.local', 'admin-strong-pass-123', adminClient);
  expect(res.status).toBe(201);
  adminId = body.user.id;
});
afterAll(async () => { await t.stop(); });

describe('role-based access control', () => {
  it('rejects unauthenticated access to customer and admin routes', async () => {
    expect((await t.fetch('/api/orders')).status).toBe(401);
    expect((await t.fetch('/api/wallet')).status).toBe(401);
    expect((await t.fetch('/api/admin/overview')).status).toBe(401);
    expect((await t.fetch('/api/admin/users')).status).toBe(401);
  });

  it('rejects customer access to every admin route (403)', async () => {
    const client = newClient();
    await registerUser(t, 'customer-rbac@example.com', 'correct-horse-battery', client);
    const adminPaths = [
      '/api/admin/overview', '/api/admin/users', '/api/admin/orders', '/api/admin/ledger',
      '/api/admin/tickets', '/api/admin/abuse-reports', '/api/admin/audit',
      '/api/admin/settings', '/api/admin/payments', '/api/admin/providers/diagnostics',
    ];
    for (const p of adminPaths) {
      const res = await t.fetch(p, { client });
      expect(res.status, `expected 403 for ${p}`).toBe(403);
    }
  });

  it('rejects customer attempts at privileged mutations', async () => {
    const client = newClient();
    const { body } = await registerUser(t, 'customer-mut@example.com', 'correct-horse-battery', client);
    const attempts: [string, string, object][] = [
      ['POST', '/api/admin/test-credit', { user_id: body.user.id, amount_cents: 100000 }],
      ['POST', '/api/admin/wallet-adjust', { user_id: body.user.id, amount_cents: 100000, wallet_kind: 'live', reason: 'self-pay' }],
      ['PUT', '/api/admin/settings', { operating_mode: 'live' }],
      ['POST', '/api/admin/providers/numberotp/enabled', { enabled: true }],
      ['POST', '/api/admin/prices', { provider_id: 'test', country_code: 'test-us', service_code: 'demo', provider_cost_cents: 0, markup_percent: 0 }],
    ];
    for (const [method, path, payload] of attempts) {
      const res = await t.fetch(path, { method, body: JSON.stringify(payload), client });
      expect(res.status, `expected 403 for ${method} ${path}`).toBe(403);
    }
  });

  it('public registration ignores any role/status field supplied by the client', async () => {
    const client = newClient();
    const res = await t.fetch('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'sneaky@example.com', password: 'correct-horse-battery', role: 'admin', status: 'active' }),
      client,
    });
    expect(res.status).toBe(201);
    const me = await json(await t.fetch('/api/auth/me', { client }));
    expect(me.user.role).toBe('customer');
  });

  it('suspended users lose access immediately', async () => {
    const client = newClient();
    const { body } = await registerUser(t, 'suspending@example.com', 'correct-horse-battery', client);

    const sus = await t.fetch(`/api/admin/users/${body.user.id}/status`, {
      method: 'POST', body: JSON.stringify({ status: 'suspended' }), client: adminClient,
    });
    expect(sus.status).toBe(200);

    const me = await json(await t.fetch('/api/auth/me', { client }));
    expect(me.user).toBeNull(); // session killed
    const login = await t.fetch('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ email: 'suspending@example.com', password: 'correct-horse-battery' }), client,
    });
    expect(login.status).toBe(403);
  });

  it('admin cannot suspend their own account', async () => {
    const res = await t.fetch(`/api/admin/users/${adminId}/status`, {
      method: 'POST', body: JSON.stringify({ status: 'suspended' }), client: adminClient,
    });
    expect(res.status).toBe(409);
  });
});
