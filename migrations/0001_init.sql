-- VerifyNest initial schema (Cloudflare D1 / SQLite)
-- All money values are integer cents (USD). All timestamps are ISO-8601 UTC strings.

-- ============================================================
-- Identity & sessions
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,              -- PBKDF2-SHA256, never returned by any API
  role          TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','admin')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- sessions.id stores SHA-256(token); the raw token lives only in the HttpOnly cookie.
CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent   TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

-- ============================================================
-- Providers & catalog (NO SECRETS — secrets live only in Wrangler env)
-- ============================================================
CREATE TABLE IF NOT EXISTS providers (
  id          TEXT PRIMARY KEY,             -- 'test' | 'numberotp' | future adapters
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('test','http')),
  enabled     INTEGER NOT NULL DEFAULT 0,
  config_json TEXT NOT NULL DEFAULT '{}',   -- non-secret config only (endpoint paths, labels)
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS countries (
  id          TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  code        TEXT NOT NULL,                -- provider country code / slug
  name        TEXT NOT NULL,
  iso2        TEXT,
  dial_code   TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  mode        TEXT NOT NULL DEFAULT 'test' CHECK (mode IN ('test','live')),
  created_at  TEXT NOT NULL,
  UNIQUE (provider_id, code)
);
CREATE INDEX IF NOT EXISTS idx_countries_provider ON countries(provider_id, active);

CREATE TABLE IF NOT EXISTS services (
  id          TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  mode        TEXT NOT NULL DEFAULT 'test' CHECK (mode IN ('test','live')),
  created_at  TEXT NOT NULL,
  UNIQUE (provider_id, code)
);
CREATE INDEX IF NOT EXISTS idx_services_provider ON services(provider_id, active);

CREATE TABLE IF NOT EXISTS service_prices (
  id                  TEXT PRIMARY KEY,
  provider_id         TEXT NOT NULL REFERENCES providers(id),
  country_code        TEXT NOT NULL,
  service_code        TEXT NOT NULL,
  provider_cost_cents INTEGER NOT NULL CHECK (provider_cost_cents >= 0),
  markup_percent      REAL    NOT NULL DEFAULT 0,
  retail_price_cents  INTEGER NOT NULL CHECK (retail_price_cents >= 0),
  currency            TEXT NOT NULL DEFAULT 'USD',
  active              INTEGER NOT NULL DEFAULT 1,
  updated_at          TEXT NOT NULL,
  UNIQUE (provider_id, country_code, service_code)
);
CREATE INDEX IF NOT EXISTS idx_prices_lookup ON service_prices(country_code, service_code, active);

-- ============================================================
-- Orders
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id),
  provider_id        TEXT NOT NULL,
  country_code       TEXT NOT NULL,
  service_code       TEXT NOT NULL,
  mode               TEXT NOT NULL CHECK (mode IN ('test','live')),
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','awaiting_sms','completed','cancelled','failed','refunded','expired')),
  price_cents        INTEGER NOT NULL CHECK (price_cents >= 0),
  provider_cost_cents INTEGER NOT NULL DEFAULT 0,
  margin_cents       INTEGER NOT NULL DEFAULT 0,
  phone_number       TEXT,
  provider_order_ref TEXT,
  sms_code           TEXT,                   -- readable only by the order owner / admin
  sms_received_at    TEXT,
  expires_at         TEXT,
  error_detail       TEXT,                   -- safe, user-facing failure text
  provider_state_json TEXT NOT NULL DEFAULT '{}', -- adapter bookkeeping (e.g. poll counts)
  idempotency_key    TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  UNIQUE (user_id, idempotency_key)          -- prevents duplicate purchases / double charges
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_ref ON orders(provider_order_ref);

