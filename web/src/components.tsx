import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './auth';

/* ---------------- toasts ---------------- */
interface Toast { id: number; kind: 'success' | 'error' | 'info'; text: string }
const ToastContext = createContext<{ notify: (kind: Toast['kind'], text: string) => void }>({ notify: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div className="toast-host" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
      </div>
    </ToastContext.Provider>
  );
}
export function useToast() { return useContext(ToastContext); }

/* ---------------- shared UI ---------------- */
export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <div className="loading-row"><span className="spinner" aria-hidden="true" /> {label}</div>;
}

export function EmptyState({ icon = '📭', title, hint }: { icon?: string; title: string; hint?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="icon" aria-hidden="true">{icon}</div>
      <h3>{title}</h3>
      {hint && <p>{hint}</p>}
    </div>
  );
}

export function Badge({ kind, children }: { kind: string; children: ReactNode }) {
  return <span className={`badge ${kind}`}>{children}</span>;
}

export function TestBadge() { return <Badge kind="test">Test data</Badge>; }

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: 'ok', awaiting_sms: 'warn', pending: 'warn', cancelled: 'muted',
    failed: 'err', refunded: 'ok', expired: 'muted', open: 'warn', answered: 'ok',
    closed: 'muted', active: 'ok', suspended: 'err',
  };
  return <Badge kind={map[status] ?? 'muted'}>{status.replace(/_/g, ' ')}</Badge>;
}

export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return <div className="alert error" role="alert">{msg}</div>;
}

/* ---------------- layout ---------------- */
export function ModeBanner() {
  const { settings } = useAuth();
  if (!settings) return null;
  if (settings.operatingMode === 'test') {
    return (
      <div className="mode-banner">
        ⚠️ TEST MODE — All numbers, orders, codes and balances shown are simulated TEST DATA. Nothing is real, and no real SMS is sent or purchased.
      </div>
    );
  }
  return <div className="mode-banner live">LIVE MODE — real provider orders are active.</div>;
}

const PUBLIC_LINKS = [
  { to: '/', label: 'Home' },
  { to: '/services', label: 'Services' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/how-it-works', label: 'How it works' },
  { to: '/faq', label: 'FAQ' },
  { to: '/status', label: 'Status' },
];

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  return (
    <>
      <header className="header">
        <ModeBanner />
        <div className="header-inner">
          <Link to="/" className="brand" onClick={() => setOpen(false)}>
            <span className="brand-mark" aria-hidden="true">VN</span>
            <span>VerifyNest</span>
          </Link>
          <button className="nav-toggle" aria-expanded={open} aria-label="Toggle navigation" onClick={() => setOpen((o) => !o)}>☰</button>
        </div>
        <nav className={`nav ${open ? 'open' : ''}`} key={loc.pathname} aria-label="Main navigation">
          {PUBLIC_LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.to === '/'} onClick={() => setOpen(false)}
              className={({ isActive }) => (isActive ? 'active' : '')}>{l.label}</NavLink>
          ))}
          <span style={{ flex: 1 }} />
          {user ? (
            <span className="nav-row">
              <NavLink to={user.role === 'admin' ? '/admin' : '/dashboard'} onClick={() => setOpen(false)}
                className={({ isActive }) => (isActive ? 'active' : '')}>
                {user.role === 'admin' ? 'Admin' : 'Dashboard'}
              </NavLink>
              <button className="btn secondary small" onClick={async () => { await logout(); setOpen(false); }}>Log out</button>
            </span>
          ) : (
            <span className="nav-row">
              <NavLink to="/login" onClick={() => setOpen(false)} className={({ isActive }) => (isActive ? 'active' : '')}>Log in</NavLink>
              <NavLink to="/register" onClick={() => setOpen(false)}>
                <span className="btn small">Sign up</span>
              </NavLink>
            </span>
          )}
        </nav>
      </header>
      <main className="page"><div className="container">{children}</div></main>
      <Footer />
    </>
  );
}

export function Footer() {
  const { settings } = useAuth();
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div>
          <div className="brand" style={{ marginBottom: 8 }}><span className="brand-mark" aria-hidden="true">VN</span> VerifyNest</div>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem', maxWidth: 380 }}>
            Your Verification. Your Choice. An SMS verification marketplace built around transparency,
            testability, and strictly authorized provider integrations.
          </p>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
            Support:{' '}
            {settings?.supportEmailConfigured && settings?.supportEmail
              ? <a href={`mailto:${settings.supportEmail}`}>{settings.supportEmail}</a>
              : <span>not yet configured (the suggested mailbox must be created and verified first)</span>}
          </p>
        </div>
        <div>
          <h4>Product</h4>
          <Link to="/services">Services</Link>
          <Link to="/pricing">Pricing</Link>
          <Link to="/how-it-works">How it works</Link>
          <Link to="/status">Service status</Link>
          <Link to="/contact">Contact & support</Link>
        </div>
        <div>
          <h4>Legal</h4>
          <Link to="/terms">Terms of service</Link>
          <Link to="/privacy">Privacy policy</Link>
          <Link to="/refund-policy">Refund policy</Link>
          <Link to="/acceptable-use">Acceptable use</Link>
        </div>
      </div>
      <div className="container disclaimer">
        VerifyNest is an independent marketplace and is not affiliated with, endorsed by, or partnered
        with any upstream provider or any third-party platform until a written reseller agreement is in
        place. Temporary numbers are not guaranteed to be accepted by any particular platform —
        acceptance depends on the provider, the number, the country, and that platform's own policies.
      </div>
    </footer>
  );
}

/* ---------------- route guards ---------------- */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner label="Checking your session…" />;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner label="Checking your session…" />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin') return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export function DashLayout({ links, children, base }: { links: { to: string; label: string; end?: boolean }[]; children: ReactNode; base: string }) {
  return (
    <div className="dash-layout">
      <nav className="side-nav" aria-label="Dashboard navigation">
        {links.map((l) => (
          <NavLink key={l.to} to={`${base}${l.to}`} end={l.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            {l.label}
          </NavLink>
        ))}
      </nav>
      <div>{children}</div>
    </div>
  );
}
