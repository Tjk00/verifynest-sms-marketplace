import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate } from '../api';
import { useAuth } from '../auth';
import { Badge, EmptyState, ErrorAlert, Spinner } from '../components';

/* ============================ HOME ============================ */
export function Home() {
  const { settings, user } = useAuth();
  return (
    <>
      <section className="hero">
        <h1>Your Verification. Your Choice.</h1>
        <p className="tagline">
          VerifyNest is an SMS verification marketplace that shows you the real price up front,
          charges only from your wallet, and refunds automatically when a number doesn't deliver.
        </p>
        {settings?.operatingMode === 'test' && (
          <div className="alert warning" style={{ maxWidth: 640, margin: '0 auto 20px' }}>
            <strong>Currently in TEST MODE.</strong> Every number, order, code and balance is clearly
            labelled simulated TEST DATA. No real SMS inventory is purchased and no real money moves.
            Live purchases stay disabled until an authorized upstream provider is fully connected.
          </div>
        )}
        <div className="cta-row">
          {user
            ? <Link className="btn" to="/dashboard">Go to dashboard</Link>
            : <Link className="btn" to="/register">Create free account</Link>}
          <Link className="btn secondary" to="/services">Browse services</Link>
        </div>
      </section>

      <section style={{ margin: '36px 0' }}>
        <h2 style={{ textAlign: 'center' }}>How VerifyNest works</h2>
        <div className="steps">
          <div className="step">
            <div className="num">1</div>
            <h3>Pick country & service</h3>
            <p style={{ color: 'var(--text-dim)' }}>The catalogue lists only what the configured provider actually supports — never invented inventory.</p>
          </div>
          <div className="step">
            <div className="num">2</div>
            <h3>See the real price, pay from your wallet</h3>
            <p style={{ color: 'var(--text-dim)' }}>Prices are computed server-side. You confirm before anything is charged, and duplicate submissions can't double-charge you.</p>
          </div>
          <div className="step">
            <div className="num">3</div>
            <h3>Get your number & code — or a refund</h3>
            <p style={{ color: 'var(--text-dim)' }}>Poll for the SMS while the number is active. If it fails or expires, the refund is automatic and recorded in your ledger.</p>
          </div>
        </div>
      </section>

      <section className="grid cols-3" style={{ marginBottom: 36 }}>
        <div className="card">
          <h3>🔒 Honest by design</h3>
          <p style={{ color: 'var(--text-dim)' }}>
            No fake success states. If a provider isn't connected, we say so. An order is only marked
            successful when the provider confirms delivery — never because an HTTP call responded.
          </p>
        </div>
        <div className="card">
          <h3>🧪 Test Mode first</h3>
          <p style={{ color: 'var(--text-dim)' }}>
            Every account gets TEST credits to explore the full flow with a clearly labelled simulator —
            no payment details, no real charges, no risk.
          </p>
        </div>
        <div className="card">
          <h3>📒 Transparent ledger</h3>
          <p style={{ color: 'var(--text-dim)' }}>
            An append-only wallet ledger records every credit, charge and refund. Test credits are kept
            strictly separate from real funds and are never withdrawable.
          </p>
        </div>
      </section>

      <section className="card">
        <h2>What we do <em>not</em> promise</h2>
        <ul style={{ color: 'var(--text-dim)' }}>
          <li>We never guarantee that a specific platform (WhatsApp, TikTok, Facebook, Instagram, Telegram, or any other) accepts temporary numbers. Acceptance depends on the provider, the number, the country, and that platform's own policies.</li>
          <li>Free hosting does not mean free SMS inventory, free payment processing, or unlimited traffic. Real inventory and payment processing carry unavoidable costs, disclosed in <Link to="/pricing">Pricing</Link>.</li>
          <li>Gross margin shown to administrators is not guaranteed profit — failures, refunds, fees and support costs all apply.</li>
        </ul>
        <p><Link to="/how-it-works">Read the full guide →</Link></p>
      </section>
    </>
  );
}

