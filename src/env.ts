export interface Env {
  DB: D1Database;
  /** Secret: one-time token required to create the FIRST admin account. Set via `wrangler secret put ADMIN_BOOTSTRAP_TOKEN`. Never committed. */
  ADMIN_BOOTSTRAP_TOKEN?: string;
  /** Secret: NumberOTP API key (only after reseller approval). Never exposed anywhere. */
  NUMBEROTP_API_KEY?: string;
  /** Secret: payment provider webhook signing key (once a provider is chosen). */
  PAYMENT_WEBHOOK_SECRET?: string;
}

export type Role = 'customer' | 'admin';

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  status: 'active' | 'suspended';
}
