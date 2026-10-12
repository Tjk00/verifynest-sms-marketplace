import type { D1Database } from '@cloudflare/workers-types';

export type OperatingMode = 'test' | 'live';

export interface AppSettings {
  operating_mode: OperatingMode;
  support_email: { address: string; verified: boolean; note?: string };
  deposits_enabled: boolean;
  payment_provider: string | null;
  default_markup_percent: number;
  max_active_orders_per_user: number;
  test_signup_credit_cents: number;
  test_order_ttl_seconds: number;
}

const DEFAULTS: AppSettings = {
  operating_mode: 'test',
  support_email: { address: 'verifynest.support@gmail.com', verified: false },
  deposits_enabled: false,
  payment_provider: null,
  default_markup_percent: 20,
  max_active_orders_per_user: 5,
  test_signup_credit_cents: 500,
  test_order_ttl_seconds: 300,
};

export async function getSettings(db: D1Database): Promise<AppSettings> {
  const { results } = await db.prepare('SELECT key, value_json FROM settings').all<{ key: string; value_json: string }>();
  const out: Record<string, unknown> = { ...(DEFAULTS as unknown as Record<string, unknown>) };
  for (const row of results ?? []) {
    try {
      out[row.key] = JSON.parse(row.value_json);
    } catch {
      // keep default for corrupted rows
    }
  }
  return out as unknown as AppSettings;
}

export async function getSetting<T>(db: D1Database, key: keyof AppSettings): Promise<T> {
  const s = await getSettings(db);
  return s[key] as T;
}

export async function setSetting(
  db: D1Database,
  key: keyof AppSettings,
  value: unknown,
  updatedBy: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO settings (key, value_json, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(key) DO UPDATE SET value_json = ?2, updated_at = ?3, updated_by = ?4`,
    )
    .bind(key as string, JSON.stringify(value), new Date().toISOString(), updatedBy)
    .run();
}

/** Public-safe subset of settings (never includes anything secret). */
export function publicSettings(s: AppSettings) {
  return {
    operatingMode: s.operating_mode,
    depositsEnabled: s.deposits_enabled,
    paymentProvider: s.payment_provider,
    supportEmail: s.support_email.verified ? s.support_email.address : null,
    supportEmailConfigured: s.support_email.verified,
  };
}
