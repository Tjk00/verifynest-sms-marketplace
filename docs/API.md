# VerifyNest API reference

Base path: `/api` (same origin as the SPA). All responses are JSON. Errors use the envelope `{ "error": { "code": "...", "message": "..." } }` — stack traces, secrets, and raw provider payloads are never included.

State-changing requests (`POST`/`PUT`) must send the header `X-VerifyNest-Client: 1` (CSRF guard; cross-origin requests are additionally rejected by origin check + SameSite=Lax cookies).

Auth: session cookie `vn_session` (HttpOnly, Secure, SameSite=Lax, 12 h). Roles come from the database — the client can never elevate itself.

## Public

| Method & path | Description |
|---|---|
| `GET /api/health` | Liveness probe. |
| `GET /api/auth/bootstrap-status` | Whether first-admin setup is open and whether the bootstrap secret exists (booleans only). |
| `POST /api/auth/setup-admin` | Create the FIRST admin. Body: `{email, password, bootstrap_token}`. 403 once any admin exists. Rate-limited, audit-logged. |
| `POST /api/auth/register` | Customer registration. Body: `{email, password}`. Grants TEST signup credit (configurable). Any `role` field sent by the client is ignored. Rate-limited. |
| `POST /api/auth/login` | Body: `{email, password}`. Rate-limited per IP and per account. |
| `GET /api/auth/me` | Current user + wallet balances, or `{user: null}`. |
| `GET /api/catalog` | Countries, services, and server-computed retail prices for providers active in the current operating mode. Every entry carries `mode` and `isTestData`. |
| `GET /api/catalog/services/:code` | Service detail + per-country offers. |
| `GET /api/catalog/status` | Public status page data: operating mode, provider connected flags, deposits status, verified support email (hidden until verified). |

## Customer (session required)

| Method & path | Description |
|---|---|
| `POST /api/auth/logout` | Destroy session. |
| `GET /api/wallet` | TEST + live balances with honest labels; live deposits notice when disabled. |
| `GET /api/wallet/ledger` | Own append-only transaction history. |
| `POST /api/wallet/deposits` | **Disabled boundary.** Returns 409 `deposits_disabled` until a payment provider is configured, verified, and admin-enabled (see docs/PAYMENTS.md). |
| `POST /api/orders` | Create order. Body: `{country_code, service_code, idempotency_key}`. Server-side pricing; balance check; purchase limits; provider call; automatic refund on failure. Same key + same body replays the stored response; same key + different body → 409. |
| `GET /api/orders` | Own orders (SMS codes hidden for non-completed orders). |
| `GET /api/orders/:id` | Own order incl. SMS code when completed. Other users get 404 (no existence leak). |
| `POST /api/orders/:id/check` | Poll provider for SMS/status (rate-limited 30/min/user). Handles expiry + auto-refund. |
| `POST /api/orders/:id/cancel` | Cancel when provider supports it; refund per provider outcome (`refund_approved` → refunded; `refund_denied` → cancelled without refund). |
| `GET/POST /api/support/tickets[...]` | Own tickets: list, create, view, reply. |
| `POST /api/support/abuse-report` | File an abuse report (`{category, details}`). |

## Admin (session + `role = admin`, server-checked on every route)

| Method & path | Description |
|---|---|
| `GET /api/admin/overview` | Counts, revenue/margin (with "not guaranteed profit" disclaimer), open tickets/reports. |
| `GET /api/admin/users` | Users (never includes password hashes). |
| `POST /api/admin/users/:id/status` | `{status: active\|suspended}`. Suspension kills sessions immediately. Self-suspension blocked. Audit-logged. |
| `GET /api/admin/orders?status=` | All orders (SMS codes deliberately excluded). |
| `GET /api/admin/providers/diagnostics` | Per-provider config status: enabled, credentialsConfigured (**boolean only**), endpointsVerified, resellerApprovalConfirmed, supported/unsupported operations. |
| `POST /api/admin/providers/:id/enabled` | Enable/disable a provider immediately. Audit-logged. |
| `GET/PUT /api/admin/settings` | Operating mode (live switch is server-blocked unless a provider is fully verified — 409 `live_blocked`), support email (+verified flag), markup, limits, TEST-mode controls, deposits flag (blocked unless a payment provider exists). Mode changes are audit-logged. |
| `POST /api/admin/prices` | Set provider cost + markup → server computes retail. |
| `GET /api/admin/ledger?user_id=` | Inspect any ledger entries. |
| `POST /api/admin/wallet-adjust` | `{user_id, wallet_kind, amount_cents, reason}` — reason mandatory (≥5 chars), audit-logged. |
| `POST /api/admin/test-credit` | Grant TEST credits (audit-logged; never real money). |
| `POST /api/admin/refunds` | Manual refund for a terminal order; one refund per order (duplicate → 409). Audit-logged. |
| `GET/POST /api/admin/tickets[...]` | View/reply/close any ticket. |
| `GET /api/admin/abuse-reports`, `POST .../:id/handle` | Review/dismiss/action reports. |
| `GET /api/admin/audit` | Audit trail (logins, admin actions, mode changes, provider toggles). |
| `GET /api/admin/payments` | Payment integration status + activation checklist. |

## Webhooks

| Method & path | Description |
|---|---|
| `POST /api/webhooks/:provider` | Provider webhook receiver. Unknown provider → 404. Adapters without verified webhook support → 404 `webhook_unsupported` (never fabricates processing). Accepted events are stored with duplicate protection (`UNIQUE(provider_id, external_event_id)`), redacted payloads, and audit entries. Signature verification must be implemented per-provider from official docs before go-live. |

## Rate limits (fixed-window, D1-backed)

| Action | Limit |
|---|---|
| Register | 8 / 15 min / IP |
| Login | 12 / 15 min / IP, 20 / 15 min / account |
| Admin setup | 5 / 15 min / IP |
| Order create | 20 / min / user |
| Order status poll | 30 / min / user |
| Tickets / replies / abuse reports | 10–20 / hour / user |

## Order state machine

```
pending ──(provider provisions)──► awaiting_sms ──(SMS received)──► completed
   │                                    │
   │                                    ├──(cancel approved / provider failure / TTL expiry)──► refunded
   │                                    └──(cancel, refund denied)──► cancelled
   └──(provisioning failed / insufficient balance)──► failed (charge refunded automatically when one was made)
```

An order is **never** marked successful merely because an HTTP request returned a response — only a provider-confirmed SMS delivery sets `completed`.
