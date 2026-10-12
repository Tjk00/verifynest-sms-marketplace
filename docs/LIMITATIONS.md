# Known limitations & honest status report

_Last updated: 2026-10-12 (build date)_

## Test results (actually executed, not claimed)

```
Command: npx vitest run   (Vitest + Miniflare: the real bundled Worker running inside
                           workerd against a real local D1, migrations applied)

 Test Files  8 passed (8)
      Tests  79 passed (79)

Also executed and passing:
  npx tsc --noEmit                        (worker + tests, strict)
  npx tsc -p web/tsconfig.json --noEmit   (frontend, strict)
  npm run build                           (Vite production build, ~75 kB gzipped)
```

Suites: `migrations` (schema, triggers, seeds, splitter), `auth` (register/login/logout, hashing, rate limits, admin bootstrap), `rbac` (customer/admin separation on every admin route, suspension, self-suspension block, client-supplied role ignored), `orders` (full TEST-mode lifecycle, SMS simulation, failures, expiry refunds, cancellation, insufficient balance 402, purchase limits, idempotent replay + key-reuse rejection, ownership 404s), `ledger` (balances, wallet separation, overspend block, duplicate-entry block, append-only triggers), `provider` (NumberOTP skeleton honesty, live-mode block, deposits block, webhook rejection), `security` (CSRF header + origin, SQLi payloads, length limits, XSS payload handling, secret-leakage scan of 12 endpoints, hashed session tokens), `admin` (overview, users, orders, TEST credits, adjustments with mandatory reason, manual refunds + double-refund block, pricing, audit trail, support-email verification gate, tickets, abuse reports).

## What works right now (TEST MODE, zero external accounts)

Registration, login/logout, sessions; TEST wallet with signup credit; catalogue of simulated services/countries with server-computed prices; ordering with idempotency and purchase limits; simulated SMS delivery, failures, expiry, cancellation and automatic refunds; full transaction ledger; support tickets; abuse reports; admin dashboard (overview, customers + suspension, orders, provider diagnostics, pricing, ledger inspection + adjustments, tickets, audit log, payments status, settings + TEST-mode controls); first-admin secure setup; public pages incl. live status page and all legal policies.

## What requires external accounts/credentials (not yet possible, honestly blocked)

| Feature | Blocked until | Behaviour meanwhile |
|---|---|---|
| Real SMS numbers | Written NumberOTP reseller approval + endpoints verified from official docs + `NUMBEROTP_API_KEY` secret + admin enablement | NumberOTP shows NOT CONNECTED; every operation reports unsupported; live mode switch is server-blocked (409) |
| Real deposits | Payment provider chosen & approved, credentials + verified webhooks implemented, admin enablement | Deposits return 409 with explanation; TEST MODE is the usable path |
| Email notifications / password reset | A transactional email service (not bundled — keeps the free surface minimal) | Support tickets are the account-recovery path; admin can assist |
| Custom domain | Optional paid domain (~$10/yr) | Free `*.workers.dev` hostname works fully |

## Known limitations (accepted trade-offs)

1. **No password self-reset yet.** Reset flows need transactional email. Suspending/recovery is admin-assisted via tickets. (Deliberate minimal-attack-surface choice; add reset when email is configured.)
2. **Rate limiting is D1-fixed-window**, per-database. Sufficient for login/register/order abuse at free-tier scale; a distributed cache would be needed at large scale (paid territory anyway).
3. **Catalog sync for live providers is a documented manual step** (docs/PROVIDERS.md §6.5): tables/constraints are ready; an automated admin-triggered sync job should be added when the first real provider is verified.
4. **D1 free quotas** (5 GB, 5M row reads/day, 100k row writes/day) and **Workers free quotas** (100k requests/day, 10 ms CPU/invocation) bound traffic. The poll endpoint is rate-limited per user to protect quota. Exceeding free tiers requires Workers Paid (~$5/mo) — the app never hides this or claims unlimited free operation.
5. **Interactive D1 transactions (`db.transaction()`) are unavailable in local/open-source workerd**, so the ledger uses atomic `batch()` + a DB-level consistency trigger (`ledger_balance_consistency`). This is portable (identical semantics locally and in production) and DB-enforced — arguably stronger than app-level transactions — but it is a deviation from the classic transaction pattern worth knowing about.
6. **SMS simulator codes are deterministic per order** (seeded from the order reference) so tests are reproducible; obviously fine for TEST DATA, and real providers will supply real codes.
7. **Webhook signature verification is per-provider and unimplemented** until providers are verified — webhook endpoints honestly 404 (`webhook_unsupported`) rather than accept unverified events.
8. **No CSP header yet** — other hardening headers are set; add CSP once the final hostname is known (docs/SECURITY.md).
9. **Single-admin bootstrap**: only ONE admin can ever be created via `/setup`. Additional admins would need a promotion flow (currently: existing admin can be added only by direct DB action — intentional until an audited "promote user" feature is built).

## Free-plan limits of every hosting component used

| Component | Free plan (verify current numbers at developers.cloudflare.com / github.com) |
|---|---|
| Cloudflare Workers | 100,000 requests/day, 10 ms CPU per invocation, 1,000 deployed Workers |
| Cloudflare D1 | 5 GB storage, 5,000,000 row reads/day, 100,000 row writes/day, 50 databases |
| Workers static assets | 20,000 files, 25 MiB per file (SPA build is ~10 files, <300 kB) |
| *.workers.dev hostname | Free, instant HTTPS |
| GitHub | Free private/public repos; free Actions minutes for public repos |
| Workers Builds (dashboard CI) | Free build minutes on the Workers free plan |

**Unavoidable real-world costs when you go live (disclosed up front):** SMS inventory at provider wholesale prices, payment processing fees (~1.5–4% typical), optional custom domain (~$10/yr), and Workers Paid (~$5/mo) only if you exceed free quotas. Nothing in TEST MODE costs anything.
