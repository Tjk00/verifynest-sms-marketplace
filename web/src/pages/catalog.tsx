import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fmtUsd } from '../api';
import { Badge, EmptyState, ErrorAlert, Spinner, TestBadge } from '../components';
import { useAuth } from '../auth';

interface Catalog {
  operatingMode: 'test' | 'live';
  countries: { code: string; name: string; providerId: string; available: boolean; mode: string; isTestData: boolean; dialCode?: string }[];
  services: { code: string; name: string; description?: string; providerId: string; available: boolean; mode: string; isTestData: boolean }[];
  prices: { providerId: string; countryCode: string; serviceCode: string; retailPriceCents: number; mode: string; isTestData: boolean }[];
}

/* ============================ SERVICES (catalogue + country selection) ============================ */
export function Services() {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [country, setCountry] = useState<string>('all');

  useEffect(() => { api.get<Catalog>('/api/catalog').then(setCat).catch(setErr); }, []);
  if (err) return <><h1>Services</h1><ErrorAlert error={err} /></>;
  if (!cat) return <><h1>Services</h1><Spinner label="Loading catalogue…" /></>;

  const visibleServices = cat.services;
  const priceFor = (svc: string) =>
    cat.prices
      .filter((p) => p.serviceCode === svc && (country === 'all' || p.countryCode === country))
      .sort((a, b) => a.retailPriceCents - b.retailPriceCents)[0];

  return (
    <>
      <h1>Services catalogue</h1>
      {cat.operatingMode === 'test' && (
        <div className="alert warning">
          TEST MODE catalogue — the countries and services below belong to the built-in simulator and
          are fictional TEST DATA. Live inventory appears here only after an authorized provider is connected.
        </div>
      )}
      {visibleServices.length === 0 && (
        <EmptyState icon="🗂️" title="No services available"
          hint="No provider is currently offering services. In live mode this means no upstream provider is connected yet — check the status page." />
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <label className="field" style={{ margin: 0, maxWidth: 380 }}>
          <span className="label">Country</span>
          <select value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="all">All countries</option>
            {cat.countries.map((c) => (
              <option key={c.code} value={c.code}>{c.name}{c.isTestData ? ' (TEST)' : ''}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid cols-3">
        {visibleServices.map((s) => {
          const price = priceFor(s.code);
          const unavailable = !s.available || !price;
          return (
            <div className="card service-card" key={`${s.providerId}:${s.code}`}>
              <div className="title-row">
                <h3 style={{ margin: 0 }}>{s.name}</h3>
                {s.isTestData && <TestBadge />}
              </div>
              {s.description && <p className="desc">{s.description}</p>}
              <div className="title-row" style={{ marginTop: 'auto' }}>
                {unavailable
                  ? <Badge kind="warn">temporarily unavailable</Badge>
                  : <span className="price">{fmtUsd(price.retailPriceCents)}</span>}
                <Link className={`btn small ${unavailable ? 'secondary' : ''}`} to={`/services/${s.code}`}>Details</Link>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ============================ SERVICE DETAIL ============================ */
interface ServiceDetail {
  service: { code: string; name: string; description: string | null; providerId: string; mode: string; available: boolean; isTestData: boolean };
  offers: { countryCode: string; retailPriceCents: number; currency: string }[];
}

export function ServiceDetailPage() {
  const { code } = useParams();
  const [data, setData] = useState<ServiceDetail | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const { user } = useAuth();

  useEffect(() => {
    api.get<ServiceDetail>(`/api/catalog/services/${encodeURIComponent(code ?? '')}`).then(setData).catch(setErr);
  }, [code]);

  if (err) return <><h1>Service</h1><ErrorAlert error={err} /></>;
  if (!data) return <><h1>Service</h1><Spinner /></>;
  const s = data.service;

  return (
    <div className="prose">
      <h1>{s.name} {s.isTestData && <TestBadge />}</h1>
      {!s.available && <div className="alert warning">This service is temporarily unavailable.</div>}
      {s.description && <p>{s.description}</p>}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Available countries & current prices</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>
          Prices are computed server-side (provider cost + configured markup) and re-validated when you order.
        </p>
        {data.offers.length === 0
          ? <EmptyState icon="🌍" title="No country offers right now" />
          : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Country code</th><th>Retail price</th><th></th></tr></thead>
                <tbody>
                  {data.offers.map((o) => (
                    <tr key={o.countryCode}>
                      <td className="mono">{o.countryCode}</td>
                      <td>{fmtUsd(o.retailPriceCents)}</td>
                      <td>
                        {user
                          ? <Link className="btn small" to={`/dashboard/orders/new?country=${o.countryCode}&service=${s.code}`}>Order</Link>
                          : <Link className="btn small secondary" to="/login">Log in to order</Link>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
      <div className="alert info">
        Reminder: no platform is guaranteed to accept temporary numbers. Availability and acceptance
        depend on the provider, number, country, and the third-party platform's policies.
      </div>
      <p><Link to="/services">← Back to catalogue</Link></p>
    </div>
  );
}

/* ============================ PRICING ============================ */
export function Pricing() {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { api.get<Catalog>('/api/catalog').then(setCat).catch(setErr); }, []);

  const rows = useMemo(() => {
    if (!cat) return [];
    return cat.prices.map((p) => {
      const svc = cat.services.find((s) => s.code === p.serviceCode && s.providerId === p.providerId);
      const ct = cat.countries.find((c) => c.code === p.countryCode && c.providerId === p.providerId);
      return { ...p, serviceName: svc?.name ?? p.serviceCode, countryName: ct?.name ?? p.countryCode };
    });
  }, [cat]);

  return (
    <div className="prose" style={{ maxWidth: 900 }}>
      <h1>Pricing</h1>
      <p>
        Retail price = provider cost + configured markup, always calculated on the server and shown
        before you confirm an order. You are never charged for an order the platform failed to
        provision — failures, expiries and approved cancellations refund automatically.
      </p>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Costs that are <em>not</em> free (honest disclosure)</h2>
        <ul style={{ color: 'var(--text-dim)' }}>
          <li><strong>SMS inventory:</strong> upstream providers charge real money per number. Test Mode sidesteps this with simulated inventory.</li>
          <li><strong>Payment processing:</strong> once a payment provider is connected, its fees apply and are disclosed before activation.</li>
          <li><strong>Hosting:</strong> Cloudflare's free tier covers this app's typical needs but has daily request, CPU and D1 row limits. Growth beyond them requires a paid plan — the app never hides this.</li>
          <li><strong>Support & operations:</strong> human time. Refunds and failed purchases reduce gross margin, which is never "guaranteed profit".</li>
        </ul>
      </div>
      {err ? <ErrorAlert error={err} /> : null}
      {!cat && !err && <Spinner label="Loading current prices…" />}
      {cat && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Current catalogue prices {cat.operatingMode === 'test' && <TestBadge />}</h2>
          {rows.length === 0 ? <EmptyState icon="💲" title="No prices configured yet" /> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Service</th><th>Country</th><th>Retail price</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.providerId}:${r.countryCode}:${r.serviceCode}`}>
                      <td>{r.serviceName}</td>
                      <td>{r.countryName}</td>
                      <td className="price">{fmtUsd(r.retailPriceCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