-- ============================================================
-- Wallet & immutable ledger
-- ============================================================
CREATE TABLE IF NOT EXISTS wallet_accounts (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  kind           TEXT NOT NULL CHECK (kind IN ('test','live')),  -- test credits are never real money
  balance_cents  INTEGER NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (user_id, kind)
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id                TEXT PRIMARY KEY,
  wallet_account_id TEXT NOT NULL REFERENCES wallet_accounts(id),
  user_id           TEXT NOT NULL REFERENCES users(id),
  entry_type        TEXT NOT NULL CHECK (entry_type IN
      ('test_credit','deposit_pending','deposit_approved','order_charge','refund','admin_adjustment')),
  amount_cents      INTEGER NOT NULL,        -- signed: positive = credit, negative = debit
  balance_after_cents INTEGER NOT NULL,
  order_id          TEXT REFERENCES orders(id),
  deposit_id        TEXT,
  reason            TEXT,
  created_by        TEXT NOT NULL DEFAULT 'system',
  idempotency_key   TEXT UNIQUE,             -- DB-level duplicate-entry protection
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_wallet ON ledger_entries(wallet_account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger_entries(user_id, created_at);

-- The ledger is append-only: block UPDATE/DELETE at the database level.
CREATE TRIGGER IF NOT EXISTS ledger_no_update
BEFORE UPDATE ON ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'ledger_entries is append-only');
END;
CREATE TRIGGER IF NOT EXISTS ledger_no_delete
BEFORE DELETE ON ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'ledger_entries is append-only');
END;

CREATE TABLE IF NOT EXISTS deposits (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency     TEXT NOT NULL DEFAULT 'USD',
  channel      TEXT NOT NULL,                 -- payment provider id once configured
  channel_ref  TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','failed','expired')),
  created_at   TEXT NOT NULL,
  verified_at  TEXT,
  UNIQUE (channel, channel_ref)               -- duplicate webhook/event protection
);
CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits(user_id, created_at);

CREATE TABLE IF NOT EXISTS refunds (
  id             TEXT PRIMARY KEY,
  order_id       TEXT NOT NULL REFERENCES orders(id),
  user_id        TEXT NOT NULL REFERENCES users(id),
  amount_cents   INTEGER NOT NULL CHECK (amount_cents > 0),
  reason         TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','failed')),
  ledger_entry_id TEXT,
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds(order_id);

-- ============================================================
-- Support, abuse, audit
-- ============================================================
CREATE TABLE IF NOT EXISTS support_tickets (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  order_id   TEXT REFERENCES orders(id),
  subject    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tickets_user ON support_tickets(user_id, created_at);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id          TEXT PRIMARY KEY,
  ticket_id   TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id   TEXT NOT NULL,
  author_role TEXT NOT NULL CHECK (author_role IN ('customer','admin','system')),
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_ticket ON ticket_messages(ticket_id, created_at);

CREATE TABLE IF NOT EXISTS abuse_reports (
  id             TEXT PRIMARY KEY,
  reporter_id    TEXT REFERENCES users(id),
  target_user_id TEXT REFERENCES users(id),
  order_id       TEXT REFERENCES orders(id),
  category       TEXT NOT NULL,
  details        TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','dismissed','actioned')),
  handled_by     TEXT,
  handled_at     TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT,
  actor_role  TEXT NOT NULL DEFAULT 'system',
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}',    -- must never contain secrets or SMS bodies
  ip          TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_events(actor_id);

-- ============================================================
-- Platform plumbing
-- ============================================================
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT 'system'
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  key           TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  scope         TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  response_json TEXT NOT NULL,
  status_code   INTEGER NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (scope, user_id, key)
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id                TEXT PRIMARY KEY,
  provider_id       TEXT NOT NULL,
  external_event_id TEXT,
  event_type        TEXT,
  payload_json      TEXT NOT NULL DEFAULT '{}', -- redacted
  signature_valid   INTEGER,
  processed         INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  UNIQUE (provider_id, external_event_id)      -- duplicate-event protection
);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket       TEXT PRIMARY KEY,
  hits         INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);

