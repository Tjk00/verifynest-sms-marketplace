import { createApp, housekeeping } from './app';
import type { Env } from './env';

const app = createApp();

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    ctx.waitUntil(housekeeping(env));
    const response = await app.fetch(request, env, ctx);
    // Baseline hardening headers.
    response.headers.set('x-content-type-options', 'nosniff');
    response.headers.set('x-frame-options', 'DENY');
    response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
    response.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    if (new URL(request.url).pathname.startsWith('/api/')) {
      response.headers.set('cache-control', 'no-store');
    }
    return response;
  },
} satisfies ExportedHandler<Env>;
