# Security architecture & checklist

## Authentication & sessions
- [x] PBKDF2-SHA256, 100,000 iterations, 16-byte random per-user salt (WebCrypto — no custom crypto).
- [x] Session tokens: 32 random bytes; only SHA-256(token) stored; raw token only in an **HttpOnly, Secure, SameSite=Lax** cookie; 12-hour expiry; logout deletes server-side state.
- [x] Suspended users: login blocked (403) and all sessions deleted immediately.
- [x] Expired sessions pruned opportunistically.
- [x] No default administrator credentials anywhere. First admin requires the `ADMIN_BOOTSTRAP_TOKEN` secret (constant-time comparison via hash equality) and the route closes permanently after first use. Public registration can never create admins (client-supplied `role` ignored — covered by tests).

## Authorization (RBAC)
- [x] Roles from the database only. Every `/api/admin/*` route passes a server-side `requireAdmin` middleware (403 for customers, 401 for anonymous — covered by tests for every admin path).
- [x] Ownership checks on every customer resource: orders, tickets (non-owners receive **404**, not 403, so existence isn't leaked).
- [x] SMS codes returned only to the order owner; admin order lists deliberately exclude SMS codes (minimal exposure).

## Input handling
- [x] Server-side validation with explicit length limits on every field (email ≤254, password 10–128, subjects ≤140, messages ≤4000, etc.).
- [x] All SQL via D1 parameterized bindings — no string concatenation. Injection payloads tested against login/tickets.
- [x] Control characters stripped from stored free text; all responses `application/json` (never text/html); React escapes at render → stored XSS payloads remain inert text.
- [x] Malformed JSON bodies → 400, never 500.
- [x] Security headers on every response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`; `Cache-Control: no-store` on `/api/*`.

## CSRF
- [x] SameSite=Lax cookies + required custom header `X-VerifyNest-Client` on all state-changing API calls + same-origin `Origin` header verification. Tested (missing header → 403, cross-origin → 403, same-origin → allowed).
- Provider webhooks are exempt from the header (they authenticate via provider signature verification, to be implemented per official docs before go-live) and are rejected until an adapter declares verified webhook support.

## Rate limiting & abuse control
- [x] D1-backed fixed-window limits on register, login (per-IP and per-account), admin setup, order creation, SMS polling, tickets, and abuse reports (see docs/API.md).
- [x] Purchase limits: max concurrent active orders per user (admin-configurable).
- [x] Abuse reporting endpoint + admin handling workflow (reviewed/dismissed/actioned), account suspension, audit trail.

## Money & ledger integrity
- [x] Integer cents everywhere; all prices/balances computed server-side; client-supplied prices/roles/refund amounts are never trusted.
- [x] Append-only ledger: DB triggers abort UPDATE/DELETE on `ledger_entries` (tested).
- [x] Double-spend protection: `ledger_balance_consistency` trigger aborts any ledger insert whose implied prior balance doesn't match the stored balance — concurrent modifications roll back the whole atomic batch (tested).
- [x] Overspend impossible: `CHECK (balance_cents >= 0)` + pre-checks; insufficient balance → 402 with honest balances.
- [x] TEST and live wallets are separate rows; TEST credits can never enter a live wallet and vice versa (enforced in code + tests).
- [x] Idempotency: `UNIQUE(user_id, idempotency_key)` on orders + stored-response replay + `UNIQUE` ledger idempotency keys → refresh/retry can never double-charge (tested).

## Secrets
- [x] Secrets only via Wrangler/Dashboard secret storage (`ADMIN_BOOTSTRAP_TOKEN`, `NUMBEROTP_API_KEY`, `PAYMENT_WEBHOOK_SECRET`). Never in git, DB rows, frontend bundles, or config files (`.dev.vars` gitignored; example file contains placeholders only).
- [x] Admin provider diagnostics report credential **presence as booleans only**.
- [x] Automated secret-leakage tests scan 12 endpoints + audit log for bootstrap token, `pbkdf2$` hashes, `password_hash`, API-key values.
- [x] No secret values or SMS bodies in logs/audit detail (audit stores ids, amounts, reasons, categories).

## Provider safety
- [x] Test Mode is the default; every simulated artifact is labelled TEST DATA in API responses (`isTestData`, `mode`) and UI (banners, badges).
- [x] Going LIVE is server-blocked unless a provider is enabled AND credentials exist AND endpoints are verified (409 `live_blocked`) — an admin cannot accidentally flip the platform live.
- [x] NumberOTP adapter contains **no invented endpoints**; every operation reports unsupported with a pointer to the official docs until verified (tested).
- [x] Webhook duplicate protection: `UNIQUE(provider_id, external_event_id)`; unsupported webhooks 404 honestly.

## Data minimization & retention
- [x] We store: email, password hash, order data, wallet ledger, tickets, audit events. Nothing else personal. No tracking cookies, no third-party scripts, no analytics.
- [x] SMS content restricted to order owner; retained only while operationally necessary; purge-on-request supported via admin.

## Remaining manual items (documented, not hidden)
- [ ] Payment webhook signature verification — implement when a provider is selected (docs/PAYMENTS.md).
- [ ] NumberOTP request/response mapping + any documented signature scheme — implement only from official docs after reseller approval (docs/PROVIDERS.md).
- [ ] Consider a transactional email service for password resets (not implemented: no reset flow exists yet — an admin can assist via support tickets; this is an intentional minimal-surface choice).
- [ ] Optional: add a `Content-Security-Policy` header once you know your final hostname (current headers cover clickjacking/MIME sniffing; the app has no inline scripts by default — Vite emits hashed external bundles).
