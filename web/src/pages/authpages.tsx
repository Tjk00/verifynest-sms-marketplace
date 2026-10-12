import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth, type User } from '../auth';
import { ErrorAlert } from '../components';

function usePostLoginRedirect() {
  const { user, refresh } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as any;
  return async (u: User) => {
    await refresh();
    const from = loc.state?.from;
    if (from) nav(from, { replace: true });
    else nav(u.role === 'admin' ? '/admin' : '/dashboard', { replace: true });
  };
}

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const redirect = usePostLoginRedirect();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const res = await api.post<{ user: User }>('/api/auth/login', { email, password });
      await redirect(res.user);
    } catch (e2) { setErr(e2); } finally { setBusy(false); }
  }

  return (
    <div style={{ maxWidth: 440, margin: '0 auto' }}>
      <h1>Log in</h1>
      <div className="card">
        <form onSubmit={submit}>
          <ErrorAlert error={err} />
          <label className="field">
            <span className="label">Email</span>
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="field">
            <span className="label">Password</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <button className="btn" style={{ width: '100%' }} disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
        </form>
        <p style={{ marginTop: 14, color: 'var(--text-dim)', fontSize: '0.9rem' }}>
          No account? <Link to="/register">Create one free</Link> — you'll get TEST credits for Test Mode.
        </p>
      </div>
    </div>
  );
}

export function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const redirect = usePostLoginRedirect();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const res = await api.post<{ user: User }>('/api/auth/register', { email, password });
      await redirect(res.user);
    } catch (e2) { setErr(e2); } finally { setBusy(false); }
  }

  return (
    <div style={{ maxWidth: 440, margin: '0 auto' }}>
      <h1>Create your account</h1>
      <div className="card">
        <form onSubmit={submit}>
          <ErrorAlert error={err} />
          <label className="field">
            <span className="label">Email</span>
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} />
          </label>
          <label className="field">
            <span className="label">Password</span>
            <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} maxLength={128} />
            <span className="hint">At least 10 characters. Stored only as a PBKDF2-SHA256 hash.</span>
          </label>
          <div className="alert info" style={{ fontSize: '0.85rem' }}>
            New accounts receive TEST credits for the simulator. TEST credits are not real money and
            can never be withdrawn or transferred. Creating an account never grants administrator access.
          </div>
          <button className="btn" style={{ width: '100%' }} disabled={busy}>{busy ? 'Creating account…' : 'Sign up'}</button>
        </form>
        <p style={{ marginTop: 14, color: 'var(--text-dim)', fontSize: '0.9rem' }}>
          Already registered? <Link to="/login">Log in</Link>
        </p>
      </div>
    </div>
  );
}

/** First-administrator setup — only reachable while no admin exists AND the bootstrap secret is set. */
export function AdminSetup() {
  const [state, setState] = useState<{ needsAdminSetup: boolean; bootstrapTokenConfigured: boolean } | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const redirect = usePostLoginRedirect();

  useEffect(() => {
    api.get<{ needsAdminSetup: boolean; bootstrapTokenConfigured: boolean }>('/api/auth/bootstrap-status').then(setState).catch(setErr);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const res = await api.post<{ user: User }>('/api/auth/setup-admin', {
        email, password, bootstrap_token: token,
      });
      await redirect(res.user);
    } catch (e2) { setErr(e2); } finally { setBusy(false); }
  }

  if (!state && !err) return <h1>Administrator setup</h1>;
  if (err) return <><h1>Administrator setup</h1><ErrorAlert error={err} /></>;

  return (
    <div style={{ maxWidth: 480, margin: '0 auto' }}>
      <h1>Administrator setup</h1>
      {!state!.needsAdminSetup ? (
        <div className="alert success">An administrator already exists — public setup is permanently closed. There is no default password and no other way to self-grant admin.</div>
      ) : !state!.bootstrapTokenConfigured ? (
        <div className="alert warning">
          Setup is not available yet. The operator must first set the <span className="mono">ADMIN_BOOTSTRAP_TOKEN</span>{' '}
          secret (≥16 characters) via <span className="mono">npx wrangler secret put ADMIN_BOOTSTRAP_TOKEN</span>.
          It is stored only in Cloudflare's secret management — never in git, never in frontend code.
        </div>
      ) : (
        <div className="card">
          <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>
            Create the first administrator account. Requires the bootstrap token. This page closes
            permanently once an administrator exists, and the action is audit-logged.
          </p>
          <form onSubmit={submit}>
            <ErrorAlert error={err} />
            <label className="field">
              <span className="label">Admin email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label className="field">
              <span className="label">Password</span>
              <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} maxLength={128} />
            </label>
            <label className="field">
              <span className="label">Bootstrap token</span>
              <input type="password" value={token} onChange={(e) => setToken(e.target.value)} required minLength={16} />
              <span className="hint">The value of the ADMIN_BOOTSTRAP_TOKEN secret.</span>
            </label>
            <button className="btn" style={{ width: '100%' }} disabled={busy}>{busy ? 'Creating administrator…' : 'Create administrator'}</button>
          </form>
        </div>
      )}
    </div>
  );
}
