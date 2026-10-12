import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../env';

export interface AdapterContext {
  db: D1Database;
  env: Env;
}

export interface ProviderCatalogCountry {
  code: string;
  name: string;
  iso2?: string | null;
  dialCode?: string | null;
}

export interface ProviderCatalogService {
  code: string;
  name: string;
  description?: string | null;
}

export interface ProviderPrice {
  countryCode: string;
  serviceCode: string;
  providerCostCents: number;
}

export type NumberRequestState = 'provisioned' | 'failed' | 'unavailable';

export interface NumberRequestResult {
  state: NumberRequestState;
  phoneNumber?: string;             // only when state === 'provisioned'
  providerOrderRef?: string;        // only when state === 'provisioned'
  expiresAt?: string;               // ISO timestamp, if the provider documents one
  failureReason?: string;           // safe, user-facing text
}

export type SmsCheckState = 'awaiting' | 'received' | 'cancelled' | 'failed' | 'expired';

export interface SmsCheckResult {
  state: SmsCheckState;
  smsCode?: string;                 // only when state === 'received'
  fullSmsText?: string;             // stored server-side, shown to owner only
  failureReason?: string;
  /** Adapter bookkeeping merged into orders.provider_state_json (e.g. poll counters). */
  providerState?: Record<string, unknown>;
}

export type CancelResultState = 'cancelled' | 'refund_approved' | 'refund_denied' | 'failed';

export interface CancelResult {
  state: CancelResultState;
  failureReason?: string;
}

export interface WebhookParseResult {
  externalEventId: string;
  eventType: string;
  /** Redacted payload safe to store. */
  payload: Record<string, unknown>;
}

/**
 * Every provider integrates through this interface. Operations that a provider
 * does not document must throw UnsupportedOperationError — never simulate success.
 */
export interface ProviderAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly mode: 'test' | 'live';

  /** Configuration status WITHOUT revealing secret values. */
  diagnostics(ctx: AdapterContext): Promise<ProviderDiagnostics>;

  listCountries(ctx: AdapterContext): Promise<ProviderCatalogCountry[]>;
  listServices(ctx: AdapterContext): Promise<ProviderCatalogService[]>;
  listPrices(ctx: AdapterContext): Promise<ProviderPrice[]>;

  requestNumber(ctx: AdapterContext, req: { countryCode: string; serviceCode: string }): Promise<NumberRequestResult>;
  checkSms(ctx: AdapterContext, req: { providerOrderRef: string; phoneNumber: string; countryCode: string; serviceCode: string; providerState: Record<string, unknown>; orderCreatedAt: string }): Promise<SmsCheckResult>;
  cancelOrder(ctx: AdapterContext, req: { providerOrderRef: string; phoneNumber: string }): Promise<CancelResult>;

  /** Returns null when webhooks are not documented/supported by this provider. */
  parseWebhook(ctx: AdapterContext, rawBody: string, headers: Record<string, string>): Promise<WebhookParseResult | null>;
}

export interface ProviderDiagnostics {
  providerId: string;
  displayName: string;
  enabled: boolean;
  mode: 'test' | 'live';
  credentialsConfigured: boolean;   // boolean ONLY — never the value
  endpointsVerified: boolean;       // true only when adapter endpoints were verified against official docs
  resellerApprovalConfirmed: boolean;
  supportedOperations: string[];
  unsupportedOperations: { operation: string; reason: string }[];
  notes: string[];
}

export class UnsupportedOperationError extends Error {
  constructor(public operation: string, reason: string) {
    super(`Operation "${operation}" is not supported by this provider adapter: ${reason}`);
    this.name = 'UnsupportedOperationError';
  }
}

export class ProviderNotConfiguredError extends Error {
  constructor(message = 'This provider is not configured. No live purchases are possible until credentials are set and the integration is verified.') {
    super(message);
    this.name = 'ProviderNotConfiguredError';
  }
}
