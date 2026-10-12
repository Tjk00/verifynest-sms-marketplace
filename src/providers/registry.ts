import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../env';
import { notFound } from '../lib/errors';
import type { ProviderAdapter } from './types';
import { ProviderNotConfiguredError } from './types';
import { TestProviderAdapter } from './test';
import { NumberOtpAdapter } from './numberotp';

const ADAPTERS: Record<string, ProviderAdapter> = {
  test: new TestProviderAdapter(),
  numberotp: new NumberOtpAdapter(),
};

export function getAdapter(providerId: string): ProviderAdapter {
  const adapter = ADAPTERS[providerId];
  if (!adapter) throw notFound(`Unknown provider "${providerId}".`);
  return adapter;
}

export interface ActiveProviderRow {
  id: string;
  enabled: number;
  mode: string;
}

/**
 * Resolves the provider that should serve a request in the current operating mode.
 * Live mode requires the provider row to be enabled AND the adapter to declare its
 * endpoints verified — otherwise a ProviderNotConfiguredError explains what is missing.
 */
export async function resolveProviderForMode(db: D1Database, env: Env, mode: 'test' | 'live'): Promise<{ adapter: ProviderAdapter; providerId: string }> {
  if (mode === 'test') {
    return { adapter: ADAPTERS.test, providerId: 'test' };
  }
  const { results } = await db
    .prepare("SELECT id FROM providers WHERE kind = 'http' AND enabled = 1")
    .all<{ id: string }>();
  const candidates = results ?? [];
  if (candidates.length === 0) {
    throw new ProviderNotConfiguredError(
      'Live mode is enabled but no upstream provider is activated. No real purchases can be made until a provider adapter is verified, credentialed, and enabled by an administrator.',
    );
  }
  for (const c of candidates) {
    const adapter = ADAPTERS[c.id];
    if (!adapter) continue;
    const diag = await adapter.diagnostics({ db, env });
    if (diag.enabled && diag.credentialsConfigured && diag.endpointsVerified) {
      return { adapter, providerId: c.id };
    }
  }
  throw new ProviderNotConfiguredError(
    'An upstream provider row is enabled, but its adapter is not fully configured (missing credentials or unverified endpoints). Live purchases remain blocked. See the admin Provider Diagnostics page.',
  );
}