/* ============================ HOW IT WORKS ============================ */
export function HowItWorks() {
  return (
    <div className="prose">
      <h1>How it works</h1>
      <h2>1. Create an account</h2>
      <p>Registration is free. Every new account receives TEST credits (clearly labelled TEST DATA — not real money, never withdrawable) so you can try the complete flow in Test Mode.</p>
      <h2>2. Choose a country and a service</h2>
      <p>The catalogue only shows countries and services the currently configured provider actually supports. In Test Mode you'll see fictional "Testland" countries and demo services.</p>
      <h2>3. Review the price and confirm</h2>
      <p>Retail prices are calculated on the server from the provider cost plus the configured markup. You always see the price before confirming. An idempotency key protects you from double charges if you refresh or retry.</p>
      <h2>4. Receive your number</h2>
      <p>Once the backend confirms the provider provisioned a number, it appears in your order with its expiry time. You use it on the third-party platform at your own discretion, subject to our <Link to="/acceptable-use">Acceptable-Use Policy</Link>.</p>
      <h2>5. Poll for your SMS code</h2>
      <p>The order page checks the provider for incoming SMS. Codes are visible only to you — the order owner. An HTTP response alone never marks an order successful; only a provider-confirmed delivery does.</p>
      <h2>6. Cancellations, failures and refunds</h2>
      <p>If the provider fails the request, the number expires without a code, or cancellation is approved, your wallet is refunded automatically and the refund is written to the immutable ledger. The exact rules are in the <Link to="/refund-policy">Refund Policy</Link>.</p>
      <h2>Deposits (currently disabled)</h2>
      <p>Live deposits require a configured, verified payment provider. Until one is connected, live wallets cannot be funded and Test Mode remains the way to use VerifyNest. Nothing is ever credited from a screenshot, a message, or a browser redirect — only from server-side verified payment events.</p>
    </div>
  );
}

/* ============================ FAQ ============================ */
const FAQS: [string, string][] = [
  ['Is VerifyNest free to use?', 'Creating an account and using Test Mode is free. Real SMS numbers cost money — the provider charges us per number, and we add a transparent markup. Hosting on free tiers also has limits (requests/day, DB rows), so VerifyNest cannot promise unlimited free operation. Any unavoidable costs are listed in Pricing.'],
  ['What is Test Mode?', 'A clearly labelled simulator. Numbers, orders, SMS codes and balances are fictional TEST DATA stored separately from live data. Test balances are never withdrawable, transferable, or real money. Test Mode lets you try the whole product before any provider or payment integration is live.'],
  ['Will a temporary number work on WhatsApp / TikTok / Facebook / Instagram / Telegram?', 'Nobody can honestly promise that. Acceptance depends on the upstream provider, the specific number and country, and each platform\'s own policies, which change without notice. VerifyNest never claims guaranteed acceptance for any particular platform.'],
  ['How do refunds work?', 'Automatically, when the provider fails a request, a number expires with no SMS, or a supported cancellation is approved. Refunds are recorded in your immutable ledger. Full rules are in the Refund Policy.'],
  ['Can I deposit real money right now?', 'No. Live deposits stay disabled until a payment provider is selected, its credentials and signed webhooks are verified server-side, and an administrator enables them. Until then, use Test Mode. Payment providers typically charge processing fees and may require account approval — these costs are disclosed before activation.'],
  ['Is my data safe?', 'Passwords are hashed with PBKDF2-SHA256 and never returned by any API. Sessions use HttpOnly, Secure, SameSite cookies with hashed tokens. SMS contents are visible only to the order owner and retained only as long as operationally necessary. Details are in the Privacy Policy.'],
  ['What is prohibited?', 'Fraud, impersonation, harassment, spam, unauthorized account access, circumventing identity checks, unlawful activity, bulk account creation, and anything prohibited by the upstream provider. See the Acceptable-Use Policy — violations lead to suspension and audit-logged enforcement.'],
  ['Is VerifyNest affiliated with NumberOTP or any provider?', 'No. VerifyNest is independent. A provider connection only happens after written reseller-program approval, verified API documentation, and administrator activation. Until then the provider shows as NOT CONNECTED.'],
];