-- ============================================================
-- Seed data (test mode only — everything is explicitly TEST DATA)
-- ============================================================
INSERT OR IGNORE INTO providers (id, name, kind, enabled, config_json, created_at, updated_at)
VALUES ('test', 'VerifyNest Test Simulator', 'test', 1,
        '{"label":"Simulator","note":"Fictional numbers and codes. Clearly labelled TEST DATA. No real SMS is ever sent."}',
        strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'));

INSERT OR IGNORE INTO providers (id, name, kind, enabled, config_json, created_at, updated_at)
VALUES ('numberotp', 'NumberOTP (NOT CONNECTED)', 'http', 0,
        '{"label":"NumberOTP","docs_url":"https://www.numberotp.com/en/docs/api","reseller_agreement_url":"https://www.numberotp.com/reseller-agreement","note":"Disabled until reseller approval, credentials, and endpoint verification against the official docs are complete. No endpoints are implemented from assumption."}',
        strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'));

INSERT OR IGNORE INTO countries (id, provider_id, code, name, iso2, dial_code, active, mode, created_at) VALUES
 ('c-test-us', 'test', 'test-us', 'Testland (US-format)', 'XT', '+999', 1, 'test', strftime('%Y-%m-%dT%H:%M:%SZ','now')),
 ('c-test-uk', 'test', 'test-uk', 'Testland (UK-format)', 'XT', '+998', 1, 'test', strftime('%Y-%m-%dT%H:%M:%SZ','now'));

INSERT OR IGNORE INTO services (id, provider_id, code, name, description, active, mode, created_at) VALUES
 ('s-test-demo',      'test', 'demo',      'Demo Service (instant test code)', 'Simulated service that returns a TEST code on the second status check.', 1, 'test', strftime('%Y-%m-%dT%H:%M:%SZ','now')),
 ('s-test-slow',      'test', 'slow',      'Slow Service (delayed test code)', 'Simulated service that stays awaiting SMS until it expires — demonstrates delayed/timeout handling.', 1, 'test', strftime('%Y-%m-%dT%H:%M:%SZ','now')),
 ('s-test-fail',      'test', 'fail',      'Failing Service (simulated failure)', 'Simulated service where the number request fails — demonstrates automatic refunds.', 1, 'test', strftime('%Y-%m-%dT%H:%M:%SZ','now')),
 ('s-test-social',    'test', 'social-x',  'Social App X (TEST ONLY)', 'Fictional service name. VerifyNest does not promise any real platform accepts temporary numbers.', 1, 'test', strftime('%Y-%m-%dT%H:%M:%SZ','now'));

INSERT OR IGNORE INTO service_prices (id, provider_id, country_code, service_code, provider_cost_cents, markup_percent, retail_price_cents, currency, active, updated_at) VALUES
 ('p-1', 'test', 'test-us', 'demo',     50, 20, 60,  'USD', 1, strftime('%Y-%m-%dT%H:%M:%SZ','now')),
 ('p-2', 'test', 'test-us', 'slow',     40, 20, 48,  'USD', 1, strftime('%Y-%m-%dT%H:%M:%SZ','now')),
 ('p-3', 'test', 'test-us', 'fail',     30, 20, 36,  'USD', 1, strftime('%Y-%m-%dT%H:%M:%SZ','now')),
 ('p-4', 'test', 'test-us', 'social-x', 70, 20, 84,  'USD', 1, strftime('%Y-%m-%dT%H:%M:%SZ','now')),
 ('p-5', 'test', 'test-uk', 'demo',     55, 20, 66,  'USD', 1, strftime('%Y-%m-%dT%H:%M:%SZ','now')),
 ('p-6', 'test', 'test-uk', 'social-x', 75, 20, 90,  'USD', 1, strftime('%Y-%m-%dT%H:%M:%SZ','now'));

INSERT OR IGNORE INTO settings (key, value_json, updated_at, updated_by) VALUES
 ('operating_mode',        '"test"',  strftime('%Y-%m-%dT%H:%M:%SZ','now'), 'system'),
 ('support_email',         '{"address":"verifynest.support@gmail.com","verified":false,"note":"Placeholder. Create and verify this mailbox before displaying it as a working contact."}', strftime('%Y-%m-%dT%H:%M:%SZ','now'), 'system'),
 ('deposits_enabled',      'false',  strftime('%Y-%m-%dT%H:%M:%SZ','now'), 'system'),
 ('payment_provider',      'null',   strftime('%Y-%m-%dT%H:%M:%SZ','now'), 'system'),
 ('default_markup_percent','20',     strftime('%Y-%m-%dT%H:%M:%SZ','now'), 'system'),
 ('max_active_orders_per_user', '5', strftime('%Y-%m-%dT%H:%M:%SZ','now'), 'system'),
 ('test_signup_credit_cents', '500', strftime('%Y-%m-%dT%H:%M:%SZ','now'), 'system'),
 ('test_order_ttl_seconds',   '300', strftime('%Y-%m-%dT%H:%M:%SZ','now'), 'system');
