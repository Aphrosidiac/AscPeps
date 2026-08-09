import type { FastifyInstance } from 'fastify';
import { enqueueEmail } from './email-outbox.js';

// The window this reminder is allowed to fire in.
//
// Both ends are dictated by payment-reconcile.ts, not chosen for marketing
// reasons. Its RELEASE_AFTER_MS gives up on an unpaid online order after 2
// hours: the order is marked FAILED and its stock and discount usage are
// released. Past that point the gateway bill is dead, so a "complete payment"
// button would send someone to a broken page — the single worst outcome this
// email has. The lower bound keeps it from landing while the customer is still
// mid-checkout in another tab, which reads as surveillance rather than help.
//
// If RELEASE_AFTER_MS ever changes, this upper bound has to move with it.
const REMIND_AFTER_MS = 45 * 60 * 1000; // 45 min
const REMIND_BEFORE_MS = 105 * 60 * 1000; // 1h45 — 15 min of headroom before release

/**
 * Queue the one-shot abandoned-checkout reminder for orders sitting unpaid
 * inside the window above.
 *
 * Scheduled alongside reconcileStaleOrders (same 2-minute interval) because
 * they read the same rows for opposite reasons: that sweep decides when to
 * give up on an order, this one decides when it's still worth a nudge.
 * Enqueueing (rather than sending here) means the existing outbox worker
 * handles retries, and its (orderId, type) unique key is what guarantees
 * nobody gets nagged twice.
 */
export async function sweepAbandonedCheckouts(fastify: FastifyInstance): Promise<void> {
  const setting = await fastify.prisma.setting.findUnique({
    where: { key: 'abandoned_checkout_enabled' },
  });
  // Off unless switched on. This is the email most likely to irritate a
  // customer, so it should never start sending itself on deploy.
  if (setting?.value !== 'true') return;

  const now = Date.now();
  const candidates = await fastify.prisma.order.findMany({
    where: {
      paymentStatus: 'UNPAID',
      status: { not: 'CANCELLED' },
      deletedAt: null,
      // WhatsApp orders have no gateway bill to return to — those are chased
      // by a human (or the agent) in the chat thread, not by email.
      paymentMethod: { not: 'WHATSAPP' },
      email: { not: null },
      createdAt: {
        gte: new Date(now - REMIND_BEFORE_MS),
        lte: new Date(now - REMIND_AFTER_MS),
      },
      // Cheap pre-filter. enqueueEmail's skipDuplicates is the actual
      // guarantee; this just keeps the sweep from re-attempting the same
      // no-op insert on every sweep for the whole window.
      emails: { none: { type: 'ABANDONED_CHECKOUT' } },
    },
    select: { id: true, orderNumber: true, email: true },
    take: 50,
  });

  for (const order of candidates) {
    // One transaction per order: a single bad row can't stop the rest of the
    // sweep, and there is no shared state to keep consistent between them.
    await fastify.prisma.$transaction(async (tx) => {
      await enqueueEmail(tx, order, 'ABANDONED_CHECKOUT');
    });
  }

  if (candidates.length > 0) {
    fastify.log.info({ count: candidates.length }, 'abandoned-checkout reminders queued');
  }
}
