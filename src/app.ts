import { Hono } from 'hono';
import type { Env } from './env';
import type { AppVars } from './middleware/auth';
import { attachUser, csrfGuard } from './middleware/auth';
import { errorResponse } from './lib/errors';
import { pruneRateLimits } from './lib/ratelimit';
import { authRoutes } from './routes/auth';
import { catalogRoutes } from './routes/catalog';
import { orderRoutes } from './routes/orders';
import { walletRoutes } from './routes/wallet';
import { supportRoutes } from './routes/support';
import { adminRoutes } from './routes/admin';
import { webhookRoutes } from './routes/webhooks';

export function createApp() {
  const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

  app.onError((err, c) => errorResponse(err));
  app.notFound((c) => {
    if (c.req.path.startsWith('/api/')) {
      return c.json({ error: { code: 'not_found', message: 'Endpoint not found.' } }, 404);
    }
    return c.text('Not found', 404);
  });

  app.get('/api/health', (c) => c.json({ ok: true, service: 'verifynest-sms-marketplace', time: new Date().toISOString() }));

  app.use('/api/*', attachUser);
  // CSRF guard applies to state-changing API calls (provider webhooks are excluded —
  // they authenticate via provider signature verification instead, once implemented).
  app.use('/api/auth/*', csrfGuard);
  app.use('/api/orders/*', csrfGuard);
  app.use('/api/orders', csrfGuard);
  app.use('/api/wallet/*', csrfGuard);
  app.use('/api/support/*', csrfGuard);
  app.use('/api/admin/*', csrfGuard);

  app.route('/api/auth', authRoutes);
  app.route('/api/catalog', catalogRoutes);
  app.route('/api/orders', orderRoutes);
  app.route('/api/wallet', walletRoutes);
  app.route('/api/support', supportRoutes);
  app.route('/api/admin', adminRoutes);
  app.route('/api/webhooks', webhookRoutes);

  return app;
}

export type App = ReturnType<typeof createApp>;

/** Opportunistic housekeeping (bounded; safe to ignore failures). */
export async function housekeeping(env: Env): Promise<void> {
  try { await pruneRateLimits(env.DB); } catch { /* non-critical */ }
}
