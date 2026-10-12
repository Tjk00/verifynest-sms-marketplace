import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Outlet, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, fmtDate, fmtUsd, newIdempotencyKey } from '../api';
import { useAuth } from '../auth';
import { Badge, DashLayout, EmptyState, ErrorAlert, Spinner, StatusBadge, TestBadge, useToast } from '../components';

const LINKS = [
  { to: '', label: 'Overview', end: true },
  { to: 'orders', label: 'Orders' },
  { to: 'orders/new', label: 'New order' },
  { to: 'transactions', label: 'Transactions' },
  { to: 'tickets', label: 'Support' },
  { to: 'security', label: 'Account & security' },
];

export function DashboardLayout() {
  return (
    <DashLayout base="/dashboard/" links={LINKS}>
      <Outlet />
    </DashLayout>
  );
}

interface WalletInfo {
  test: { balanceCents: number; label: string; isTestData: true };
  live: { balanceCents: number; label: string; isTestData: false; depositsEnabled: boolean; depositsNotice?: string };
}

export function useWallet() {
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const load = useCallback(() => api.get<WalletInfo>('/api/wallet').then(setWallet).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  return { wallet, reloadWallet: load };
}

/* ============================ OVERVIEW ============================ */
export function DashOverview() {
  const { user } = useAuth();
  const { wallet } = useWallet();
  const [orders, setOrders] = useState<any[] | null>(null);
  useEffect(() => { api.get<{ orders: any[] }>('/api/orders').then((d) => setOrders(d.orders)).catch(() => setOrders([])); }, []);

  const active = orders?.filter((o) => ['pending', 'awaiting_sms'].includes(o.status)) ?? [];
  const completed = orders?.filter((o) => o.status === 'completed') ?? [];

  return (
    <>
      <h1>Welcome back{user ? `, ${user.email.split('@')[0]}` : ''}</h1>
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="stat">
          <div className="label">TEST balance</div>
          <div className="value">{wallet ? fmtUsd(wallet.test.balanceCents) : '…'}</div>
          <div style={{ marginTop: 4 }}><TestBadge /></div>
        </div>
        <div className="stat">
          <div className="label">Live balance</div>
          <div className="value">{wallet ? fmtUsd(wallet.live.balanceCents) : '…'}</div>
          <div style={{ marginTop: 4 }}><Badge kind={wallet?.live.depositsEnabled ? 'ok' : 'muted'}>{wallet?.live.depositsEnabled ? 'deposits on' : 'deposits off'}</Badge></div>
        </div>
        <div className="stat"><div className="label">Active orders</div><div className="value">{orders ? active.length : '…'}</div></div>
        <div className="stat"><div className="label">Completed</div><div className="value">{orders ? completed.length : '…'}</div></div>
      </div>

      {wallet && !wallet.live.depositsEnabled && wallet.live.depositsNotice && (
        <div className="alert info">{wallet.live.depositsNotice}</div>
      )}

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <h2 style={{ margin: 0 }}>Recent orders</h2>
          <Link className="btn small secondary" to="/dashboard/orders/new">New order</Link>
        </div>
        {orders === null ? <Spinner /> : orders.length === 0
          ? <EmptyState icon="🧾" title="No orders yet" hint={<>Browse the <Link to="/services">catalogue</Link> or create your first test order.</>} />
          : (
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table>
                <thead><tr><th>Created</th><th>Service</th><th>Status</th><th>Price</th><th></th></tr></thead>
                <tbody>
                  {orders.slice(0, 5).map((o) => (
                    <tr key={o.id}>
                      <td>{fmtDate(o.createdAt)}</td>
                      <td>{o.serviceCode} {o.isTestData && <TestBadge />}</td>
                      <td><StatusBadge status={o.status} /></td>
                      <td>{fmtUsd(o.priceCents)}</td>
                      <td><Link className="btn small secondary" to={`/dashboard/orders/${o.id}`}>Open</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </>
  );
}

/* ============================ ORDERS LIST ============================ */
export function OrdersList() {
  const [orders, setOrders] = useState<any[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { api.get<{ orders: any[] }>('/api/orders').then((d) => setOrders(d.orders)).catch(setErr); }, []);
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Your orders</h1>
        <Link className="btn small" to="/dashboard/orders/new">New order</Link>
      </div>
      <ErrorAlert error={err} />
      {!orders && !err && <Spinner />}
      {orders && orders.length === 0 && (
        <EmptyState icon="🧾" title="No orders yet" hint={<>Create your first (test) order from the <Link to="/services">catalogue</Link>.</>} />
      )}
      {orders && orders.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Created</th><th>Service</th><th>Country</th><th>Status</th><th>Price</th><th></th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>{fmtDate(o.createdAt)}</td>
                  <td>{o.serviceCode} {o.isTestData && <TestBadge />}</td>
                  <td className="mono">{o.countryCode}</td>
                  <td><StatusBadge status={o.status} /></td>
                  <td>{fmtUsd(o.priceCents)}</td>
                  <td><Link className="btn small secondary" to={`/dashboard/orders/${o.id}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ============================ NEW ORDER ============================ */
export function NewOrder() {
  const [params] = useSearchParams();
  const [cat, setCat] = useState<any | null>(null);
  const [country, setCountry] = useState(params.get('country') ?? '');
  const [service, setService] = useState(params.get('service') ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const { wallet, reloadWallet } = useWallet();
  const { notify } = useToast();
  const nav = useNavigate();
  const idemKey = useRef(newIdempotencyKey());

  useEffect(() => { api.get('/api/catalog').then(setCat).catch(setErr); }, []);
  if (err) return <><h1>New order</h1><ErrorAlert error={err} /></>;
  if (!cat) return <><h1>New order</h1><Spinner /></>;

  const countries = cat.countries.filter((c: any) => c.available);
  const services = cat.services.filter((s: any) => s.available);
  const price = cat.prices.find((p: any) => p.countryCode === country && p.serviceCode === service);
  const balance = wallet ? (cat.operatingMode === 'test' ? wallet.test.balanceCents : wallet.live.balanceCents) : null;
  const affordable = price && balance !== null ? balance >= price.retailPriceCents : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!price) return;
    setBusy(true); setErr(null);
    try {
      const res = await api.post<{ order: any; error?: any }>('/api/orders', {
        country_code: country, service_code: service, idempotency_key: idemKey.current,
      });
      reloadWallet();
      if (res.error) {
        notify('error', res.error.message);
      } else if (res.order.status === 'refunded' || res.order.status === 'failed') {
        notify('info', `Order failed and was refunded automatically: ${res.order.errorDetail ?? 'provider failure'}`);
      } else {
        notify('success', 'Number provisioned! Waiting for SMS…');
      }
      nav(`/dashboard/orders/${res.order.id}`);
    } catch (e2: any) {
      setErr(e2);
      idemKey.current = newIdempotencyKey(); // a genuinely new attempt gets a fresh key
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>New order</h1>
      {cat.operatingMode === 'test' && (
        <div className="alert warning">
          TEST MODE — you are ordering from the simulator with TEST credits. Numbers and codes are
          fictional TEST DATA; no real SMS is purchased or delivered.
        </div>
      )}
      <div className="card" style={{ maxWidth: 560 }}>
        <form onSubmit={submit}>
          <ErrorAlert error={err} />
          <label className="field">
            <span className="label">Country</span>
            <select value={country} onChange={(e) => setCountry(e.target.value)} required>
              <option value="" disabled>Select a country…</option>
              {countries.map((c: any) => <option key={c.code} value={c.code}>{c.name} {c.isTestData ? '(TEST)' : ''}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="label">Service</span>
            <select value={service} onChange={(e) => setService(e.target.value)} required>
              <option value="" disabled>Select a service…</option>
              {services.map((s: any) => <option key={s.code} value={s.code}>{s.name} {s.isTestData ? '(TEST)' : ''}</option>)}
            </select>
          </label>

          {price && (
            <div className="card" style={{ background: 'var(--bg-alt)', boxShadow: 'none' }}>
              <div className="kv">
                <div className="row"><span className="k">Retail price (server-validated)</span><span className="v">{fmtUsd(price.retailPriceCents)}</span></div>
                <div className="row"><span className="k">Your {cat.operatingMode === 'test' ? 'TEST' : 'wallet'} balance</span><span className="v">{balance !== null ? fmtUsd(balance) : '…'}</span></div>
                <div className="row"><span className="k">Idempotency key</span><span className="v mono" style={{ fontSize: '0.75rem' }}>{idemKey.current}</span></div>
              </div>
              {affordable === false && (
                <div className="alert error" style={{ marginBottom: 0 }}>
                  Insufficient balance. {cat.operatingMode === 'test'
                    ? 'TEST credits can be topped up by an administrator.'
                    : wallet && !wallet.live.depositsEnabled ? 'Live deposits are currently disabled.' : ''}
                </div>
              )}
            </div>
          )}

          <button className="btn" style={{ width: '100%', marginTop: 12 }} disabled={busy || !price || affordable === false}>
            {busy ? 'Placing order…' : 'Confirm & place order'}
          </button>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginTop: 10 }}>
            Retrying or refreshing cannot double-charge you: the idempotency key is validated server-side.
          </p>
        </form>
      </div>
    </>
  );
}

/* ============================ ORDER DETAIL (with polling) ============================ */
export function OrderDetail() {
  const { id } = useParams();
  const [order, setOrder] = useState<any | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const { notify } = useToast();
  const { reloadWallet } = useWallet();

  const load = useCallback(() => {
    api.get<{ order: any }>(`/api/orders/${id}`).then((d) => setOrder(d.order)).catch(setErr);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // Auto-poll while the order is awaiting SMS (server rate-limits polling).
  useEffect(() => {
    if (!order || !['pending', 'awaiting_sms'].includes(order.status)) return;
    const h = setInterval(async () => {
      try {
        const res = await api.post<{ order: any }>(`/api/orders/${id}/check`);
        setOrder(res.order);
        if (res.order.status === 'completed') notify('success', 'SMS code received (see below).');
        if (['refunded', 'failed', 'expired', 'cancelled'].includes(res.order.status)) {
          notify('info', `Order ended: ${res.order.status}. ${res.order.errorDetail ?? ''}`);
          reloadWallet();
        }
      } catch { /* transient polling errors are fine — next tick retries */ }
    }, 5000);
    return () => clearInterval(h);
  }, [order?.status, id, notify, reloadWallet]); // eslint-disable-line react-hooks/exhaustive-deps

  async function checkNow() {
    if (!order) return;
    setBusy(true);
    try {
      const res = await api.post<{ order: any }>(`/api/orders/${order.id}/check`);
      setOrder(res.order);
      if (res.order.status === 'completed') notify('success', 'SMS code received!');
    } catch (e2) { setErr(e2); } finally { setBusy(false); }
  }

  async function cancel() {
    if (!order || !window.confirm('Cancel this order? Refund follows the provider outcome and refund policy.')) return;
    setBusy(true);
    try {
      const res = await api.post<{ order: any }>(`/api/orders/${order.id}/cancel`);
      setOrder(res.order);
      reloadWallet();
      notify('success', 'Order cancelled and refund applied to your ledger.');
    } catch (e2: any) {
      notify('error', e2.message ?? 'Cancellation failed.');
    } finally { setBusy(false); }
  }

  if (err && !order) return <><h1>Order</h1><ErrorAlert error={err} /></>;
  if (!order) return <><h1>Order</h1><Spinner /></>;

  const active = ['pending', 'awaiting_sms'].includes(order.status);

  return (
    <>
      <h1>Order <span className="mono" style={{ fontSize: '1rem' }}>{order.id}</span> {order.isTestData && <TestBadge />}</h1>
      <ErrorAlert error={err} />
      <div className="card">
        <div className="kv">
          <div className="row"><span className="k">Status</span><span className="v"><StatusBadge status={order.status} /></span></div>
          <div className="row"><span className="k">Service / country</span><span className="v mono">{order.serviceCode} @ {order.countryCode}</span></div>
          <div className="row"><span className="k">Price</span><span className="v">{fmtUsd(order.priceCents)}</span></div>
          <div className="row"><span className="k">Phone number</span><span className="v mono">{order.phoneNumber ?? '— not provisioned —'}</span></div>
          <div className="row"><span className="k">Expires</span><span className="v">{fmtDate(order.expiresAt)}</span></div>
          <div className="row"><span className="k">Created</span><span className="v">{fmtDate(order.createdAt)}</span></div>
        </div>
        {order.phoneNumber && active && (
          <>
            {order.isTestData && (
              <div className="alert warning">
                This is a FICTIONAL TEST NUMBER from the simulator. It cannot receive real SMS. Use it
                only to explore the product flow.
              </div>
            )}
            <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>
              Use this number on the target platform, then wait for the code. This page polls
              automatically; the server rate-limits polling.
            </p>
          </>
        )}
        {order.errorDetail && <div className="alert error">{order.errorDetail}</div>}
      </div>

      {order.status === 'completed' && order.smsCode && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Your verification code {order.isTestData && <TestBadge />}</h2>
          {order.isTestData && (
            <div className="alert warning">
              SIMULATED SMS — this code was generated by the Test Mode simulator. It is not a real
              message from any platform and will not work anywhere.
            </div>
          )}
          <div className="sms-code-display" aria-label="SMS code">{order.smsCode}</div>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginTop: 8 }}>
            Received {fmtDate(order.smsReceivedAt)}. Visible only to you. Retained only as long as
            operationally necessary.
          </p>
        </div>
      )}

      {active && (
        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <button className="btn" onClick={checkNow} disabled={busy}>{busy ? 'Working…' : 'Check for SMS now'}</button>
          <button className="btn danger" onClick={cancel} disabled={busy}>Cancel order</button>
        </div>
      )}
      <p style={{ marginTop: 16 }}><Link to="/dashboard/orders">← All orders</Link></p>
    </>
  );
}

/* ============================ TRANSACTIONS ============================ */
export function Transactions() {
  const [entries, setEntries] = useState<any[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { api.get<{ entries: any[] }>('/api/wallet/ledger').then((d) => setEntries(d.entries)).catch(setErr); }, []);
  return (
    <>
      <h1>Transactions</h1>
      <p style={{ color: 'var(--text-dim)' }}>
        Your wallet ledger is append-only — entries can never be edited or deleted, by you or by us
        (database triggers enforce this).
      </p>
      <ErrorAlert error={err} />
      {!entries && !err && <Spinner />}
      {entries && entries.length === 0 && <EmptyState icon="📒" title="No transactions yet" />}
      {entries && entries.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Type</th><th>Wallet</th><th>Amount</th><th>Balance after</th><th>Reason</th></tr></thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i}>
                  <td>{fmtDate(e.createdAt)}</td>
                  <td>{e.entryType.replace(/_/g, ' ')}</td>
                  <td>{e.isTestData ? <TestBadge /> : <Badge kind="live">live</Badge>}</td>
                  <td style={{ color: e.amountCents >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {e.amountCents >= 0 ? '+' : ''}{fmtUsd(e.amountCents)}
                  </td>
                  <td>{fmtUsd(e.balanceAfterCents)}</td>
                  <td style={{ color: 'var(--text-dim)' }}>{e.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ============================ SUPPORT TICKETS ============================ */
export function Tickets() {
  const [tickets, setTickets] = useState<any[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { api.get<{ tickets: any[] }>('/api/support/tickets').then((d) => setTickets(d.tickets)).catch(setErr); }, []);
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Support tickets</h1>
        <Link className="btn small" to="/dashboard/tickets/new">New ticket</Link>
      </div>
      <ErrorAlert error={err} />
      {!tickets && !err && <Spinner />}
      {tickets && tickets.length === 0 && (
        <EmptyState icon="💬" title="No tickets" hint={<>Need help? <Link to="/dashboard/tickets/new">Open a ticket</Link>.</>} />
      )}
      {tickets && tickets.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Opened</th><th>Subject</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {tickets.map((tk) => (
                <tr key={tk.id}>
                  <td>{fmtDate(tk.created_at)}</td>
                  <td>{tk.subject}</td>
                  <td><StatusBadge status={tk.status} /></td>
                  <td><Link className="btn small secondary" to={`/dashboard/tickets/${tk.id}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function NewTicket() {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const { notify } = useToast();
  const nav = useNavigate();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const res = await api.post<{ ticket: { id: string } }>('/api/support/tickets', { subject, message });
      notify('success', 'Ticket created.');
      nav(`/dashboard/tickets/${res.ticket.id}`);
    } catch (e2) { setErr(e2); } finally { setBusy(false); }
  }
  return (
    <>
      <h1>New support ticket</h1>
      <div className="card" style={{ maxWidth: 560 }}>
        <form onSubmit={submit}>
          <ErrorAlert error={err} />
          <label className="field"><span className="label">Subject</span>
            <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} required minLength={3} maxLength={140} /></label>
          <label className="field"><span className="label">Message</span>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} required minLength={3} maxLength={4000} /></label>
          <button className="btn" disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
        </form>
      </div>
    </>
  );
}

export function TicketDetail() {
  const { id } = useParams();
  const [data, setData] = useState<any | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const load = useCallback(() => api.get(`/api/support/tickets/${id}`).then(setData).catch(setErr), [id]);
  useEffect(() => { load(); }, [load]);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { await api.post(`/api/support/tickets/${id}/reply`, { message: reply }); setReply(''); await load(); }
    catch (e2) { setErr(e2); } finally { setBusy(false); }
  }
  if (err && !data) return <><h1>Ticket</h1><ErrorAlert error={err} /></>;
  if (!data) return <><h1>Ticket</h1><Spinner /></>;
  return (
    <>
      <h1>{data.ticket.subject} <StatusBadge status={data.ticket.status} /></h1>
      <ErrorAlert error={err} />
      {data.messages.map((m: any, i: number) => (
        <div className="card" key={i} style={{ borderColor: m.author_role === 'admin' ? 'var(--accent)' : undefined }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: 6 }}>
            <Badge kind={m.author_role === 'admin' ? 'live' : 'muted'}>{m.author_role}</Badge>
            <span>{fmtDate(m.created_at)}</span>
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
        </div>
      ))}
      {data.ticket.status !== 'closed' && (
        <form onSubmit={send} className="card">
          <label className="field" style={{ margin: 0 }}>
            <span className="label">Reply</span>
            <textarea value={reply} onChange={(e) => setReply(e.target.value)} required minLength={1} maxLength={4000} />
          </label>
          <button className="btn" style={{ marginTop: 10 }} disabled={busy}>{busy ? 'Sending…' : 'Send reply'}</button>
        </form>
      )}
      <p><Link to="/dashboard/tickets">← All tickets</Link></p>
    </>
  );
}

/* ============================ ACCOUNT & SECURITY ============================ */
export function Security() {
  const { user } = useAuth();
  const [reportCat, setReportCat] = useState('spam');
  const [reportDetails, setReportDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const { notify } = useToast();

  async function report(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.post('/api/support/abuse-report', { category: reportCat, details: reportDetails });
      notify('success', 'Abuse report submitted. Thank you — administrators will review it.');
      setReportDetails('');
    } catch (e2) { setErr(e2); } finally { setBusy(false); }
  }

  return (
    <>
      <h1>Account & security</h1>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Profile</h2>
        <div className="kv">
          <div className="row"><span className="k">Email</span><span className="v">{user?.email}</span></div>
          <div className="row"><span className="k">Role</span><span className="v">{user?.role}</span></div>
          <div className="row"><span className="k">Status</span><span className="v">{user?.status}</span></div>
        </div>
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>How your account is protected</h2>
        <ul style={{ color: 'var(--text-dim)', fontSize: '0.93rem' }}>
          <li>Passwords are hashed with PBKDF2-SHA256 (100,000 iterations, per-user salt). The hash never leaves the server.</li>
          <li>Sessions use HttpOnly + Secure + SameSite=Lax cookies; only the SHA-256 hash of the session token is stored.</li>
          <li>Sessions expire after 12 hours; suspended accounts lose access immediately.</li>
          <li>Login and registration are rate-limited per IP and per account.</li>
          <li>State-changing API calls require a custom client header plus same-origin checks (CSRF defense).</li>
          <li>Every order, ticket and wallet record is ownership-checked server-side — changing a URL cannot show you someone else's data.</li>
        </ul>
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Report abuse</h2>
        <form onSubmit={report}>
          <ErrorAlert error={err} />
          <label className="field">
            <span className="label">Category</span>
            <select value={reportCat} onChange={(e) => setReportCat(e.target.value)}>
              {['spam', 'fraud', 'impersonation', 'harassment', 'bulk-account-creation', 'safeguard-bypass', 'other'].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="label">Details</span>
            <textarea value={reportDetails} onChange={(e) => setReportDetails(e.target.value)} required minLength={10} maxLength={4000} />
          </label>
          <button className="btn secondary" disabled={busy}>{busy ? 'Submitting…' : 'Submit report'}</button>
        </form>
      </div>
    </>
  );
}
