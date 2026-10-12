# Payment integration — boundary & activation checklist

## Current state: live deposits DISABLED (by design)

No payment provider is configured. `POST /api/wallet/deposits` returns an honest 409 explaining that Test Mode is the way to use VerifyNest right now. The admin settings API **refuses** to enable deposits while `payment_provider` is unset (409 `deposits_blocked`). There is no fake payment verification anywhere in this codebase — a screenshot, a customer message, or a browser redirect is never treated as proof of payment.

## What already exists (the safe boundary)

- `deposits` table with `UNIQUE(channel, channel_ref)` — duplicate provider events can't double-credit.
- Ledger entry types `deposit_pending` / `deposit_approved` ready for two-phase crediting.
- `PAYMENT_WEBHOOK_SECRET` env slot for signature verification.
- Admin "Payments" page showing status + this checklist.
- Wallet/ledger machinery that credits atomically once verification succeeds.

## Activation checklist (ALL required before live deposits)

1. **Choose a provider available in your country.** Common choices for small marketplaces: Stripe (where supported), Paystack/Flutterwave (Africa), Razorpay (India), NOWPayments (crypto). Check three things before committing:
   - Does it approve your business category? (SMS-adjacent services are restricted by some processors — get approved in writing first.)
   - What are the fees? (Typically ~1.5–4% + fixed cents per transaction; crypto processors differ. These reduce margin and must be reflected in your pricing.)
   - What are payout/settlement rules and any reserve/hold requirements?
2. **Create the merchant account and API credentials yourself.** VerifyNest never invents keys. Store them as Workers secrets (`wrangler secret put ...` or dashboard) — never in git or frontend code.
3. **Implement the provider's webhook/callback verification server-side** using its documented signature scheme with `PAYMENT_WEBHOOK_SECRET`. Reject unverified events.
4. **Two-phase crediting:** record `deposit_pending` on webhook receipt; credit the live wallet (`deposit_approved`) only after the provider's API confirms the charge succeeded server-to-server (never from the browser return URL).
5. **Duplicate protection:** store the provider event id in `deposits.channel_ref` (UNIQUE constraint already enforces this).
6. **Reconciliation:** a scheduled routine comparing provider statements against the ledger; document how mismatches are resolved.
7. **Policies published:** Refund Policy must state how real-money refunds work with the chosen provider (including that some rails cannot refund to the original method, in which case wallet credit applies).
8. **Admin enablement:** set `payment_provider` (settings) and only then flip `deposits_enabled`. Both actions are admin-only and audit-logged.

## Fees & costs — honest disclosure

- Payment processing is **never free**: expect per-transaction fees and possibly monthly/rolling reserves depending on provider and risk category.
- Free hosting does not imply free payment processing, and enabling deposits does not change hosting costs.
- Until deposits are enabled, TEST MODE remains fully functional for demonstrating the product, and no customer is asked for money.
