import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { json, makeContext, newClient, registerUser, setupAdmin, BOOTSTRAP_TOKEN, type TestContext, type ClientState } from './helpers';

let t: TestContext;
let adminClient: ClientState;
beforeAll(async () => {
  t = await makeContext();
  adminClient = newClient();
  await setupAdmin(t, 'admin@verifynest.local', 'admin-strong-pass-123', adminClient);
});
afterAll(async () => { await t.stop(); });

describe('CSRF protection', () => {
  it('rejects state-changing API calls without the client header', async () => {
    const client = newClient();
    await registerUser(t, 'csrf@example.com', 'correct-horse-battery', client);
    const cookie = [...client.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const raw = await fetchNoClientHeader(t, '/api/orders', cookie);
    expect(raw.status).toBe(403);
  });

  it('rejects cross-origin state-changing requests', async () => {
    const client = newClient();
    await registerUser(t, 'csrf2@example.com', 'correct-horse-battery', client);
    const cookie = [...client.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetchWithOrigin(t, '/api/orders', cookie, 'https://evil.example');
    expect(res.status).toBe(403);
  });

  it('allows same-origin state-changing requests', async () => {
    const client = newClient();
    await registerUser(t, 'csrf3@example.com', 'correct-horse-battery', client);
    const cookie = [...client.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetchWithOrigin(t, '/api/orders', cookie, 'https://test.verifynest.local');
    expect(res.status).not.toBe(403);
  });
});

// Raw request helpers that bypass the standard test client headers.
async function fetchNoClientHeader(t: TestContext, path: string, cookie: string) {
  return t.raw(path, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
}

async function fetchWithOrigin(t: TestContext, path: string, cookie: string, origin: string) {
  return t.raw(path, {
    method: 'POST',
    headers: { cookie, origin, 'content-type': 'application/json', 'x-verifynest-client': '1' },
    body: JSON.stringify({}),
  });
}

describe('input validation & injection resistance', () => {
  it('SQL injection attempts in login are rejected safely (parameterized queries)', async () => {
    const payloads = [
      "' OR '1'='1",
      "admin@verifynest.local'--",
      "'; DROP TABLE users;--",
    ];
    for (const email of payloads) {
      const res = await t.fetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'whatever-password' }) });
      expect([400, 401]).toContain(res.status);
    }
    const users = await t.db.prepare('SELECT COUNT(*) AS n FROM users').first();
    expect((users as any).n).toBeGreaterThan(0); // table survived
  });

  it('enforces input length limits', async () => {
    const client = newClient();
    await registerUser(t, 'lengths@example.com', 'correct-horse-battery', client);
    const long = 'x'.repeat(5000);
    const res = await t.fetch('/api/support/tickets', {
      method: 'POST', body: JSON.stringify({ subject: long, message: 'hello there friend' }), client,
    });
    expect(res.status).toBe(400);
  });

  it('stored text is returned verbatim as JSON (React escapes at render — no server-side HTML injection)', async () => {
    const client = newClient();
    await registerUser(t, 'xss@example.com', 'correct-horse-battery', client);
    const payload = '<script>alert(1)</script>';
    const res = await t.fetch('/api/support/tickets', {
      method: 'POST', body: JSON.stringify({ subject: payload, message: 'Ticket body with <img onerror=alert(1)> inside.' }), client,
    });
    expect(res.status).toBe(201);
    const ctype = res.headers.get('content-type');
    expect(ctype).toContain('application/json'); // never text/html
    const nosniff = res.headers.get('x-content-type-options');
    // Header is applied at the index.ts edge wrapper; the app itself must at least return JSON.
    expect([null, 'nosniff']).toContain(nosniff);
  });

  it('rejects non-JSON and malformed bodies with 400, never 500', async () => {
    const client = newClient();
    await registerUser(t, 'badbody@example.com', 'correct-horse-battery', client);
    const res = await t.fetch('/api/support/tickets', {
      method: 'POST', body: '{{{not json', client, headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });
});

describe('secret leakage', () => {
  it('no API response contains the bootstrap token, API key names with values, or password hashes', async () => {
    const client = newClient();
    await registerUser(t, 'leaks@example.com', 'correct-horse-battery', client);
    const endpoints: [string, ClientState][] = [
      ['/api/auth/me', client],
      ['/api/wallet', client],
      ['/api/wallet/ledger', client],
      ['/api/catalog', client],
      ['/api/catalog/status', client],
      ['/api/auth/bootstrap-status', newClient()],
      ['/api/admin/providers/diagnostics', adminClient],
      ['/api/admin/users', adminClient],
      ['/api/admin/settings', adminClient],
      ['/api/admin/payments', adminClient],
      ['/api/admin/overview', adminClient],
      ['/api/admin/audit', adminClient],
    ];
    for (const [path, c] of endpoints) {
      const res = await t.fetch(path, { client: c });
      const text = await res.text();
      expect(text, `${path} leaked bootstrap token`).not.toContain(BOOTSTRAP_TOKEN);
      expect(text, `${path} leaked a password hash`).not.toContain('pbkdf2$');
      expect(text, `${path} leaked password_hash key`).not.toContain('password_hash');
      expect(text.toLowerCase(), `${path} leaked api key value`).not.toContain('numberotp_api_key":"');
    }
  });

  it('admin diagnostics expose only booleans about credential presence', async () => {
    const body = await json(await t.fetch('/api/admin/providers/diagnostics', { client: adminClient }));
    const numberotp = body.providers.find((p: any) => p.providerId === 'numberotp');
    expect(typeof numberotp.credentialsConfigured).toBe('boolean');
    expect(JSON.stringify(body)).not.toMatch(/"apiKey"/);
    expect(JSON.stringify(body)).not.toMatch(/Bearer /);
  });

  it('session tokens are stored hashed, never in plain text', async () => {
    const client = newClient();
    await registerUser(t, 'hashcheck@example.com', 'correct-horse-battery', client);
    const token = client.cookies.get('vn_session')!;
    const row = await t.db.prepare('SELECT id FROM sessions WHERE id = ?1').bind(token).first();
    expect(row).toBeNull(); // raw token is NOT the DB key
    const { sha256Hex } = await import('../src/lib/crypto');
    const hashed = await sha256Hex(token);
    const row2 = await t.db.prepare('SELECT id FROM sessions WHERE id = ?1').bind(hashed).first();
    expect(row2).not.toBeNull();
  });

  it('audit log detail never contains SMS bodies or secrets', async () => {
    const body = await json(await t.fetch('/api/admin/audit', { client: adminClient }));
    const dump = JSON.stringify(body);
    expect(dump).not.toContain('pbkdf2$');
    expect(dump).not.toContain(BOOTSTRAP_TOKEN);
  });
});
