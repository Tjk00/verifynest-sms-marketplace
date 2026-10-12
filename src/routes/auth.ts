import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Env, SessionUser } from '../env';
import type { AppVars } from '../middleware/auth';
import { SESSION_COOKIE, requireUser } from '../middleware/auth';
import { badRequest, conflict, forbidden, unauthorized } from '../lib/errors';
import { hashPassword, randomHex, sha256Hex, verifyPassword, timingSafeEqualHex } from '../lib/crypto';
import { requireBody, requireEmail, requirePassword } from '../lib/validation';
import { checkRateLimit } from '../lib/ratelimit';
import { logAudit } from '../lib/audit';
import { applyLedgerEntry } from '../lib/ledger';
import { getSettings } from '../lib/settings';

export const authRoutes = new Hono<{ Bindings: Env; Variables: AppVars }>();

function clientIp(c: { req: Request & { raw: Request } } | any): string {
  try {
    return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function sessionCookieOpts(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: 'Lax' as const,
    path: '/',
    maxAge: 60 * 60 * 12, // 12 hours
  };
}

async function createSession(c: any, user: SessionUser): Promise<string> {
  const token = randomHex(32);
  const hashed = await sha256Hex(token);
  const now = new Date();
  const expires = new Date(now.getTime() + 12 * 3600_000);
  await c.env.DB.prepare(
    'INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, user_agent) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
  )
    .bind(hashed, user.id, now.toISOString(), expires.toISOString(), now.toISOString(), (c.req.header('user-agent') ?? '').slice(0, 200))
    .run();
  setCookie(c, SESSION_COOKIE, token, sessionCookieOpts(new URL(c.req.url).protocol === 'https:'));
  return token;
}

/** GET /api/auth/bootstrap-status — is first-admin setup available? (no secrets revealed) */
authRoutes.get('/bootstrap-status', async (c) => {
  const row = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first<{ n: number }>();
  const tokenConfigured = typeof c.env.ADMIN_BOOTSTRAP_TOKEN === 'string' && c.env.ADMIN_BOOTSTRAP_TOKEN.length >= 16;
  return c.json({
    needsAdminSetup: (row?.n ?? 0) === 0,
    bootstrapTokenConfigured: tokenConfigured,
  });
});

/**
 * POST /api/auth/setup-admin — creates the FIRST administrator.
 * Requires the ADMIN_BOOTSTRAP_TOKEN secret (exact match). Refuses if any admin exists.
 * There is no default password and no public registration path to admin.
 */
authRoutes.post('/setup-admin', async (c) => {
  const ip = clientIp(c);
  await checkRateLimit(c.env.DB, `setup-admin:${ip}`, 5, 900);
  const existing = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first<{ n: number }>();
  if ((existing?.n ?? 0) > 0) throw forbidden('An administrator already exists. Setup is closed.');
  const token = c.env.ADMIN_BOOTSTRAP_TOKEN;
  if (typeof token !== 'string' || token.length < 16) {
    throw forbidden('Administrator setup is not available. Set the ADMIN_BOOTSTRAP_TOKEN secret (at least 16 characters) with `wrangler secret put ADMIN_BOOTSTRAP_TOKEN`, then retry.');
  }
  const body = requireBody(await c.req.json().catch(() => null));
  const supplied = body.bootstrap_token;
  if (typeof supplied !== 'string' || !timingSafeEqualHex(await sha256Hex(supplied), await sha256Hex(token))) {
    await logAudit(c.env.DB, { actorRole: 'anonymous', action: 'admin_setup_failed', ip, detail: { reason: 'bad_token' } });
    throw unauthorized('Invalid bootstrap token.');
  }
  const email = requireEmail(body.email);
  const password = requirePassword(body.password);
  const id = randomHex(12);
  const now = new Date().toISOString();
  const hash = await hashPassword(password);
  try {
    await c.env.DB.prepare(
      "INSERT INTO users (id, email, password_hash, role, status, created_at, updated_at) VALUES (?1, ?2, ?3, 'admin', 'active', ?4, ?4)",
    )
      .bind(id, email, hash, now)
      .run();
  } catch {
    throw conflict('That email is already registered.');
  }
  const user: SessionUser = { id, email, role: 'admin', status: 'active' };
  await applyLedgerSetupWallets(c, id);
  await createSession(c, user);
  await logAudit(c.env.DB, { actorId: id, actorRole: 'admin', action: 'admin_setup_completed', targetType: 'user', targetId: id, ip });
  return c.json({ user: publicUser(user) }, 201);
});

async function applyLedgerSetupWallets(c: any, userId: string) {
  // Create zero-balance wallets up front (test + live kept strictly separate).
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT OR IGNORE INTO wallet_accounts (id, user_id, kind, balance_cents, created_at, updated_at) VALUES (?1, ?2, 'test', 0, ?3, ?3)").bind(randomHex(12), userId, now),
    c.env.DB.prepare("INSERT OR IGNORE INTO wallet_accounts (id, user_id, kind, balance_cents, created_at, updated_at) VALUES (?1, ?2, 'live', 0, ?3, ?3)").bind(randomHex(12), userId, now),
  ]);
}

