import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../env';
import type { AppVars } from '../middleware/auth';
import { getSettings, publicSettings } from '../lib/settings';
import { notFound } from '../lib/errors';
import { getAdapter } from '../providers/registry';

export const catalogRoutes = new Hono<{ Bindings: Env; Variables: AppVars }>();

/**
 * GET /api/catalog — countries, services and server-computed retail prices for the
 * provider(s) active in the current operating mode. Never invents inventory: only
 * rows that exist in D1 (synced/seeded) are returned, each labelled with its mode.
 */
catalogRoutes.get('/', async (c) => {
  const settings = await getSettings(c.env.DB);
  const mode = settings.operating_mode;
  const providerIds = mode === 'test' ? ['test'] : await liveProviderIds(c.env.DB);

  const countries: any[] = [];
  const services: any[] = [];
  const prices: any[] = [];

  for (const pid of providerIds) {
    const adapter = getAdapter(pid);
    const enabled = await providerEnabled(c.env.DB, pid);
    for (const ct of await adapter.listCountries({ db: c.env.DB, env: c.env })) {
      countries.push({ ...ct, providerId: pid, available: enabled, mode: adapter.mode, isTestData: adapter.mode === 'test' });
    }
    for (const sv of await adapter.listServices({ db: c.env.DB, env: c.env })) {
      services.push({ ...sv, providerId: pid, available: enabled, mode: adapter.mode, isTestData: adapter.mode === 'test' });
    }
    const defaultMarkup = settings.default_markup_percent;
    const dbPrices = await c.env.DB.prepare(
      'SELECT country_code, service_code, provider_cost_cents, markup_percent, retail_price_cents FROM service_prices WHERE provider_id = ?1 AND active = 1',
    ).bind(pid).all<{ country_code: string; service_code: string; provider_cost_cents: number; markup_percent: number; retail_price_cents: number }>();
    for (const p of dbPrices.results ?? []) {
      const markup = p.markup_percent ?? defaultMarkup;
      const retail = Math.max(0, Math.round(p.provider_cost_cents * (1 + markup / 100)));
      prices.push({
        providerId: pid,
        countryCode: p.country_code,
        serviceCode: p.service_code,
        retailPriceCents: retail,
        currency: 'USD',
        mode: adapter.mode,
        isTestData: adapter.mode === 'test',
      });
    }
  }

  return c.json({ operatingMode: mode, countries, services, prices });
});

catalogRoutes.get('/services/:code', async (c) => {
  const code = c.req.param('code');
  const row = await c.env.DB.prepare('SELECT s.code, s.name, s.description, s.provider_id, s.mode, s.active FROM services s WHERE s.code = ?1')
    .bind(code).first<{ code: string; name: string; description: string | null; provider_id: string; mode: string; active: number }>();
  if (!row) throw notFound('Service not found.');
  const prices = await c.env.DB.prepare(
    'SELECT country_code, provider_cost_cents, markup_percent FROM service_prices WHERE service_code = ?1 AND provider_id = ?2 AND active = 1',
  ).bind(code, row.provider_id).all<{ country_code: string; provider_cost_cents: number; markup_percent: number }>();
  const settings = await getSettings(c.env.DB);
  const offers = (prices.results ?? []).map((p) => ({
    countryCode: p.country_code,
    retailPriceCents: Math.max(0, Math.round(p.provider_cost_cents * (1 + (p.markup_percent ?? settings.default_markup_percent) / 100))),
    currency: 'USD',
  }));
  return c.json({
    service: { code: row.code, name: row.name, description: row.description, providerId: row.provider_id, mode: row.mode, available: row.active === 1, isTestData: row.mode === 'test' },
    offers,
  });
});

/** GET /api/status — public service-status page data (no secrets). */
catalogRoutes.get('/status', async (c) => {
  const settings = await getSettings(c.env.DB);
  const providers = await c.env.DB.prepare('SELECT id, name, enabled FROM providers').all<{ id: string; name: string; enabled: number }>();
  const diags = [];
  for (const p of providers.results ?? []) {
    try {
      const adapter = getAdapter(p.id);
      const d = await adapter.diagnostics({ db: c.env.DB, env: c.env });
      diags.push({
        id: p.id,
        name: d.displayName,
        connected: d.enabled && (d.mode === 'test' || (d.credentialsConfigured && d.endpointsVerified)),
        mode: d.mode,
      });
    } catch {
      diags.push({ id: p.id, name: p.name, connected: false, mode: 'unknown' });
    }
  }
  const orderStats = await c.env.DB.prepare(
    "SELECT COUNT(*) AS active FROM orders WHERE status IN ('pending','awaiting_sms')",
  ).first<{ active: number }>();
  return c.json({
    ok: true,
    settings: publicSettings(settings),
    providers: diags,
    activeOrders: orderStats?.active ?? 0,
    checkedAt: new Date().toISOString(),
  });
});

async function providerEnabled(db: D1Database, id: string): Promise<boolean> {
  const row = await db.prepare('SELECT enabled FROM providers WHERE id = ?1').bind(id).first<{ enabled: number }>();
  return Boolean(row?.enabled);
}

async function liveProviderIds(db: D1Database): Promise<string[]> {
  const { results } = await db.prepare("SELECT id FROM providers WHERE kind = 'http' AND enabled = 1").all<{ id: string }>();
  return (results ?? []).map((r) => r.id);
}
