# Deployment guide (free tier, including an iPhone-only workflow)

Everything below uses **free plans**: GitHub (free), Cloudflare Workers (free: 100,000 requests/day, 10 ms CPU/invocation), Cloudflare D1 (free: 5 GB storage, 5M row reads/day, 100k row writes/day), and the free `*.workers.dev` hostname. No paid domain, no Docker, no always-on server, no paid AI.

> Verify current quota numbers at developers.cloudflare.com before relying on them — free tiers change. Nothing in this repo assumes a paid feature.

---

## A. Standard workflow (any computer with Node.js 18+)

```bash
git clone https://github.com/<you>/verifynest-sms-marketplace.git
cd verifynest-sms-marketplace
npm install

# 1. Create the D1 database (free). Copy the database_id it prints.
npx wrangler d1 create verifynest-db

# 2. Paste that database_id into wrangler.toml (replace the placeholder UUID), then commit it.

# 3. Apply migrations to the remote database.
npx wrangler d1 migrations apply verifynest-db --remote

# 4. Set the first-admin bootstrap secret (generate a long random string yourself).
npx wrangler secret put ADMIN_BOOTSTRAP_TOKEN

# 5. Build the SPA and deploy.
npm run deploy          # = npm run build && npx wrangler deploy

# 6. Open https://verifynest-sms-marketplace.<your-subdomain>.workers.dev/setup
#    and create the first administrator account (requires the bootstrap token).
#    Setup closes permanently after the first admin exists.
```

If you don't have a Cloudflare account yet: create one at dash.cloudflare.com (free, card not required for Workers/D1 free plans). `npx wrangler login` opens a browser OAuth flow — no API keys to copy.

---

## B. iPhone-only workflow (no computer, mobile browser)

You can do everything from Safari/Chrome on your phone. There are two parts: get the code to GitHub, then let **Cloudflare Workers Builds** compile and deploy it on every push.

### B1. Get the code onto GitHub (if not already)

Option 1 (easiest): this project was built in Arena — the branch is already pushed to GitHub. From the GitHub app/site, open a pull request and merge it into `main` (see section D).

Option 2 (manual): on github.com create a new repo named `verifynest-sms-marketplace`, then use **Add file → Upload files** to upload the repository contents (skip `node_modules/`, `web/dist/`, `.wrangler/`, `.dev.vars`). Upload in batches by folder: `migrations/`, `src/`, `web/`, `tests/`, `docs/`, then root files (`package.json`, `wrangler.toml`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `README.md`, `.gitignore`, `web/index.html`, `web/tsconfig.json`).

### B2. Create the D1 database in the dashboard

1. dash.cloudflare.com → **Storage & Databases → D1** → **Create database** → name: `verifynest-db` → Create.
2. Copy the **Database ID** shown on the database's page.

### B3. Put the Database ID into wrangler.toml (from your phone)

On github.com: open `wrangler.toml` → pencil icon (Edit) → replace the placeholder `database_id = "1111-..."` value with your real Database ID → **Commit changes** to `main`.

### B4. Run the migrations from the D1 console (no CLI needed)

1. D1 → `verifynest-db` → **Console** tab.
2. Open `migrations/0001_init.sql` on github.com (Raw view), copy the whole file, paste it into the console, **Execute**. It may take a few seconds; the console runs multiple statements.
3. Repeat with `migrations/0002_ledger_consistency_trigger.sql`.
4. Verify: in the console run `SELECT name FROM sqlite_master WHERE type='table';` — you should see ~19 tables. Run `SELECT COUNT(*) FROM service_prices;` — should be 6 (test catalogue).

> The console bypasses wrangler's migration bookkeeping table. That's fine for the first deploy. If you later add migrations and use a CLI, run `npx wrangler d1 migrations apply verifynest-db --remote` and it will apply only what's missing (or keep using the console for each new file — either way works; never run the same file twice, though all statements here are `IF NOT EXISTS`/`OR IGNORE` safe).

### B5. Connect Workers Builds to your GitHub repo

