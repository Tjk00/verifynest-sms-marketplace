# Provider integration guide (modular adapters)

## Architecture

Every upstream provider is integrated through one interface (`src/providers/types.ts`):

```
ProviderAdapter
├── diagnostics()      → config status (booleans only, never secret values)
├── listCountries()    → what the provider actually supports
├── listServices()
├── listPrices()       → provider costs (retail = cost × (1 + markup), computed server-side)
├── requestNumber()    → provisioned | failed | unavailable (never a fabricated success)
├── checkSms()         → awaiting | received | cancelled | failed | expired
├── cancelOrder()      → cancelled | refund_approved | refund_denied | failed
└── parseWebhook()     → verified event or null/throw (never fake processing)
```

Adapters live in `src/providers/`. Adding a provider = new file + registration in `registry.ts` + a `providers` row (via migration or admin). Nothing else in the app changes: orders, wallet, refunds, admin UI and diagnostics all work through the interface.

## Current adapters

### `test` — VerifyNest Test Simulator (enabled, TEST MODE)
Self-contained simulator with fictional countries (`+999`/`+998` ranges), deterministic TEST codes, and scripted behaviours: `demo` (code on 2nd poll), `social-x` (code on 3rd poll), `slow` (never delivers → expiry refund), `fail` (provisioning failure → auto refund). Everything is labelled TEST DATA at API and UI level. Test balances are never withdrawable/transferable.

### `numberotp` — NumberOTP (DISABLED skeleton, deliberately endpoint-free)

- Docs (source of truth): https://www.numberotp.com/en/docs/api
- Reseller agreement: https://www.numberotp.com/reseller-agreement

**Why the adapter contains no endpoint URLs or parameter names:** the environment this project was built in had no network access to numberotp.com, so no endpoint could be verified against the official documentation. Project policy forbids inventing API endpoints, parameters, capabilities, or success responses — so every operation honestly reports *unsupported* with the reason, and the diagnostics page shows exactly which operations remain unverified. The app never pretends NumberOTP is connected.

### Checklist to connect NumberOTP (or any provider) for real

1. **Reseller approval.** Read the reseller agreement and obtain **written confirmation** that your planned website/services are eligible. Record it. Until this exists, stop here.
2. **Read the official API docs.** For each operation you need (services, countries, prices, request number, status/SMS, cancel, webhooks), copy the exact endpoint path, method, parameters, authentication scheme, success and failure response shapes — with the doc section reference — into `ENDPOINTS` in `src/providers/numberotp.ts`.
3. **Implement each method** against that verified contract:
   - Map only *documented* success states to `provisioned` / `received`. Anything ambiguous → `failed`/`awaiting` (never assume success because HTTP 200 came back).
   - Map documented errors onto `failureReason` strings that are safe to show users.
   - Implement `parseWebhook` including the documented signature verification; unverified signatures must throw.
   - Store any per-order provider bookkeeping in the returned `providerState` (persisted in `orders.provider_state_json`).
4. **Secrets.** `npx wrangler secret put NUMBEROTP_API_KEY` (or dashboard → Variables and Secrets → Secret). Backend-only. Never in git, frontend, logs, or DB.
5. **Catalog sync.** Use the adapter's `listCountries/listServices/listPrices` to populate `countries`, `services`, `service_prices` rows for `provider_id = 'numberotp'` (a small admin-triggered sync function is the natural next addition; the tables and unique constraints are ready).
6. **Enable + verify in Test-then-Live order.**
   - Admin dashboard → Provider diagnostics → enable `numberotp` (audit-logged).
   - Set `providers.mode` handling: your new rows carry `mode = 'live'`.
   - Place a **real** low-cost test order with your own money/accounts and verify the documented status flow end-to-end.
   - Only then: Admin → Settings → Operating mode → type `GO-LIVE`. The server re-verifies (enabled + credentials + endpointsVerified) before allowing the switch and audit-logs the change.
7. **Keep the kill switch handy.** Provider diagnostics → "Disable immediately" works at any time, audit-logged.

### Rules encoded in this codebase (do not remove)

- An HTTP response alone never marks an order successful.
- No simulated code is ever presented as a genuine SMS (test data is labelled at every layer).
- Unverified operations throw `UnsupportedOperationError` — surfaced honestly to admins/users.
- Live mode is blocked server-side without a fully verified provider.
- Secrets are reported as booleans (`credentialsConfigured`) and nothing more.

## Adding a different provider later

1. Create `src/providers/<name>.ts` implementing `ProviderAdapter` from that provider's official docs.
2. Register it in `src/providers/registry.ts` and add a `providers` row via a new migration.
3. Everything else (orders, wallet, refunds, admin, diagnostics) picks it up automatically.
