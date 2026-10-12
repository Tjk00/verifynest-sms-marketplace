import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { Log, LogLevel, Miniflare } from 'miniflare';

/** Splits a migration file into statements, respecting quotes, comments and CREATE TRIGGER ... BEGIN ... END; blocks. */
export function splitSql(sql: string): string[] {
  const stmts: string[] = [];
  let cur = '';
  let inStr = false;
  let inLineComment = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      cur += ch;
      continue;
    }
    if (!inStr && ch === '-' && next === '-') { inLineComment = true; cur += ch; continue; }
    if (inStr) {
      cur += ch;
      if (ch === "'") {
        if (next === "'") { cur += next; i++; } else inStr = false;
      }
      continue;
    }
    if (ch === "'") { inStr = true; cur += ch; continue; }
    if (ch === ';') {
      cur += ch;
      const stripped = cur.replace(/--[^\n]*/g, '');
      if (/^\s*CREATE\s+TRIGGER/i.test(stripped) && !/\bEND\s*;\s*$/i.test(stripped)) {
        continue; // inside trigger body — keep accumulating
      }
      stmts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) stmts.push(cur.trim());
  return stmts.filter((s) => s.replace(/--[^\n]*/g, '').replace(/;/g, '').trim().length > 0);
}

export interface TestContext {
  mf: Miniflare;
  db: any; // D1 proxy for direct SQL assertions (no .transaction support — use the app API or lib worker for that)
  fetch: (path: string, init?: RequestInit & { client?: ClientState }) => Promise<Response>;
  raw: (path: string, init?: RequestInit) => Promise<Response>;
  lib: (path: string, body?: unknown) => Promise<any>;
  stop: () => Promise<void>;
}

export interface ClientState {
  cookies: Map<string, string>;
  ip: string;
}

export function newClient(): ClientState {
  // Unique IP per client keeps DB-backed rate limits isolated between tests.
  const oct = () => Math.floor(Math.random() * 250) + 1;
  return { cookies: new Map(), ip: `203.0.${oct()}.${oct()}` };
}

export const BOOTSTRAP_TOKEN = 'test-bootstrap-token-abcdefgh123456';

async function buildScript(entry: string): Promise<string> {
  const res = await build({
    entryPoints: [join(process.cwd(), entry)],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    write: false,
    conditions: ['workerd', 'worker', 'browser'],
    mainFields: ['browser', 'module', 'main'],
  });
  return res.outputFiles[0].text;
}

export async function makeContext(): Promise<TestContext> {
  const [appScript, libScript] = await Promise.all([buildScript('src/index.ts'), buildScript('tests/lib-entry.ts')]);
  const mf = new Miniflare({
    log: new Log(LogLevel.ERROR),
    compatibilityDate: '2025-09-01',
    workers: [
      {
        name: 'app',
        modules: true,
        script: appScript,
        d1Databases: { DB: 'test-db' },
        bindings: { ADMIN_BOOTSTRAP_TOKEN: BOOTSTRAP_TOKEN },
      },
      {
        name: 'lib',
        modules: true,
        script: libScript,
        d1Databases: { DB: 'test-db' },
      },
    ],
  });

  const db = await mf.getD1Database('DB');
  const migrationFiles = readdirSync(join(process.cwd(), 'migrations')).filter((f) => f.endsWith('.sql')).sort();
  for (const file of migrationFiles) {
    const sql = readFileSync(join(process.cwd(), 'migrations', file), 'utf8');
    for (const stmt of splitSql(sql)) {
      await db.prepare(stmt).run();
    }
  }

  const libWorker = await mf.getWorker('lib');

  const raw = async (path: string, init: RequestInit = {}) => {
    return mf.dispatchFetch(`https://test.verifynest.local${path}`, init as any) as unknown as Promise<Response>;
  };

  const fetchFn = async (path: string, init: RequestInit & { client?: ClientState } = {}) => {
    const client = init.client ?? newClient();
    const headers = new Headers(init.headers);
    headers.set('x-verifynest-client', '1');
    headers.set('cf-connecting-ip', client.ip);
    if (!headers.has('content-type') && init.body) headers.set('content-type', 'application/json');
    const cookieHeader = [...client.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookieHeader) headers.set('cookie', cookieHeader);
    const res = (await mf.dispatchFetch(`https://test.verifynest.local${path}`, { ...init, headers } as any)) as unknown as Response;
    // Capture cookies from the response.
    const setCookies: string[] = (res.headers as any).getSetCookie
      ? (res.headers as any).getSetCookie()
      : [res.headers.get('set-cookie')].filter(Boolean);
    for (const sc of setCookies) {
      if (!sc) continue;
      const [pair] = sc.split(';');
      const idx = pair.indexOf('=');
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (value === '' || /Max-Age=0/i.test(sc)) client.cookies.delete(name);
      else client.cookies.set(name, value);
    }
    return res;
  };

  const lib = async (path: string, body?: unknown) => {
    // Miniflare v4 worker facades expose fetch() directly (v3 used dispatchFetch()).
    const worker = libWorker as any;
    const init = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    };
    const url = `https://lib.local${path}`;
    if (typeof worker.fetch === 'function') {
      try {
        return await (await worker.fetch(url, init)).json();
      } catch (e) {
        if (typeof worker.dispatchFetch !== 'function') throw e;
      }
    }
    return await (await worker.dispatchFetch(url, init)).json();
  };

  return { mf, db, fetch: fetchFn, raw, lib, stop: () => mf.dispose() };
}

export async function registerUser(t: TestContext, email: string, password = 'correct-horse-battery', client = newClient()) {
  const res = await t.fetch('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
    client,
  });
  return { res, client, body: (await res.json()) as any };
}

export async function loginUser(t: TestContext, email: string, password: string, client = newClient()) {
  const res = await t.fetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
    client,
  });
  return { res, client, body: (await res.json()) as any };
}

export async function setupAdmin(t: TestContext, email = 'admin@verifynest.local', password = 'admin-strong-pass-123', client = newClient()) {
  const res = await t.fetch('/api/auth/setup-admin', {
    method: 'POST',
    body: JSON.stringify({ email, password, bootstrap_token: BOOTSTRAP_TOKEN }),
    client,
  });
  return { res, client, body: (await res.json()) as any };
}

export function json(res: Response) {
  return res.json() as Promise<any>;
}