1. dash.cloudflare.com → **Workers & Pages** → **Create** → **Worker** → give it the name `verifynest-sms-marketplace` → **Deploy** (deploys a placeholder — that's fine).
2. Open the Worker → **Settings** → **Build** (a.k.a. Builds/CI) → **Connect to Git** → authorize Cloudflare's GitHub app for the repo → choose branch `main`.
3. Configure the build:
   - **Framework preset:** Vite
   - **Build command:** `npm run build`
   - **Build output directory:** leave as configured by wrangler.toml (`web/dist` is declared in `[assets]`)
   - Build/deploy happens via the repo's `wrangler.toml`.
4. Save. Every push to `main` now builds and deploys automatically. Watch the build log on the Worker's **Deployments** tab.
5. You get a free URL like `https://verifynest-sms-marketplace.<your-subdomain>.workers.dev`.

> If the build fails with "assets directory not found", ensure the build command ran `npm run build` (it creates `web/dist`) before `wrangler deploy` — the Vite preset + `npm run build` does exactly this.

### B6. Set the bootstrap secret from the dashboard

1. Worker → **Settings** → **Variables and Secrets** → **Add**:
   - Type: **Secret**
   - Name: `ADMIN_BOOTSTRAP_TOKEN`
   - Value: a long random string you invent (≥16 chars). Write it down somewhere private — you'll need it once.
2. Save (triggers a redeploy).

### B7. Create your administrator account

1. Visit `https://<your-worker-url>/setup` on your phone.
2. Enter your admin email, a strong password (≥10 chars), and the bootstrap token from B6.
3. You're in. The setup page closes permanently for everyone, forever (enforced server-side and audit-logged).
4. Optional hygiene: delete or rotate the `ADMIN_BOOTSTRAP_TOKEN` secret afterwards (it can no longer be used while an admin exists, but rotating is free).

### B8. Alternative: GitHub Actions deploy (also phone-friendly)

If you prefer GitHub to drive deploys: create `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` secrets in your repo (GitHub → Settings → Secrets → Actions; API token created in the Cloudflare dashboard under My Profile → API Tokens with "Workers Scripts: Edit" + "D1: Edit"), then add a workflow using the official `cloudflare/wrangler-action`. The Workers Builds route (B5) is simpler and recommended; this is just an alternative.

---

## C. Environment variables & secrets reference

| Name | Where set | Required | Purpose |
|---|---|---|---|
| `ADMIN_BOOTSTRAP_TOKEN` | Wrangler secret / dashboard Secret | Yes, once, to create the first admin | One-time setup token (≥16 chars). Never in git or frontend. |
| `NUMBEROTP_API_KEY` | Wrangler secret | No (only after written reseller approval) | NumberOTP credentials. Adapter stays disabled without verified endpoints regardless. |
| `PAYMENT_WEBHOOK_SECRET` | Wrangler secret | No (only after payment provider selection) | Webhook signature verification for deposits. |

Plain (non-secret) configuration lives in `wrangler.toml` (`database_id`) and in the D1 `settings` table (operating mode, markup, limits, support email) which admins edit in the dashboard UI.

**Secrets are never stored in the database, never returned by any API, never logged, and never bundled into frontend code.** Admin diagnostics report presence as booleans only (verified by automated tests).

---

## D. Getting this project to GitHub from Arena (iPhone)

The work is on branch `arena/998385e3-verifynest-sms-marketplace` and pushed to GitHub. From the GitHub mobile site/app:
1. Open the repository → **Pull requests** → the open PR → **Merge pull request**.
2. Workers Builds (B5) deploys `main` automatically after the merge.
3. Apply migrations (B4) and set the secret (B6) once — then visit `/setup` (B7).

---

## E. Post-deployment checklist

- [ ] D1 database created; `database_id` committed in `wrangler.toml`
- [ ] Both migration files applied (19+ tables, 3 ledger triggers, seeded TEST catalogue)
- [ ] `ADMIN_BOOTSTRAP_TOKEN` secret set
- [ ] Deploy succeeded (check the Deployments log; site loads at the workers.dev URL)
- [ ] `/status` page shows **TEST MODE** and NumberOTP **not connected**
- [ ] `/setup` used once to create the admin; re-visiting shows "setup closed"
- [ ] Registered a customer; TEST credit visible; placed a simulator order; received a TEST code; ledger shows entries
- [ ] Admin dashboard: overview, users, orders, provider diagnostics, settings all render
- [ ] (Later, only when ready) provider + payment integration per docs/PROVIDERS.md and docs/PAYMENTS.md

## Troubleshooting

| Symptom | Fix |
|---|---|
| Deploy fails: "database not found" | `database_id` in wrangler.toml doesn't match your D1 database (B2/B3). |
| Site loads but every API call 500s | Migrations not applied — run B4 and check the table list. |
| `/setup` says setup unavailable | `ADMIN_BOOTSTRAP_TOKEN` not set (B6), shorter than 16 chars, or an admin already exists. |
| Build fails: assets directory missing | Build command must be `npm run build` so `web/dist` exists before `wrangler deploy`. |
| 404 on deep links (e.g. /dashboard) after refresh | `not_found_handling = "single-page-application"` must be present in `[assets]` (it is, in this repo). |
| D1 free limit errors (HTTP 429 from D1) | You exceeded free row-read/write quotas for the day — wait for reset or consider Workers Paid. |
| `wrangler dev` locally says D1 empty | Run `npm run migrate:local` first; local state lives in `.wrangler/state` (gitignored). |
