import type { FastifyInstance } from 'fastify';
import { getGatewayByBillId } from './payment-gateway.js';
import { restoreOrderInventory } from './order-inventory.js';

// Online orders older than this with no successful payment are re-checked
// against the gateway, then released if still unpaid.
const STALE_AFTER_MS = 15 * 60 * 1000; // 15 min — re-query gateway
const RELEASE_AFTER_MS = 2 * 60 * 60 * 1000; // 2 h — give up and restock

/**
 * Mark an order PAID + CONFIRMED. Idempotent: the guarded updateMany only
 * transitions from UNPAID, so duplicate callbacks/reconciles are no-ops.
 * Returns true if this call performed the transition.
 */
export async function applyPaid(
  fastify: FastifyInstance,
  order: { id: string; orderNumber: string }
): Promise<boolean> {
  const { count } = await fastify.prisma.order.updateMany({
    where: { id: order.id, paymentStatus: 'UNPAID' },
    data: { paymentStatus: 'PAID', status: 'CONFIRMED' },
  });
  if (count > 0) fastify.log.info(`Order ${order.orderNumber} marked PAID`);
  return count > 0;
}

/**
 * Mark an order FAILED and restore the stock + discount usage it reserved at
 * creation. Idempotent on the UNPAID -> FAILED transition.
 */
export async function applyFailed(
  fastify: FastifyInstance,
  orderId: string
): Promise<boolean> {
  const { count } = await fastify.prisma.order.updateMany({
    where: { id: orderId, paymentStatus: 'UNPAID' },
    data: { paymentStatus: 'FAILED' },
  });
  if (count === 0) return false;

  // Atomic, idempotent, floored — safe even if a callback and a sweep both flip
  // this order FAILED at the same time.
  await restoreOrderInventory(fastify, orderId);
  fastify.log.info(`Order ${orderId} marked FAILED — stock & discount restored`);
  return true;
}

/**
 * Sweep stale UNPAID online orders. For each: re-query the gateway for the true
 * paid state (covers missed/dropped callbacks), confirm if paid, and release
 * stock if it's been unpaid long enough that the payment session is dead.
 *
 * This is the safety net for two real failure modes:
 *  - the customer paid but the callback never arrived  -> would stay UNPAID
 *  - the customer abandoned payment (closed the tab)    -> stock held forever
 */
export async function reconcileStaleOrders(fastify: FastifyInstance): Promise<void> {
  const now = Date.now();
  const orders = await fastify.prisma.order.findMany({
    where: {
      paymentStatus: 'UNPAID',
      paymentMethod: 'BILLPLZ', // online-payment orders (gateway-backed)
      createdAt: { lt: new Date(now - STALE_AFTER_MS) },
    },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });

  for (const order of orders) {
    // Stranded order: createBill threw AFTER the tx committed, so stock was
    // reserved but no bill exists (paymentRef is null). Nothing to verify —
    // release it once it's clearly dead.
    if (!order.paymentRef) {
      if (order.createdAt.getTime() < now - RELEASE_AFTER_MS) {
        await applyFailed(fastify, order.id);
      }
      continue;
    }

    const gateway = getGatewayByBillId(order.paymentRef, order.paymentGateway ?? undefined);
    if (!gateway) continue;

    try {
      const { paid } = await gateway.verifyPaid(order.paymentRef);
      if (paid) {
        await applyPaid(fastify, order);
      } else if (order.createdAt.getTime() < now - RELEASE_AFTER_MS) {
        await applyFailed(fastify, order.id);
      }
    } catch (err) {
      // Gateway hiccup — leave the order untouched and retry next sweep.
      fastify.log.warn({ err, orderId: order.id }, 'reconcile: gateway verify failed');
    }
  }
}
