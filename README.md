# VerifyNest — SMS Verification Marketplace

**Your Verification. Your Choice.**

A complete, production-oriented SMS verification marketplace built for **Cloudflare Workers + D1 (free tier)** with a **React + TypeScript** frontend. It ships in **TEST MODE by default**: a clearly labelled simulator demonstrates the entire product (accounts, wallet, orders, SMS codes, refunds, admin controls) without any real provider, real money, or real SMS.

> ⚠️ **Honesty first.** VerifyNest never invents inventory, fakes provider success, or displays simulated codes as genuine SMS. Live purchasing stays disabled until an upstream provider (first candidate: [NumberOTP](https://www.numberotp.com/reseller-agreement)) grants written reseller approval, its API endpoints are verified against its [official documentation](https://www.numberotp.com/en/docs/api), credentials are stored as Workers secrets, and an administrator enables it. VerifyNest is not affiliated with or endorsed by any upstream provider or any third-party platform. Temporary numbers are **never guaranteed** to be accepted by WhatsApp, TikTok, Facebook, Instagram, Telegram, or any other service.

---

## What's inside

| Layer | Implementation |
|---|---|
| Frontend | React 18 + TypeScript + Vite, mobile-first custom design system, react-router SPA (15 public pages + customer dashboard + separate admin dashboard) |
| Backend | Hono on Cloudflare Workers (TypeScript), server-side validation, structured errors, RBAC, CSRF guard, rate limiting, idempotency |
| Database | Cloudflare D1, versioned SQL migrations, FK/UNIQUE/CHECK constraints, **append-only ledger enforced by triggers** |
| Auth | PBKDF2-SHA256 password hashing (100k iterations, per-user salt), hashed session tokens in HttpOnly/Secure/SameSite=Lax cookies, 12 h expiry |
| Wallet | Ledger-based, integer cents, TEST and live wallets strictly separated, double-spend protection via DB trigger + CHECK constraints |
| Orders | Full lifecycle (pending → awaiting_sms → completed / cancelled / failed / refunded / expired), automatic refunds, per-order expiry, ownership checks, idempotent creation |
| Providers | Modular adapter interface; working **Test simulator**; **NumberOTP skeleton** that honestly reports every unverified operation as unsupported |
| Payments | Modular boundary — live deposits **disabled** until a provider is selected and webhooks are verified server-side |
| Tests | 79 automated tests (Vitest + Miniflare running the real bundled Worker in workerd against real D1) |

## Repository layout

```
migrations/          Versioned D1 SQL migrations (0001_init, 0002_ledger_trigger)
src/                 Cloudflare Worker backend (Hono)
  index.ts           Worker entrypoint (+ security headers)
  app.ts             Route assembly, error handling, CSRF wiring
  lib/               crypto, ledger, idempotency, rate limits, settings, audit, validation
  middleware/        session auth, RBAC, CSRF guard
  providers/         adapter interface, Test simulator, NumberOTP skeleton, registry
  routes/            auth, catalog, orders, wallet, support, admin, webhooks
web/                 React SPA (Vite). `npm run build` → web/dist, served as Worker assets
tests/               Vitest suite running the bundled worker inside workerd (Miniflare)
docs/                DEPLOYMENT, API, SECURITY, PROVIDERS, PAYMENTS, LIMITATIONS
wrangler.toml        Worker + D1 + static-assets configuration
.dev.vars.example    Template for LOCAL dev secrets (never commit .dev.vars)
```

## Quick start (local)

```bash
npm install
npm run build                      # builds the SPA into web/dist
npx wrangler d1 migrations apply verifynest-db --local
npm run dev                        # wrangler dev → http://localhost:8787
```

1. Copy `.dev.vars.example` to `.dev.vars` and set your own `ADMIN_BOOTSTRAP_TOKEN` (≥16 random characters).
2. Visit **`/setup`** to create the first (and only self-service) administrator account. Setup closes permanently once an admin exists.
3. Register a customer account — you'll receive 500 TEST cents — and try the simulator: order the **demo** service, press "Check for SMS now" twice, and watch the TEST code arrive. Try **fail** (auto-refund), **slow** (expiry refund), and cancellation.

## Commands

| Command | Purpose |
|---|---|
| `npm test` | Run the full automated test suite (79 tests) |
| `npm run typecheck` | TypeScript strict check for worker + tests |
| `npx tsc -p web/tsconfig.json --noEmit` | TypeScript strict check for the SPA |
| `npm run build` | Build the SPA for deployment |
| `npm run migrate:local` / `migrate:remote` | Apply D1 migrations locally / to production |
| `npm run deploy` | Build + deploy the Worker, D1 binding, and assets |

## Deployment (free tier)

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for the full checklist, including a **no-computer workflow from an iPhone** (GitHub web + Cloudflare dashboard + pasting SQL into the D1 console) and how to create the first admin without a CLI.

## Costs — the honest summary

Free: hosting (Workers free plan: 100k requests/day, D1 free: 5 GB storage / 5M row-reads/day), the *.workers.dev hostname, GitHub. **Not free:** real SMS inventory (providers charge per number), payment processing fees (once a processor is connected), a custom domain (~$10/yr, optional), and anything beyond free-tier quotas (Workers Paid ≈ $5/mo only if you outgrow the limits). Details in [docs/LIMITATIONS.md](docs/LIMITATIONS.md).

## Security

Read **[docs/SECURITY.md](docs/SECURITY.md)** for the full control list and checklist (hashing, sessions, CSRF, rate limits, idempotency, secret handling, audit logging, ownership checks, XSS/SQLi posture).

## License / status

This project is a starting point you own and operate. You are responsible for complying with your upstream provider's reseller agreement, payment provider terms, and the laws of every jurisdiction you serve.