export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="prose">
      <h1>Frequently asked questions</h1>
      {FAQS.map(([q, a], i) => (
        <div className="card" key={q} style={{ cursor: 'pointer' }} onClick={() => setOpen(open === i ? null : i)}
          role="button" aria-expanded={open === i} tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setOpen(open === i ? null : i); }}>
          <h3 style={{ margin: 0 }}>{q}</h3>
          {open === i && <p style={{ marginTop: 10, marginBottom: 0, color: 'var(--text-dim)' }}>{a}</p>}
        </div>
      ))}
    </div>
  );
}

/* ============================ CONTACT ============================ */
export function Contact() {
  const { settings, user } = useAuth();
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null); setDone(false);
    try {
      await api.post('/api/support/tickets', { subject, message });
      setDone(true); setSubject(''); setMessage('');
    } catch (e2) { setErr(e2); } finally { setBusy(false); }
  }

  return (
    <div className="prose">
      <h1>Contact & support</h1>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Support email</h2>
        {settings?.supportEmailConfigured && settings?.supportEmail ? (
          <p><a href={`mailto:${settings.supportEmail}`}>{settings.supportEmail}</a></p>
        ) : (
          <div className="alert info">
            The suggested support address <span className="mono">verifynest.support@gmail.com</span> is a
            placeholder. It must be created and verified by the operator before being published as a
            working contact — until then, use the support form below.
          </div>
        )}
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Open a support ticket</h2>
        {!user ? (
          <div className="alert info">Please <Link to="/login">log in</Link> or <Link to="/register">create an account</Link> to open a support ticket.</div>
        ) : (
          <form onSubmit={submit}>
            <ErrorAlert error={err} />
            {done && <div className="alert success">Ticket created. Track replies in your <Link to="/dashboard/tickets">dashboard</Link>.</div>}
            <label className="field">
              <span className="label">Subject</span>
              <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} required minLength={3} maxLength={140} />
            </label>
            <label className="field">
              <span className="label">Message</span>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} required minLength={3} maxLength={4000} />
            </label>
            <button className="btn" disabled={busy}>{busy ? 'Sending…' : 'Send ticket'}</button>
          </form>
        )}
      </div>
    </div>
  );
}

/* ============================ STATUS ============================ */
interface StatusData {
  ok: boolean;
  settings: { operatingMode: string; depositsEnabled: boolean; supportEmail: string | null };
  providers: { id: string; name: string; connected: boolean; mode: string }[];
  activeOrders: number;
  checkedAt: string;
}

