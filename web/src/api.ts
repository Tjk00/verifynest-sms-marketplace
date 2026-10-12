// API client. All calls are same-origin relative URLs (the Worker serves both the SPA
// and the API), so this works on the free *.workers.dev hostname and any custom domain.
// The custom header satisfies the server's CSRF guard for state-changing requests.

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'x-verifynest-client': '1' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* non-JSON response */ }
  if (!res.ok) {
    const err = data?.error;
    throw new ApiError(res.status, err?.code ?? 'unknown', err?.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
};

export function fmtUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export function newIdempotencyKey(): string {
  const rand = crypto.getRandomValues(new Uint8Array(8));
  return `vn-${Date.now().toString(36)}-${[...rand].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
