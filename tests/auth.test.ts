import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { json, loginUser, makeContext, newClient, registerUser, setupAdmin, BOOTSTRAP_TOKEN, type TestContext } from './helpers';

let t: TestContext;
beforeAll(async () => { t = await makeContext(); });
afterAll(async () => { await t.stop(); });

describe('registration & login', () => {
  it('registers a customer and returns a session cookie', async () => {
    const { res, client, body } = await registerUser(t, 'alice@example.com');
    expect(res.status).toBe(201);
    expect(body.user.email).toBe('alice@example.com');
    expect(body.user.role).toBe('customer'); // public registration can never create admins
    expect(client.cookies.has('vn_session')).toBe(true);
  });

  it('gives new accounts a TEST wallet credit and zero live balance', async () => {
    const client = newClient();
    await registerUser(t, 'walleted@example.com', 'correct-horse-battery', client);
    const me = await json(await t.fetch('/api/auth/me', { client }));
    const test = me.wallets.find((w: any) => w.kind === 'test');
    const live = me.wallets.find((w: any) => w.kind === 'live');
    expect(test?.balance_cents).toBe(500);
    expect((live?.balance_cents ?? 0)).toBe(0);
  });

  it('rejects duplicate email registration', async () => {
    await registerUser(t, 'dupe@example.com');
    const { res } = await registerUser(t, 'dupe@example.com');
    expect(res.status).toBe(409);
  });

  it('rejects weak passwords and invalid emails', async () => {
    expect((await registerUser(t, 'bob@example.com', 'short')).res.status).toBe(400);
    expect((await registerUser(t, 'not-an-email', 'correct-horse-battery')).res.status).toBe(400);
  });

  it('logs in with correct credentials and rejects wrong ones', async () => {
    await registerUser(t, 'carol@example.com', 'correct-horse-battery');
    const ok = await loginUser(t, 'carol@example.com', 'correct-horse-battery');
    expect(ok.res.status).toBe(200);
    const bad = await loginUser(t, 'carol@example.com', 'wrong-password-entirely');
    expect(bad.res.status).toBe(401);
    const missing = await loginUser(t, 'nobody@example.com', 'whatever-password');
    expect(missing.res.status).toBe(401);
  });

  it('rate-limits repeated logins from one IP', async () => {
    const client = newClient();
    await registerUser(t, 'rl@example.com', 'correct-horse-battery', client);
    let limited = false;
    for (let i = 0; i < 15; i++) {
      const res = await t.fetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'rl@example.com', password: 'wrong-password-entirely' }),
        client,
      });
      if (res.status === 429) { limited = true; break; }
    }
    expect(limited).toBe(true);
  });

  it('logout invalidates the session', async () => {
    const client = newClient();
    await registerUser(t, 'dave@example.com', 'correct-horse-battery', client);
    const meBefore = await t.fetch('/api/auth/me', { client });
    expect((await json(meBefore)).user).not.toBeNull();
    const out = await t.fetch('/api/auth/logout', { method: 'POST', client });
    expect(out.status).toBe(200);
    const meAfter = await json(await t.fetch('/api/auth/me', { client }));
    expect(meAfter.user).toBeNull();
  });

  it('does not expose password hashes or session token hashes in /me', async () => {
    const client = newClient();
    await registerUser(t, 'erin@example.com', 'correct-horse-battery', client);
    const res = await t.fetch('/api/auth/me', { client });
    const text = await res.text();
    expect(text).not.toContain('pbkdf2$');
    expect(text).not.toContain('password');
  });
});

describe('first-admin setup', () => {
  it('rejects setup with a wrong bootstrap token', async () => {
    const res = await t.fetch('/api/auth/setup-admin', {
      method: 'POST',
      body: JSON.stringify({ email: 'evil@example.com', password: 'evil-strong-pass-1', bootstrap_token: 'wrong-token-value-000000' }),
    });
    expect(res.status).toBe(401);
  });

  it('creates the first admin with the correct bootstrap token', async () => {
    const { res, body } = await setupAdmin(t);
    expect(res.status).toBe(201);
    expect(body.user.role).toBe('admin');
  });

  it('refuses a second admin setup', async () => {
    const res = await t.fetch('/api/auth/setup-admin', {
      method: 'POST',
      body: JSON.stringify({ email: 'second@example.com', password: 'second-strong-pass', bootstrap_token: BOOTSTRAP_TOKEN }),
    });
    expect(res.status).toBe(403);
  });

  it('bootstrap-status reports no setup needed afterwards, without leaking the token', async () => {
    const res = await t.fetch('/api/auth/bootstrap-status');
    const body = await json(res);
    expect(body.needsAdminSetup).toBe(false);
    expect(JSON.stringify(body)).not.toContain(BOOTSTRAP_TOKEN);
  });
});