/** POST /api/auth/register — public registration creates CUSTOMER accounts only. */
authRoutes.post('/register', async (c) => {
  const ip = clientIp(c);
  await checkRateLimit(c.env.DB, `register:${ip}`, 8, 900);
  const body = requireBody(await c.req.json().catch(() => null));
  const email = requireEmail(body.email);
  const password = requirePassword(body.password);
  const id = randomHex(12);
  const now = new Date().toISOString();
  const hash = await hashPassword(password);
  try {
    await c.env.DB.prepare(
      "INSERT INTO users (id, email, password_hash, role, status, created_at, updated_at) VALUES (?1, ?2, ?3, 'customer', 'active', ?4, ?4)",
    ).bind(id, email, hash, now).run();
  } catch {
    throw conflict('An account with that email already exists.');
  }
  await applyLedgerSetupWallets(c, id);

  // Test-mode starter credit so the simulator is usable. Clearly labelled TEST DATA,
  // never withdrawable or transferable, and kept in the separate 'test' wallet.
  const settings = await getSettings(c.env.DB);
  if (settings.test_signup_credit_cents > 0) {
    await applyLedgerEntry(c.env.DB, {
      userId: id,
      kind: 'test',
      entryType: 'test_credit',
      amountCents: settings.test_signup_credit_cents,
      reason: 'Sign-up TEST credit (simulator only — not real money).',
      createdBy: 'system',
      idempotencyKey: `signup-test-credit:${id}`,
    });
  }

  const user: SessionUser = { id, email, role: 'customer', status: 'active' };
  await createSession(c, user);
  await logAudit(c.env.DB, { actorId: id, actorRole: 'customer', action: 'user_registered', targetType: 'user', targetId: id, ip });
  return c.json({ user: publicUser(user) }, 201);
});

/** POST /api/auth/login */
authRoutes.post('/login', async (c) => {
  const ip = clientIp(c);
  await checkRateLimit(c.env.DB, `login:${ip}`, 12, 900);
  const body = requireBody(await c.req.json().catch(() => null));
  const email = requireEmail(body.email);
  if (typeof body.password !== 'string') throw badRequest('Password is required.');
  const row = await c.env.DB.prepare('SELECT id, email, password_hash, role, status FROM users WHERE email = ?1')
    .bind(email)
    .first<{ id: string; email: string; password_hash: string; role: 'customer' | 'admin'; status: 'active' | 'suspended' }>();
  const ok = row ? await verifyPassword(body.password, row.password_hash) : false;
  if (!row || !ok) {
    await logAudit(c.env.DB, { actorRole: 'anonymous', action: 'login_failed', ip, detail: { email_prefix: email.slice(0, 3) + '***' } });
    throw unauthorized('Invalid email or password.');
  }
  if (row.status !== 'active') {
    throw forbidden('This account is suspended. Contact support for assistance.');
  }
  await checkRateLimit(c.env.DB, `login-user:${row.id}`, 20, 900);
  const user: SessionUser = { id: row.id, email: row.email, role: row.role, status: row.status };
  await createSession(c, user);
  await logAudit(c.env.DB, { actorId: user.id, actorRole: user.role, action: 'login_succeeded', ip });
  return c.json({ user: publicUser(user) });
});

/** POST /api/auth/logout */
authRoutes.post('/logout', requireUser, async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const hashed = await sha256Hex(token);
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?1').bind(hashed).run();
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

/** GET /api/auth/me */
authRoutes.get('/me', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ user: null });
  const wallets = await c.env.DB.prepare('SELECT kind, balance_cents FROM wallet_accounts WHERE user_id = ?1')
    .bind(user.id).all<{ kind: string; balance_cents: number }>();
  return c.json({ user: publicUser(user), wallets: wallets.results ?? [] });
});

export function publicUser(u: SessionUser) {
  return { id: u.id, email: u.email, role: u.role, status: u.status };
}
