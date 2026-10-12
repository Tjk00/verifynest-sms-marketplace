import type {
  AdapterContext, CancelResult, NumberRequestResult, ProviderAdapter, ProviderCatalogCountry,
  ProviderCatalogService, ProviderDiagnostics, ProviderPrice, SmsCheckResult, WebhookParseResult,
} from './types';
import { ProviderNotConfiguredError, UnsupportedOperationError } from './types';

/**
 * NumberOTP adapter — SKELETON ONLY, DISABLED BY DESIGN.
 *
 * Official documentation (source of truth):  https://www.numberotp.com/en/docs/api
 * Official reseller agreement:               https://www.numberotp.com/reseller-agreement
 *
 * IMPORTANT — why this adapter contains no endpoint URLs or parameter names:
 *   Project policy (and the build brief) forbids inventing API endpoints, parameters,
 *   capabilities, or success responses. The build environment used to create this
 *   repository did not have network access to numberotp.com, so NO endpoint in this
 *   file could be verified against the official docs. Rather than fabricate an API
 *   surface, every operation reports itself as unsupported until a developer:
 *
 *   1. Obtains written confirmation of reseller-program eligibility (see agreement URL).
 *   2. Reads the official API docs and records the verified endpoints/parameters in
 *      ENDPOINTS below, with the doc section each one came from.
 *   3. Sets the NUMBEROTP_API_KEY secret via `wrangler secret put NUMBEROTP_API_KEY`
 *      (backend-only; never in frontend code, never in git).
 *   4. Implements each method against the verified contract, mapping documented
 *      success/failure responses onto the ProviderAdapter result types.
 *   5. Sets endpointsVerified = true (per operation) and flips the provider's
 *      `enabled` flag through the admin dashboard, which audit-logs the change.
 *
 *   Until then, the application runs in TEST MODE with the built-in simulator and
 *   clearly reports NumberOTP as NOT CONNECTED. It never pretends otherwise.
 */

interface VerifiedEndpoint {
  /** Path exactly as documented at https://www.numberotp.com/en/docs/api */
  path: string;
  /** Documentation section/anchor this was verified against */
  docRef: string;
}

const ENDPOINTS: Record<string, VerifiedEndpoint | null> = {
  listCountries: null, // TODO: fill from official docs after reseller approval
  listServices: null,
  listPrices: null,
  requestNumber: null,
  checkSmsStatus: null,
  cancelOrder: null,
  webhook: null,
};

const unverified = (op: string) =>
  new UnsupportedOperationError(
    op,
    'NumberOTP endpoints have not been verified against the official documentation yet, and/or reseller approval and API credentials are not configured. VerifyNest never fabricates provider operations. See docs/PROVIDERS.md.',
  );

export class NumberOtpAdapter implements ProviderAdapter {
  readonly id = 'numberotp';
  readonly displayName = 'NumberOTP';
  readonly mode = 'live' as const;

  async diagnostics(ctx: AdapterContext): Promise<ProviderDiagnostics> {
    const row = await ctx.db
      .prepare('SELECT enabled FROM providers WHERE id = ?1')
      .bind(this.id)
      .first<{ enabled: number }>();
    const credentialsConfigured = typeof ctx.env.NUMBEROTP_API_KEY === 'string' && ctx.env.NUMBEROTP_API_KEY.length > 0;
    const verifiedOps = Object.entries(ENDPOINTS).filter(([, v]) => v !== null).map(([k]) => k);
    return {
      providerId: this.id,
      displayName: 'NumberOTP (NOT CONNECTED)',
      enabled: Boolean(row?.enabled),
      mode: 'live',
      credentialsConfigured, // boolean only — the value is never returned, logged, or displayed
      endpointsVerified: verifiedOps.length === Object.keys(ENDPOINTS).length && verifiedOps.length > 0,
      resellerApprovalConfirmed: false, // set true only after written confirmation is on file
      supportedOperations: verifiedOps,
      unsupportedOperations: Object.keys(ENDPOINTS)
        .filter((k) => !verifiedOps.includes(k))
        .map((k) => ({ operation: k, reason: 'Endpoint not yet verified against https://www.numberotp.com/en/docs/api' })),
      notes: [
        'Requires written reseller-program eligibility confirmation before any integration work.',
        'API key must be stored only as a Wrangler secret (NUMBEROTP_API_KEY).',
        'Even with a key set, operations stay disabled until endpoints are implemented from the official docs.',
        'VerifyNest is not affiliated with or endorsed by NumberOTP or any upstream provider.',
      ],
    };
  }

  async listCountries(_ctx: AdapterContext): Promise<ProviderCatalogCountry[]> { throw unverified('listCountries'); }
  async listServices(_ctx: AdapterContext): Promise<ProviderCatalogService[]> { throw unverified('listServices'); }
  async listPrices(_ctx: AdapterContext): Promise<ProviderPrice[]> { throw unverified('listPrices'); }
  async requestNumber(_ctx: AdapterContext, _req: { countryCode: string; serviceCode: string }): Promise<NumberRequestResult> {
    if (!ENDPOINTS.requestNumber) throw unverified('requestNumber');
    throw new ProviderNotConfiguredError();
  }
  async checkSms(_ctx: AdapterContext, _req: { providerOrderRef: string; phoneNumber: string; countryCode: string; serviceCode: string; providerState: Record<string, unknown>; orderCreatedAt: string }): Promise<SmsCheckResult> { throw unverified('checkSmsStatus'); }
  async cancelOrder(_ctx: AdapterContext, _req: { providerOrderRef: string; phoneNumber: string }): Promise<CancelResult> { throw unverified('cancelOrder'); }
  async parseWebhook(_ctx: AdapterContext, _rawBody: string, _headers: Record<string, string>): Promise<WebhookParseResult | null> {
    throw unverified('webhook');
  }
}