export function StatusPage() {
  const [data, setData] = useState<StatusData | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    api.get<StatusData>('/api/catalog/status').then(setData).catch(setErr);
  }, []);
  if (err) return <><h1>Service status</h1><ErrorAlert error={err} /></>;
  if (!data) return <><h1>Service status</h1><Spinner /></>;
  return (
    <div className="prose">
      <h1>Service status</h1>
      <p style={{ color: 'var(--text-dim)' }}>Last checked: {fmtDate(data.checkedAt)}</p>
      <div className="card">
        <div className="kv">
          <div className="row"><span className="k">API</span><span className="v"><Badge kind={data.ok ? 'ok' : 'err'}>{data.ok ? 'operational' : 'degraded'}</Badge></span></div>
          <div className="row"><span className="k">Operating mode</span><span className="v"><Badge kind={data.settings.operatingMode === 'test' ? 'test' : 'live'}>{data.settings.operatingMode}</Badge></span></div>
          <div className="row"><span className="k">Live deposits</span><span className="v">{data.settings.depositsEnabled ? 'enabled' : 'disabled (no payment provider configured)'}</span></div>
          <div className="row"><span className="k">Active orders</span><span className="v">{data.activeOrders}</span></div>
        </div>
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Providers</h2>
        <div className="kv">
          {data.providers.map((p) => (
            <div className="row" key={p.id}>
              <span className="k">{p.name}</span>
              <span className="v"><Badge kind={p.connected ? 'ok' : 'muted'}>{p.connected ? 'connected' : 'not connected'}</Badge></span>
            </div>
          ))}
        </div>
        {data.providers.some((p) => !p.connected) && (
          <div className="alert info" style={{ marginBottom: 0 }}>
            "Not connected" providers are honestly reported as unavailable — VerifyNest never pretends a
            provider is live before credentials, verified endpoints, and (where required) reseller
            approval are in place.
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================ LEGAL ============================ */
function LegalShell({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="prose">
      <h1>{title}</h1>
      <p style={{ color: 'var(--text-dim)' }}>Last updated: {updated}</p>
      {children}
    </div>
  );
}

import type { ReactNode } from 'react';

export function Terms() {
  return (
    <LegalShell title="Terms of service" updated="2026-10-12">
      <h2>1. The service</h2>
      <p>VerifyNest ("the Service") is a marketplace for temporary SMS verification numbers sourced from upstream providers that explicitly authorize reseller distribution. The Service is operated in TEST MODE until a provider integration is authorized, verified, and enabled by the operator.</p>
      <h2>2. Accounts</h2>
      <p>You must provide a valid email and keep your credentials secure. One person may not operate bulk accounts. Accounts used for prohibited purposes are suspended with an audit record.</p>
      <h2>3. No guaranteed acceptance</h2>
      <p>The Service does not guarantee that any third-party platform accepts a temporary number. Availability and acceptance depend on the upstream provider, the number, the country, and the third party's policies. Purchases are for number rental only.</p>
      <h2>4. Wallets and test credits</h2>
      <p>Live wallet funds (once deposits are enabled) may only be used for purchases on the Service. TEST credits are simulated, have no monetary value, are never withdrawable or transferable, and exist only to exercise Test Mode.</p>
      <h2>5. Prohibited use</h2>
      <p>Use of the Service is subject to the <Link to="/acceptable-use">Acceptable-Use Policy</Link>, which is incorporated into these Terms.</p>
      <h2>6. Disclaimer and liability</h2>
      <p>The Service is provided "as is" without warranties of any kind. To the maximum extent permitted by law, the operator's liability is limited to the amounts you paid for the specific order giving rise to a claim.</p>
      <h2>7. Changes</h2>
      <p>These Terms may change; material changes are announced in-app. Continued use after changes constitutes acceptance.</p>
      <h2>8. Contact</h2>
      <p>See the <Link to="/contact">Contact page</Link> for the current support channel.</p>
    </LegalShell>
  );
}

export function Privacy() {
  return (
    <LegalShell title="Privacy policy" updated="2026-10-12">
      <h2>Data we collect (minimal by design)</h2>
      <ul>
        <li><strong>Account:</strong> email address and a PBKDF2-SHA256 password hash. Passwords are never stored or logged in plain text and hashes are never exposed by any API.</li>
        <li><strong>Orders:</strong> the country/service you select, the provider order reference, the provisioned number, order status, and — only while operationally necessary — the received SMS code and message text.</li>
        <li><strong>Wallet:</strong> an append-only ledger of credits, charges and refunds (amounts and reasons).</li>
        <li><strong>Support:</strong> tickets and messages you submit.</li>
        <li><strong>Security:</strong> session records (token hashes, expiry), rate-limit counters, and administrator audit events. IP addresses are processed only for rate limiting and audit purposes.</li>
      </ul>
      <h2>SMS content retention</h2>
      <p>SMS codes are visible only to the order owner (and, where required to resolve support issues, administrators acting under audit). They are retained only as long as operationally necessary and can be purged on request.</p>
      <h2>What we never do</h2>
      <ul>
        <li>We never sell your personal data.</li>
        <li>We never expose provider API secrets, password hashes, or session tokens to the browser.</li>
        <li>We never log full authentication tokens, API keys, or sensitive SMS contents.</li>
      </ul>
      <h2>Cookies</h2>
      <p>A single strictly necessary session cookie (HttpOnly, Secure, SameSite=Lax) keeps you logged in. There are no advertising or tracking cookies.</p>
      <h2>Your rights</h2>
      <p>You can request export or deletion of your data via a support ticket. Deletion removes personal identifiers except where retention is legally required (e.g. financial records).</p>
    </LegalShell>
  );
}

export function RefundPolicy() {
  return (
    <LegalShell title="Refund policy" updated="2026-10-12">
      <h2>Automatic refunds</h2>
      <ul>
        <li><strong>Provisioning failure:</strong> if the provider fails to provision a number, the charge is refunded automatically and immediately.</li>
        <li><strong>Expiry without SMS:</strong> if the number expires before any SMS arrives, the charge is refunded automatically.</li>
        <li><strong>Provider-reported failure:</strong> if the provider reports the order failed, the charge is refunded automatically.</li>
        <li><strong>Supported cancellation:</strong> if you cancel before a code is delivered and the provider approves the cancellation, the charge is refunded.</li>
      </ul>
      <h2>No refund</h2>
      <ul>
        <li>A code was delivered to the order (the service was rendered).</li>
        <li>The third-party platform rejected the number — platform acceptance is never guaranteed (see Terms §3).</li>
        <li>Violations of the <Link to="/acceptable-use">Acceptable-Use Policy</Link>.</li>
      </ul>
      <h2>TEST MODE</h2>
      <p>Refunds in Test Mode move TEST credits only. TEST credits are simulated, have no monetary value, and are never converted to real money or withdrawn.</p>
      <h2>Real-money deposits</h2>
      <p>Live deposits are disabled until a verified payment provider is configured. Once enabled, deposit refund rules and any processing fees are disclosed before you pay. Refunds to payment methods follow the configured provider's capabilities; where provider refunds are impossible, wallet credit is issued instead.</p>
      <h2>Disputes</h2>
      <p>Open a support ticket with the order ID. Administrators can issue manual refunds with a recorded reason; every refund is written to the immutable ledger and the audit log.</p>
    </LegalShell>
  );
}

export function AcceptableUse() {
  return (
    <LegalShell title="Acceptable-use policy" updated="2026-10-12">
      <h2>Prohibited activities</h2>
      <ul>
        <li>Fraud of any kind, including payment fraud and account takeovers.</li>
        <li>Impersonation of other people or organizations.</li>
        <li>Harassment, hate, or abuse directed at individuals or groups.</li>
        <li>Spam, unsolicited bulk messaging, or artificial engagement.</li>
        <li>Unauthorized access to accounts or systems (yours or anyone else's).</li>
        <li>Circumvention of identity-verification or know-your-customer checks.</li>
        <li>Any unlawful activity in your jurisdiction or ours.</li>
        <li>Anything prohibited by the upstream provider's terms or reseller agreement.</li>
        <li>Prohibited bulk account creation on third-party platforms.</li>
        <li>Attempts to bypass VerifyNest safeguards (rate limits, purchase limits, role checks, idempotency protections).</li>
      </ul>
      <h2>Enforcement</h2>
      <p>Violations may result in order cancellation, account suspension, loss of wallet funds where legally permitted, and referral to authorities. Every enforcement action is recorded in an administrator audit log. You can report abuse through your dashboard; reports are reviewed by administrators.</p>
      <h2>Platform acceptance</h2>
      <p>Using VerifyNest numbers does not entitle you to violate a third-party platform's terms of service. Whether a platform accepts a temporary number is entirely that platform's decision, and VerifyNest makes no promise on its behalf.</p>
    </LegalShell>
  );
}
