import { Hono } from 'hono';
import type { Env } from '../env';
import type { AppVars } from '../middleware/auth';
import { requireUser } from '../middleware/auth';
import { notFound } from '../lib/errors';
import { optionalString, requireBody, requireString, sanitizeText } from '../lib/validation';
import { randomHex } from '../lib/crypto';
import { checkRateLimit } from '../lib/ratelimit';

export const supportRoutes = new Hono<{ Bindings: Env; Variables: AppVars }>();
supportRoutes.use('*', requireUser);

/** GET /api/support/tickets — own tickets only. */
supportRoutes.get('/tickets', async (c) => {
  const user = c.get('user')!;
  const { results } = await c.env.DB.prepare(
    'SELECT id, subject, status, order_id, created_at, updated_at FROM support_tickets WHERE user_id = ?1 ORDER BY created_at DESC',
  ).bind(user.id).all();
  return c.json({ tickets: results ?? [] });
});

/** POST /api/support/tickets */
supportRoutes.post('/tickets', async (c) => {
  const user = c.get('user')!;
  await checkRateLimit(c.env.DB, `tickets:${user.id}`, 10, 3600);
  const body = requireBody(await c.req.json().catch(() => null));
  const subject = sanitizeText(requireString(body.subject, 'Subject', 3, 140));
  const message = sanitizeText(requireString(body.message, 'Message', 3, 4000));
  const orderId = optionalString(body.order_id, 'Order id', 64);
  if (orderId) {
    const own = await c.env.DB.prepare('SELECT id FROM orders WHERE id = ?1 AND user_id = ?2').bind(orderId, user.id).first();
    if (!own) throw notFound('Referenced order not found.');
  }
  const id = randomHex(12);
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO support_tickets (id, user_id, order_id, subject, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'open', ?5, ?5)")
      .bind(id, user.id, orderId, subject, now),
    c.env.DB.prepare("INSERT INTO ticket_messages (id, ticket_id, author_id, author_role, body, created_at) VALUES (?1, ?2, ?3, 'customer', ?4, ?5)")
      .bind(randomHex(12), id, user.id, message, now),
  ]);
  return c.json({ ticket: { id, subject, status: 'open', createdAt: now } }, 201);
});

/** GET /api/support/tickets/:id — ownership enforced. */
supportRoutes.get('/tickets/:id', async (c) => {
  const user = c.get('user')!;
  const ticket = await c.env.DB.prepare('SELECT * FROM support_tickets WHERE id = ?1 AND user_id = ?2')
    .bind(c.req.param('id'), user.id).first();
  if (!ticket) throw notFound('Ticket not found.');
  const { results } = await c.env.DB.prepare('SELECT author_role, body, created_at FROM ticket_messages WHERE ticket_id = ?1 ORDER BY created_at')
    .bind(ticket.id).all();
  return c.json({ ticket, messages: results ?? [] });
});

/** POST /api/support/tickets/:id/reply */
supportRoutes.post('/tickets/:id/reply', async (c) => {
  const user = c.get('user')!;
  await checkRateLimit(c.env.DB, `ticket-reply:${user.id}`, 20, 3600);
  const ticket = await c.env.DB.prepare('SELECT * FROM support_tickets WHERE id = ?1 AND user_id = ?2')
    .bind(c.req.param('id'), user.id).first<any>();
  if (!ticket) throw notFound('Ticket not found.');
  if (ticket.status === 'closed') throw notFound('This ticket is closed. Please open a new one.');
  const body = requireBody(await c.req.json().catch(() => null));
  const message = sanitizeText(requireString(body.message, 'Message', 1, 4000));
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO ticket_messages (id, ticket_id, author_id, author_role, body, created_at) VALUES (?1, ?2, ?3, 'customer', ?4, ?5)")
      .bind(randomHex(12), ticket.id, user.id, message, now),
    c.env.DB.prepare("UPDATE support_tickets SET status = 'open', updated_at = ?1 WHERE id = ?2").bind(now, ticket.id),
  ]);
  return c.json({ ok: true });
});

/** POST /api/support/abuse-report — report abuse (fraud, spam, impersonation, etc.). */
supportRoutes.post('/abuse-report', async (c) => {
  const user = c.get('user')!;
  await checkRateLimit(c.env.DB, `abuse:${user.id}`, 5, 3600);
  const body = requireBody(await c.req.json().catch(() => null));
  const category = requireString(body.category, 'Category', 2, 60);
  const details = sanitizeText(requireString(body.details, 'Details', 10, 4000));
  const id = randomHex(12);
  await c.env.DB.prepare(
    "INSERT INTO abuse_reports (id, reporter_id, category, details, status, created_at) VALUES (?1, ?2, ?3, ?4, 'open', ?5)",
  ).bind(id, user.id, category, details, new Date().toISOString()).run();
  return c.json({ reportId: id, status: 'open' }, 201);
});
