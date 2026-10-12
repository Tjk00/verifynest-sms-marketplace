import { useCallback, useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { api, fmtDate, fmtUsd } from '../api';
import { Badge, DashLayout, EmptyState, ErrorAlert, Spinner, StatusBadge, useToast } from '../components';

const LINKS = [
  { to: '', label: 'Overview', end: true },
  { to: 'users', label: 'Customers' },
  { to: 'orders', label: 'Orders' },
  { to: 'providers', label: 'Provider diagnostics' },
  { to: 'pricing', label: 'Pricing & limits' },
  { to: 'ledger', label: 'Wallet ledger' },
  { to: 'tickets', label: 'Support tickets' },
  { to: 'abuse', label: 'Abuse reports' },
  { to: 'audit', label: 'Audit log' },
  { to: 'payments', label: 'Payments' },
  { to: 'settings', label: 'Settings & test mode' },
];

export function AdminLayout() {
  return (
    <DashLayout base="/admin/" links={LINKS}>
      <Outlet />
    </DashLayout>
  );
}

function useLoad<T>(path: string): { data: T | null; err: unknown; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { api.get<T>(path).then(setData).catch(setErr); }, [path, tick]);
  return { data, err, reload: () => setTick((t) => t + 1) };
}

/* ============================ OVERVIEW ============================ */
export function AdminOverview() {
  const { data, err } = useLoad<any>('/api/admin/overview');
  if (err) return <><h1>Overview</h1><ErrorAlert error={err} /></>;
  if (!data) return <><h1>Overview</h1><Spinner /></>;
  return (
    <>
      <h1>System overview</h1>
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="stat"><div className="label">Operating mode</div>
          <div className="value"><Badge kind={data.settings.operatingMode === 'test' ? 'test' : 'live'}>{data.settings.operatingMode}</Badge></div></div>
        <div className="stat"><div className="label">Customers</div><div className="value">{data.customers}</div></div>
        <div className="stat"><div className="label">Open tickets</div><div className="value">{data.openTickets}</div></div>
        <div className="stat"><div className="label">Open abuse reports</div><div className="value">{data.openAbuseReports}</div></div>
      </div>
      <div className="grid cols-2">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Orders by status</h2>
          {data.ordersByStatus.length === 0 ? <EmptyState icon="📦" title="No orders yet" /> : (
            <div className="kv">
              {data.ordersByStatus.map((o: any) => (
                <div className="row" key={o.status}><span className="k"><StatusBadge status={o.status} /></span><span className="v">{o.n}</span></div>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Revenue (provisioned orders)</h2>
          <div className="kv">
            <div className="row"><span className="k">Gross charged</span><span className="v">{fmtUsd(data.grossRevenueCents)}</span></div>
            <div className="row"><span className="k">Gross margin</span><span className="v">{fmtUsd(data.grossMarginCents)}</span></div>
          </div>
          <div className="alert warning" style={{ fontSize: '0.85rem' }}>{data.marginNote}</div>
        </div>
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Deposits</h2>
        <p>{data.settings.depositsEnabled
          ? 'Enabled.'
          : 'DISABLED — no payment provider is configured. Customers can use TEST MODE with TEST credits. See the Payments page for the activation checklist.'}</p>
      </div>
    </>
  );
}

/* ============================ USERS ============================ */
export function AdminUsers() {
  const { data, err, reload } = useLoad<{ users: any[] }>('/api/admin/users');
  const { notify } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [grantUserId, setGrantUserId] = useState('');
  const [grantAmount, setGrantAmount] = useState(500);

  async function setStatus(id: string, status: 'active' | 'suspended') {
    if (!window.confirm(`${status === 'suspended' ? 'Suspend' : 'Reactivate'} this user? Suspension kills their sessions immediately and is audit-logged.`)) return;
    setBusyId(id);
    try { await api.post(`/api/admin/users/${id}/status`, { status }); notify('success', `User ${status}.`); reload(); }
    catch (e: any) { notify('error', e.message); } finally { setBusyId(null); }
  }

  async function grantTestCredit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post('/api/admin/test-credit', { user_id: grantUserId, amount_cents: grantAmount });
      notify('success', `Granted ${fmtUsd(grantAmount)} TEST credits (audit-logged).`);
    } catch (e: any) { notify('error', e.message); }
  }

  if (err) return <><h1>Customers</h1><ErrorAlert error={err} /></>;
  if (!data) return <><h1>Customers</h1><Spinner /></>;
  return (
    <>
      <h1>Customer accounts</h1>
      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Grant TEST credits (Test Mode control)</h2>
        <form onSubmit={grantTestCredit} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="field" style={{ margin: 0, flex: '1 1 220px' }}><span className="label">User ID</span>
            <input type="text" value={grantUserId} onChange={(e) => setGrantUserId(e.target.value)} required /></label>
          <label className="field" style={{ margin: 0, width: 140 }}><span className="label">Cents</span>
            <input type="number" min={1} max={1000000} value={grantAmount} onChange={(e) => setGrantAmount(Number(e.target.value))} required /></label>
          <button className="btn secondary" type="submit">Grant (TEST)</button>
        </form>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem', marginTop: 8 }}>
          TEST credits are simulator funds — never withdrawable, transferable, or real money. Every grant is audit-logged with your admin ID.
        </p>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Joined</th><th>User ID</th><th>Actions</th></tr></thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td><Badge kind={u.role === 'admin' ? 'live' : 'muted'}>{u.role}</Badge></td>
                <td><StatusBadge status={u.status} /></td>
                <td>{fmtDate(u.created_at)}</td>
                <td className="mono" style={{ fontSize: '0.72rem' }}>{u.id}</td>
                <td>
                  {u.status === 'active'
                    ? <button className="btn small danger" disabled={busyId === u.id} onClick={() => setStatus(u.id, 'suspended')}>Suspend</button>
                    : <button className="btn small secondary" disabled={busyId === u.id} onClick={() => setStatus(u.id, 'active')}>Reactivate</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ============================ ORDERS + REFUNDS ============================ */
export function AdminOrders() {
  const [filter, setFilter] = useState('');
  const { data, err, reload } = useLoad<{ orders: any[] }>(`/api/admin/orders${filter ? `?status=${filter}` : ''}`);
  const { notify } = useToast();
  const [refundOrder, setRefundOrder] = useState('');
  const [refundReason, setRefundReason] = useState('');

  async function refund(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post('/api/admin/refunds', { order_id: refundOrder, reason: refundReason });
      notify('success', 'Refund issued and audit-logged.');
      setRefundOrder(''); setRefundReason(''); reload();
    } catch (e2: any) { notify('error', e2.message); }
  }

  return (
    <>
      <h1>Order management</h1>
      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Manual refund</h2>
        <form onSubmit={refund} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="field" style={{ margin: 0, flex: '1 1 200px' }}><span className="label">Order ID</span>
            <input type="text" value={refundOrder} onChange={(e) => setRefundOrder(e.target.value)} required /></label>
          <label className="field" style={{ margin: 0, flex: '2 1 260px' }}><span className="label">Reason (required, audit-logged)</span>
            <input type="text" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} required minLength={5} maxLength={500} /></label>
          <button className="btn" type="submit">Issue refund</button>
        </form>
      </div>
      <label className="field" style={{ maxWidth: 280 }}>
        <span className="label">Filter by status</span>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All</option>
          {['pending', 'awaiting_sms', 'completed', 'cancelled', 'failed', 'refunded', 'expired'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <ErrorAlert error={err} />
      {!data && !err && <Spinner />}
      {data && data.orders.length === 0 && <EmptyState icon="📦" title="No orders match" />}
      {data && data.orders.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Created</th><th>Customer</th><th>Service</th><th>Status</th><th>Price</th><th>Cost</th><th>Margin</th><th>Mode</th><th>Number</th></tr></thead>
            <tbody>
              {data.orders.map((o) => (
                <tr key={o.id}>
                  <td>{fmtDate(o.createdAt)}</td>
                  <td>{o.userEmail}</td>
                  <td className="mono">{o.serviceCode}@{o.countryCode}</td>
                  <td><StatusBadge status={o.status} />{o.errorDetail && <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>{o.errorDetail}</div>}</td>
                  <td>{fmtUsd(o.priceCents)}</td>
                  <td>{fmtUsd(o.providerCostCents)}</td>
                  <td>{fmtUsd(o.marginCents)}</td>
                  <td>{o.mode === 'test' ? <Badge kind="test">test</Badge> : <Badge kind="live">live</Badge>}</td>
                  <td className="mono">{o.phoneNumber ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ============================ PROVIDER DIAGNOSTICS ============================ */
export function AdminProviders() {
  const { data, err, reload } = useLoad<any>('/api/admin/providers/diagnostics');
  const { notify } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(pid: string, enabled: boolean) {
    const msg = enabled
      ? 'Enable this provider? Only enable a live provider after reseller approval, verified endpoints, and secrets are configured.'
      : 'Disable this provider immediately? This takes effect at once and is audit-logged.';
    if (!window.confirm(msg)) return;
    setBusy(pid);
    try { await api.post(`/api/admin/providers/${pid}/enabled`, { enabled }); notify('success', enabled ? 'Provider enabled (audit-logged).' : 'Provider disabled immediately (audit-logged).'); reload(); }
    catch (e: any) { notify('error', e.message); } finally { setBusy(null); }
  }

  if (err) return <><h1>Provider diagnostics</h1><ErrorAlert error={err} /></>;
  if (!data) return <><h1>Provider diagnostics</h1><Spinner /></>;
  return (
    <>
      <h1>Provider diagnostics</h1>
      <div className="alert info">{data.secretPolicy}</div>
      {data.providers.map((p: any) => (
        <div className="card" key={p.providerId}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>{p.displayName}</h2>
            <span>
              <Badge kind={p.enabled ? 'ok' : 'muted'}>{p.enabled ? 'enabled' : 'disabled'}</Badge>{' '}
              <Badge kind={p.mode === 'test' ? 'test' : 'live'}>{p.mode}</Badge>
            </span>
          </div>
          <div className="kv" style={{ marginTop: 12 }}>
            <div className="row"><span className="k">Credentials configured (secret present)</span><span className="v">{String(p.credentialsConfigured)}</span></div>
            <div className="row"><span className="k">Endpoints verified against official docs</span><span className="v">{String(p.endpointsVerified)}</span></div>
            <div className="row"><span className="k">Reseller approval confirmed</span><span className="v">{String(p.resellerApprovalConfirmed)}</span></div>
            <div className="row"><span className="k">Supported operations</span><span className="v">{p.supportedOperations.length ? p.supportedOperations.join(', ') : 'none'}</span></div>
          </div>
          {p.unsupportedOperations.length > 0 && (
            <>
              <h3 style={{ marginTop: 14 }}>Unsupported operations (reported honestly)</h3>
              <ul style={{ color: 'var(--text-dim)', fontSize: '0.88rem' }}>
                {p.unsupportedOperations.map((u: any) => <li key={u.operation}><span className="mono">{u.operation}</span> — {u.reason}</li>)}
              </ul>
            </>
          )}
          {p.notes.length > 0 && (
            <ul style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
              {p.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}
            </ul>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn small danger" disabled={busy === p.providerId || p.enabled === false} onClick={() => toggle(p.providerId, false)}>Disable immediately</button>
            <button className="btn small secondary" disabled={busy === p.providerId || p.enabled === true || p.mode === 'live' && (!p.credentialsConfigured || !p.endpointsVerified)}
              onClick={() => toggle(p.providerId, true)}>Enable</button>
          </div>
        </div>
      ))}
    </>
  );
}

/* ============================ PRICING & LIMITS ============================ */
export function AdminPricing() {
  const { notify } = useToast();
  const [form, setForm] = useState({ provider_id: 'test', country_code: 'test-us', service_code: 'demo', provider_cost_cents: 50, markup_percent: 20 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const res = await api.post<any>('/api/admin/prices', form);
      notify('success', `Price set: retail ${fmtUsd(res.retailPriceCents)} (cost ${fmtUsd(res.providerCostCents)} + ${res.markupPercent}% markup).`);
    } catch (e2) { setErr(e2); } finally { setBusy(false); }
  }
  return (
    <>
      <h1>Retail pricing & purchase limits</h1>
      <div className="card" style={{ maxWidth: 620 }}>
        <h2 style={{ marginTop: 0 }}>Set price for a country/service pair</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.88rem' }}>
          Retail = provider cost × (1 + markup%). Customers always see the server-computed price before confirming.
          Cost and margin per order are recorded for accounting.
        </p>
        <form onSubmit={submit}>
          <ErrorAlert error={err} />
          <label className="field"><span className="label">Provider</span>
            <select value={form.provider_id} onChange={(e) => setForm({ ...form, provider_id: e.target.value })}>
              <option value="test">test (simulator)</option>
              <option value="numberotp">numberotp</option>
            </select></label>
          <label className="field"><span className="label">Country code</span>
            <input type="text" value={form.country_code} onChange={(e) => setForm({ ...form, country_code: e.target.value })} required /></label>
          <label className="field"><span className="label">Service code</span>
            <input type="text" value={form.service_code} onChange={(e) => setForm({ ...form, service_code: e.target.value })} required /></label>
          <div style={{ display: 'flex', gap: 10 }}>
            <label className="field" style={{ flex: 1 }}><span className="label">Provider cost (cents)</span>
              <input type="number" min={0} value={form.provider_cost_cents} onChange={(e) => setForm({ ...form, provider_cost_cents: Number(e.target.value) })} required /></label>
            <label className="field" style={{ flex: 1 }}><span className="label">Markup %</span>
              <input type="number" min={0} max={500} value={form.markup_percent} onChange={(e) => setForm({ ...form, markup_percent: Number(e.target.value) })} required /></label>
          </div>
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save price'}</button>
        </form>
      </div>
      <div className="card" style={{ maxWidth: 620 }}>
        <h2 style={{ marginTop: 0 }}>Purchase limits</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>
          Active-order limits, rate limits and signup credits are configured on the <em>Settings & test mode</em> page.
        </p>
      </div>
    </>
  );
}

/* ============================ LEDGER ============================ */
export function AdminLedger() {
  const { data, err } = useLoad<{ entries: any[] }>('/api/admin/ledger');
  const [adj, setAdj] = useState({ user_id: '', wallet_kind: 'test', amount_cents: 100, reason: '' });
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);
  async function adjust(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/admin/wallet-adjust', adj);
      notify('success', 'Adjustment applied and audit-logged.');
      setAdj({ ...adj, reason: '' });
      window.location.reload();
    } catch (e2: any) { notify('error', e2.message); } finally { setBusy(false); }
  }
  return (
    <>
      <h1>Wallet ledger inspection</h1>
      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Administrative adjustment</h2>
        <form onSubmit={adjust} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="field" style={{ margin: 0, flex: '1 1 180px' }}><span className="label">User ID</span>
            <input type="text" value={adj.user_id} onChange={(e) => setAdj({ ...adj, user_id: e.target.value })} required /></label>
          <label className="field" style={{ margin: 0, width: 120 }}><span className="label">Wallet</span>
            <select value={adj.wallet_kind} onChange={(e) => setAdj({ ...adj, wallet_kind: e.target.value })}>
              <option value="test">test</option><option value="live">live</option>
            </select></label>
          <label className="field" style={{ margin: 0, width: 120 }}><span className="label">Amount (cents, ±)</span>
            <input type="number" value={adj.amount_cents} onChange={(e) => setAdj({ ...adj, amount_cents: Number(e.target.value) })} required /></label>
          <label className="field" style={{ margin: 0, flex: '2 1 240px' }}><span className="label">Reason (required)</span>
            <input type="text" value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} required minLength={5} maxLength={500} /></label>
          <button className="btn" type="submit" disabled={busy}>{busy ? 'Applying…' : 'Apply'}</button>
        </form>
      </div>
      <ErrorAlert error={err} />
      {!data && !err && <Spinner />}
      {data && data.entries.length === 0 && <EmptyState icon="📒" title="No ledger entries yet" />}
      {data && data.entries.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>User</th><th>Type</th><th>Amount</th><th>Balance after</th><th>Reason</th><th>By</th></tr></thead>
            <tbody>
              {data.entries.map((e: any) => (
                <tr key={e.id}>
                  <td>{fmtDate(e.created_at)}</td>
                  <td>{e.email}</td>
                  <td>{e.entry_type.replace(/_/g, ' ')}</td>
                  <td style={{ color: e.amount_cents >= 0 ? 'var(--success)' : 'var(--danger)' }}>{e.amount_cents >= 0 ? '+' : ''}{fmtUsd(e.amount_cents)}</td>
                  <td>{fmtUsd(e.balance_after_cents)}</td>
                  <td style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>{e.reason ?? '—'}</td>
                  <td className="mono" style={{ fontSize: '0.72rem' }}>{e.created_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ============================ TICKETS ============================ */
export function AdminTickets() {
  const { data, err, reload } = useLoad<{ tickets: any[] }>('/api/admin/tickets');
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [reply, setReply] = useState('');
  const { notify } = useToast();

  useEffect(() => {
    if (openId) api.get(`/api/admin/tickets/${openId}`).then(setDetail).catch(() => setDetail(null));
    else setDetail(null);
  }, [openId, data]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    try { await api.post(`/api/admin/tickets/${openId}/reply`, { message: reply }); setReply(''); notify('success', 'Reply sent.'); reload(); }
    catch (e2: any) { notify('error', e2.message); }
  }
  async function close() {
    try { await api.post(`/api/admin/tickets/${openId}/close`); notify('success', 'Ticket closed.'); reload(); }
    catch (e2: any) { notify('error', e2.message); }
  }

  return (
    <>
      <h1>Support tickets</h1>
      <ErrorAlert error={err} />
      {!data && !err && <Spinner />}
      {data && data.tickets.length === 0 && <EmptyState icon="💬" title="No tickets" />}
      {data && data.tickets.length > 0 && (
        <div className="table-wrap" style={{ marginBottom: 16 }}>
          <table>
            <thead><tr><th>Opened</th><th>Customer</th><th>Subject</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {data.tickets.map((tk: any) => (
                <tr key={tk.id}>
                  <td>{fmtDate(tk.created_at)}</td>
                  <td>{tk.email}</td>
                  <td>{tk.subject}</td>
                  <td><StatusBadge status={tk.status} /></td>
                  <td><button className="btn small secondary" onClick={() => setOpenId(tk.id)}>View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {openId && detail && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{detail.ticket.subject}</h2>
          {detail.messages.map((m: any, i: number) => (
            <div key={i} style={{ borderBottom: '1px dashed var(--border)', padding: '10px 0' }}>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}><Badge kind={m.author_role === 'admin' ? 'live' : 'muted'}>{m.author_role}</Badge> {fmtDate(m.created_at)}</div>
              <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{m.body}</div>
            </div>
          ))}
          {detail.ticket.status !== 'closed' && (
            <form onSubmit={send} style={{ marginTop: 12 }}>
              <textarea value={reply} onChange={(e) => setReply(e.target.value)} required minLength={1} maxLength={4000} placeholder="Write a reply…" />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn" type="submit">Send reply</button>
                <button className="btn danger" type="button" onClick={close}>Close ticket</button>
              </div>
            </form>
          )}
        </div>
      )}
    </>
  );
}

/* ============================ ABUSE ============================ */
export function AdminAbuse() {
  const { data, err, reload } = useLoad<{ reports: any[] }>('/api/admin/abuse-reports');
  const { notify } = useToast();
  async function handle(id: string, status: 'reviewed' | 'dismissed' | 'actioned') {
    try { await api.post(`/api/admin/abuse-reports/${id}/handle`, { status }); notify('success', `Report marked ${status}.`); reload(); }
    catch (e: any) { notify('error', e.message); }
  }
  return (
    <>
      <h1>Abuse reports</h1>
      <ErrorAlert error={err} />
      {!data && !err && <Spinner />}
      {data && data.reports.length === 0 && <EmptyState icon="🛡️" title="No abuse reports" />}
      {data && data.reports.map((r: any) => (
        <div className="card" key={r.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <strong>{r.category}</strong>
            <StatusBadge status={r.status} />
          </div>
          <p style={{ whiteSpace: 'pre-wrap', color: 'var(--text-dim)' }}>{r.details}</p>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>{fmtDate(r.created_at)}</div>
          {r.status === 'open' && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="btn small secondary" onClick={() => handle(r.id, 'reviewed')}>Mark reviewed</button>
              <button className="btn small secondary" onClick={() => handle(r.id, 'dismissed')}>Dismiss</button>
              <button className="btn small danger" onClick={() => handle(r.id, 'actioned')}>Mark actioned</button>
            </div>
          )}
        </div>
      ))}
    </>
  );
}

/* ============================ AUDIT ============================ */
export function AdminAudit() {
  const { data, err } = useLoad<{ events: any[] }>('/api/admin/audit');
  return (
    <>
      <h1>Audit log</h1>
      <p style={{ color: 'var(--text-dim)' }}>Sensitive administrator actions are recorded here: mode changes, provider toggles, refunds, adjustments, suspensions, logins.</p>
      <ErrorAlert error={err} />
      {!data && !err && <Spinner />}
      {data && data.events.length === 0 && <EmptyState icon="🧾" title="No audit events yet" />}
      {data && data.events.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Detail</th><th>IP</th></tr></thead>
            <tbody>
              {data.events.map((e: any) => (
                <tr key={e.id}>
                  <td>{fmtDate(e.created_at)}</td>
                  <td className="mono" style={{ fontSize: '0.75rem' }}>{e.actor_role}{e.actor_id ? `:${e.actor_id.slice(0, 8)}` : ''}</td>
                  <td>{e.action}</td>
                  <td className="mono" style={{ fontSize: '0.75rem' }}>{e.target_type ? `${e.target_type}:${(e.target_id ?? '').slice(0, 10)}` : '—'}</td>
                  <td style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>{e.detail_json}</td>
                  <td className="mono" style={{ fontSize: '0.75rem' }}>{e.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ============================ PAYMENTS ============================ */
export function AdminPayments() {
  const { data, err } = useLoad<any>('/api/admin/payments');
  if (err) return <><h1>Payments</h1><ErrorAlert error={err} /></>;
  if (!data) return <><h1>Payments</h1><Spinner /></>;
  return (
    <>
      <h1>Payment integration status</h1>
      <div className="card">
        <div className="kv">
          <div className="row"><span className="k">Live deposits</span><span className="v"><Badge kind={data.depositsEnabled ? 'ok' : 'muted'}>{data.depositsEnabled ? 'enabled' : 'disabled'}</Badge></span></div>
          <div className="row"><span className="k">Payment provider</span><span className="v">{data.paymentProvider ?? 'none configured'}</span></div>
          <div className="row"><span className="k">Webhook secret present</span><span className="v">{String(data.webhookSecretConfigured)}</span></div>
        </div>
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Activation checklist (all required before live deposits)</h2>
        <ol style={{ color: 'var(--text-dim)' }}>
          {data.activationChecklist.map((item: string, i: number) => <li key={i}>{item}</li>)}
        </ol>
        <div className="alert warning">
          Until every item is complete, live deposits stay disabled and customers are directed to TEST MODE.
          A screenshot, customer message, or browser redirect is NEVER treated as proof of payment.
          Most payment processors charge per-transaction fees and require account approval — confirm the
          real costs for your country before activating.
        </div>
      </div>
    </>
  );
}

/* ============================ SETTINGS & TEST MODE ============================ */
export function AdminSettings() {
  const { data, err, reload } = useLoad<{ settings: any }>('/api/admin/settings');
  const { notify } = useToast();
  const [modeConfirm, setModeConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<any>(null);

  useEffect(() => { if (data && !form) setForm({ ...data.settings }); }, [data, form]);

  const save = useCallback(async (updates: Record<string, unknown>, successMsg: string) => {
    setBusy(true);
    try { const res = await api.put<{ settings: any }>('/api/admin/settings', updates); setForm({ ...res.settings }); notify('success', successMsg); reload(); }
    catch (e: any) { notify('error', e.message); } finally { setBusy(false); }
  }, [notify, reload]);

  if (err) return <><h1>Settings</h1><ErrorAlert error={err} /></>;
  if (!data || !form) return <><h1>Settings</h1><Spinner /></>;

  return (
    <>
      <h1>Application settings & test-mode controls</h1>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Operating mode</h2>
        <p>Current mode: <Badge kind={form.operating_mode === 'test' ? 'test' : 'live'}>{form.operating_mode}</Badge></p>
        {form.operating_mode === 'test' ? (
          <>
            <div className="alert warning">
              Switching to LIVE is blocked by the server unless an upstream provider is enabled with
              verified endpoints and configured credentials. Live mode enables real purchases with real money.
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <label className="field" style={{ margin: 0, flex: '1 1 240px' }}>
                <span className="label">Type <span className="mono">GO-LIVE</span> to attempt the switch</span>
                <input type="text" value={modeConfirm} onChange={(e) => setModeConfirm(e.target.value)} />
              </label>
              <button className="btn danger" disabled={busy || modeConfirm !== 'GO-LIVE'}
                onClick={() => save({ operating_mode: 'live' }, 'Operating mode changed to LIVE (audit-logged).')}>
                Switch to LIVE
              </button>
            </div>
          </>
        ) : (
          <button className="btn secondary" disabled={busy}
            onClick={() => save({ operating_mode: 'test' }, 'Operating mode changed back to TEST (audit-logged).')}>
            Return to TEST MODE
          </button>
        )}
        <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem', marginTop: 8 }}>
          Every operating-mode change requires this explicit authorized action and is written to the audit log.
        </p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Support email</h2>
        <label className="field"><span className="label">Address</span>
          <input type="text" value={form.support_email?.address ?? ''} onChange={(e) => setForm({ ...form, support_email: { ...form.support_email, address: e.target.value } })} /></label>
        <label className="field" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={Boolean(form.support_email?.verified)}
            onChange={(e) => setForm({ ...form, support_email: { ...form.support_email, verified: e.target.checked } })} />
          <span>Mailbox created and verified (only then is it displayed publicly as a working contact)</span>
        </label>
        <button className="btn secondary" disabled={busy} onClick={() => save({ support_email: form.support_email }, 'Support email updated.')}>Save support email</button>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Commerce defaults</h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <label className="field" style={{ flex: '1 1 160px' }}><span className="label">Default markup %</span>
            <input type="number" min={0} max={500} value={form.default_markup_percent} onChange={(e) => setForm({ ...form, default_markup_percent: Number(e.target.value) })} /></label>
          <label className="field" style={{ flex: '1 1 160px' }}><span className="label">Max active orders / user</span>
            <input type="number" min={1} max={100} value={form.max_active_orders_per_user} onChange={(e) => setForm({ ...form, max_active_orders_per_user: Number(e.target.value) })} /></label>
        </div>
        <button className="btn secondary" disabled={busy} onClick={() => save({ default_markup_percent: form.default_markup_percent, max_active_orders_per_user: form.max_active_orders_per_user }, 'Commerce defaults saved.')}>Save defaults</button>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Test-mode controls</h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <label className="field" style={{ flex: '1 1 160px' }}><span className="label">Sign-up TEST credit (cents)</span>
            <input type="number" min={0} max={1000000} value={form.test_signup_credit_cents} onChange={(e) => setForm({ ...form, test_signup_credit_cents: Number(e.target.value) })} /></label>
          <label className="field" style={{ flex: '1 1 160px' }}><span className="label">Test order TTL (seconds)</span>
            <input type="number" min={30} max={86400} value={form.test_order_ttl_seconds} onChange={(e) => setForm({ ...form, test_order_ttl_seconds: Number(e.target.value) })} /></label>
        </div>
        <button className="btn secondary" disabled={busy} onClick={() => save({ test_signup_credit_cents: form.test_signup_credit_cents, test_order_ttl_seconds: form.test_order_ttl_seconds }, 'Test-mode controls saved.')}>Save test-mode controls</button>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem' }}>
          Per-user TEST credit grants are on the <em>Customers</em> page. All grants and adjustments are audit-logged.
        </p>
      </div>
    </>
  );
}
