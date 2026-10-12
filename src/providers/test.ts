import type {
  AdapterContext, CancelResult, NumberRequestResult, ProviderAdapter, ProviderCatalogCountry,
  ProviderCatalogService, ProviderDiagnostics, ProviderPrice, SmsCheckResult, WebhookParseResult,
} from './types';
import { UnsupportedOperationError } from './types';

/**
 * VerifyNest Test Simulator.
 * Everything it produces is fictional and must be labelled TEST DATA in the UI.
 * Simulated behaviours per service code:
 *   demo     -> number provisioned; TEST code arrives on the 2nd status check
 *   social-x -> number provisioned; TEST code arrives on the 3rd status check
 *   slow     -> number provisioned; no code ever arrives (demonstrates expiry/refund flow)
 *   fail     -> number request fails (demonstrates automatic refund)
 * Cancellation succeeds while no code has been delivered.
 */
const TEST_PHONE_PREFIXES: Record<string, string> = { 'test-us': '+999555', 'test-uk': '+998555' };

function testPhoneNumber(countryCode: string, seed: string): string {
  const prefix = TEST_PHONE_PREFIXES[countryCode] ?? '+999000';
  let n = 0;
  for (const ch of seed) n = (n * 31 + ch.charCodeAt(0)) % 10000;
  return `${prefix}${String(n).padStart(4, '0')}`;
}

function testSmsCode(seed: string): string {
  let n = 7;
  for (const ch of seed) n = (n * 33 + ch.charCodeAt(0)) % 1_000_000;
  return String(n).padStart(6, '0');
}

export class TestProviderAdapter implements ProviderAdapter {
  readonly id = 'test';
  readonly displayName = 'VerifyNest Test Simulator';
  readonly mode = 'test' as const;

  async diagnostics(_ctx: AdapterContext): Promise<ProviderDiagnostics> {
    return {
      providerId: this.id,
      displayName: this.displayName,
      enabled: true,
      mode: 'test',
      credentialsConfigured: false, // none needed — it is a simulator
      endpointsVerified: true,      // self-contained, no external endpoints
      resellerApprovalConfirmed: false, // N/A for the simulator
      supportedOperations: ['listCountries', 'listServices', 'listPrices', 'requestNumber', 'checkSms', 'cancelOrder'],
      unsupportedOperations: [{ operation: 'parseWebhook', reason: 'The simulator is polled; webhooks are not applicable.' }],
      notes: [
        'All numbers, orders, codes and balances produced by this adapter are fictional TEST DATA.',
        'Test-mode balances are never withdrawable, transferable, or real money.',
      ],
    };
  }

  async listCountries(ctx: AdapterContext): Promise<ProviderCatalogCountry[]> {
    const { results } = await ctx.db
      .prepare("SELECT code, name, iso2, dial_code FROM countries WHERE provider_id = 'test' AND active = 1")
      .all<{ code: string; name: string; iso2: string | null; dial_code: string | null }>();
    return (results ?? []).map((r) => ({ code: r.code, name: r.name, iso2: r.iso2, dialCode: r.dial_code }));
  }

  async listServices(ctx: AdapterContext): Promise<ProviderCatalogService[]> {
    const { results } = await ctx.db
      .prepare("SELECT code, name, description FROM services WHERE provider_id = 'test' AND active = 1")
      .all<{ code: string; name: string; description: string | null }>();
    return (results ?? []).map((r) => ({ code: r.code, name: r.name, description: r.description }));
  }

  async listPrices(ctx: AdapterContext): Promise<ProviderPrice[]> {
    const { results } = await ctx.db
      .prepare("SELECT country_code, service_code, provider_cost_cents FROM service_prices WHERE provider_id = 'test' AND active = 1")
      .all<{ country_code: string; service_code: string; provider_cost_cents: number }>();
    return (results ?? []).map((r) => ({
      countryCode: r.country_code,
      serviceCode: r.service_code,
      providerCostCents: r.provider_cost_cents,
    }));
  }

  async requestNumber(_ctx: AdapterContext, req: { countryCode: string; serviceCode: string }): Promise<NumberRequestResult> {
    const seed = `${req.countryCode}:${req.serviceCode}:${Date.now()}:${Math.random()}`;
    if (req.serviceCode === 'fail') {
      return { state: 'failed', failureReason: 'TEST SIMULATION: the provider could not provision a number for this service.' };
    }
    return {
      state: 'provisioned',
      phoneNumber: testPhoneNumber(req.countryCode, seed),
      providerOrderRef: `TEST-${seed.slice(-10).replace(/[^a-zA-Z0-9]/g, '')}`,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    };
  }

  async checkSms(_ctx: AdapterContext, req: { providerOrderRef: string; phoneNumber: string; countryCode: string; serviceCode: string; providerState: Record<string, unknown>; orderCreatedAt: string }): Promise<SmsCheckResult> {
    const polls = Number(req.providerState.polls ?? 0) + 1;
    const providerState = { ...req.providerState, polls };
    const seed = req.providerOrderRef + req.phoneNumber;

    // 'slow' never delivers; it eventually expires (handled by the order TTL in the orders route).
    const codeArrivesAtPoll = req.serviceCode === 'social-x' ? 3 : 2;
    if (req.serviceCode !== 'slow' && polls >= codeArrivesAtPoll) {
      const code = testSmsCode(seed);
      return {
        state: 'received',
        smsCode: code,
        fullSmsText: `[TEST DATA — NOT A REAL SMS] Your verification code is ${code}.`,
        providerState,
      };
    }
    return { state: 'awaiting', providerState };
  }

  async cancelOrder(_ctx: AdapterContext): Promise<CancelResult> {
    return { state: 'refund_approved' };
  }

  async parseWebhook(_ctx: AdapterContext): Promise<WebhookParseResult | null> {
    throw new UnsupportedOperationError('parseWebhook', 'The test simulator does not emit webhooks.');
  }
}
