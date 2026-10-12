import { createMiddleware } from 'hono/factory';
import type { Env, SessionUser } from '../env';
import { forbidden, unauthorized } from '../lib/errors';
import { sha256Hex } from '../lib/crypto';
import { getCookie } from 'hono/cookie';

export const SESSION_COOKIE = 'vn_session';

export interface AppVars {
  user?: SessionUser;
}

export type AppMiddleware = ReturnType<typeof createMiddleware<{ Bindings: Env; Variables: AppVars }>>;

async function userFromCookie(c: { env: Env; req: { raw: Request } }): Promise<SessionUser | null> {
  const token = getCookie(c as never, SESSION_COOKIE);
  if (!token || token.length < 32) return null;
  const hashed = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.role, u.status, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?1`,
  )
    .bind(hashed)
    .first<{ id: string; email: string; role: 'customer' | 'admin'; status: 'active' | 'suspended'; expires_at: string }>();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?1').bind(hashed).run();
    return null;
  }
  if (row.status !== 'active') return null;
  // Opportunistic expiry sweep (bounded, cheap).
  await c.env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?1").bind(new Date(Date.now() - 86_400_000).toISOString()).run();
  return { id: row.id, email: row.email, role: row.role, status: row.status };
}

/** Populates c.var.user when a valid session cookie is present; never throws. */
export const attachUser: AppMiddleware = async (c, next) => {
  const user = await userFromCookie(c);
  if (user) c.set('user', user);
  await next();
};

/** Requires any authenticated, active user. */
export const requireUser: AppMiddleware = async (c, next) => {
  const user = await userFromCookie(c);
  if (!user) throw unauthorized();
  c.set('user', user);
  await next();
};

/** Requires an administrator (server-side RBAC — role comes from the DB, never the client). */
export const requireAdmin: AppMiddleware = async (c, next) => {
  const user = await userFromCookie(c);
  if (!user) throw unauthorized();
  if (user.role !== 'admin') throw forbidden('Administrator access required.');
  c.set('user', user);
  await next();
};

/**
 * CSRF defense for state-changing requests: SameSite=Lax cookies plus a required
 * custom header that cross-origin HTML forms cannot set.
 */
export const csrfGuard: AppMiddleware = async (c, next) => {
  const method = c.req.method;
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const origin = c.req.header('origin');
    if (origin && origin !== 'null') {
      const url = new URL(c.req.url);
      // Accept the direct host or the proxy-forwarded host (preview/reverse-proxy setups).
      const forwardedHost = c.req.header('x-forwarded-host');
      const allowedHosts = new Set([url.host, ...(forwardedHost ? forwardedHost.split(',').map((h) => h.trim()) : [])]);
      const originHost = new URL(origin).host;
      if (!allowedHosts.has(originHost)) {
        throw forbidden('Cross-origin request rejected.');
      }
    }
    if (c.req.header('x-verifynest-client') !== '1') {
      throw forbidden('Request rejected by CSRF protection (missing client header).');
    }
  }
  await next();
};
