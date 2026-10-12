// TEST-ONLY worker entry (never deployed): exposes library functions that require a
// real in-worker D1 binding (transactions), so unit tests can exercise them inside workerd.
import { applyLedgerEntry, getWallets } from '../src/lib/ledger';

export default {
  async fetch(request: Request, env: { DB: D1Database }): Promise<Response> {
    const url = new URL(request.url);
    const body: any = await request.json().catch(() => ({}));
    try {
      if (url.pathname === '/apply') {
        const result = await applyLedgerEntry(env.DB, body);
        return Response.json({ ok: true, ...result });
      }
      if (url.pathname === '/wallets') {
        const wallets = await getWallets(env.DB, body.userId);
        return Response.json({ ok: true, wallets });
      }
      if (url.pathname === '/insert-user') {
        // Minimal user row for ledger FKs (tests only).
        const id = body.id ?? 'lib-user';
        await env.DB.prepare(
          "INSERT OR IGNORE INTO users (id, email, password_hash, role, status, created_at, updated_at) VALUES (?1, ?2, 'x', 'customer', 'active', ?3, ?3)",
        ).bind(id, `${id}@lib.local`, new Date().toISOString()).run();
        return Response.json({ ok: true, id });
      }
      return Response.json({ ok: false, message: 'unknown path' }, { status: 404 });
    } catch (e: any) {
      return Response.json({
        ok: false,
        name: e?.name ?? 'Error',
        message: e?.message ?? String(e),
        currentBalanceCents: e?.currentBalanceCents,
      }, { status: 400 });
    }
  },
};
