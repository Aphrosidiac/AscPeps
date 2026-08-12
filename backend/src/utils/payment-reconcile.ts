import type { FastifyInstance } from 'fastify';
import { getGatewayByBillId } from './payment-gateway.js';
import type { PaymentFailureReason } from './payment-gateway.js';
import { restoreOrderInventory } from './order-inventory.js';
import { enqueueEmail } from './email-outbox.js';
import { capturePurchase } from './posthog.js';

// Online orders older than this with no successful payment are re-checked
// against the gateway, then released if still unpaid.
//
// This used to be a 15-minute backstop behind the gateway callback. It isn't a
// backstop any more: ToyyibPay's server-to-server callback has never been
// delivered to this origin, so an order whose customer doesn't come back
// through the return URL is confirmed HERE or not at all. Three minutes keeps
// the worst-case confirmation lag at roughly one sweep interval instead of the
// ~25 minutes observed in production, at the cost of one cheap
// getBillTransactions call per open order per sweep.
const STALE_AFTER_MS = 3 * 60 * 1000; // 3 min — re-query gateway
const RELEASE_AFTER_MS = 2 * 60 * 60 * 1000; // 2 h — give up and restock
// WhatsApp checkouts have no gateway to verify against — an order the admin
// never confirmed just holds its reserved stock forever. Generous window
// because confirmation is a manual chat exchange, not an instant callback.
const WHATSAPP_RELEASE_AFTER_MS = 48 * 60 * 60 * 1000; // 48 h — cancel and restock

/**
 * Mark an order PAID + CONFIRMED. Idempotent: the guarded updateMany only
 * transitions from UNPAID, so duplicate callbacks/reconciles are no-ops.
 * Returns true if this call performed the transition.
 *
 * Every gateway-backed PAID transition funnels through here (gateway callback,
 * redirect verify, reconcile sweep), so this is also the single place the
 * payment receipt email gets queued — in the same transaction as the
 * transition — and the single place the `purchase` analytics event fires.
 *
 * Note the admin "mark as Paid" flow (WhatsApp / manual transfer) does NOT
 * come through here; it has its own guarded transition in
 * admin-orders.controller and fires its own purchase event.
 */
export async function applyPaid(
  fastify: FastifyInstance,
  order: {
    id: string;
    orderNumber: string;
    email: string | null;
    total: number;
    subtotal: number;
    shippingFee: number;
    discountAmount: number;
    paymentMethod: string;
    paymentGateway: string | null;
  }
): Promise<boolean> {
  const transitioned = await fastify.prisma.$transaction(async (tx) => {
    const { count } = await tx.order.updateMany({
      where: { id: order.id, paymentStatus: 'UNPAID' },
      data: { paymentStatus: 'PAID', status: 'CONFIRMED' },
    });
    if (count > 0) await enqueueEmail(tx, order, 'PAYMENT_RECEIPT');
    return count > 0;
  });
  if (transitioned) {
    fastify.log.info(`Order ${order.orderNumber} marked PAID`);
    // Outside the transaction and after the guard: only a genuine
    // UNPAID -> PAID transition emits revenue, so duplicate callbacks and
    // reconcile sweeps can't double-count.
    capturePurchase(fastify, order);
  }
  return transitioned;
}

/**
 * Mark an order FAILED and restore the stock + discount usage it reserved at
 * creation. Idempotent on the UNPAID -> FAILED transition.
 *
 * Also cancels the order and kills the gateway bill. Both matter:
 *  - status stayed PENDING, so a dead order kept showing up in admin as if it
 *    were still worth fulfilling;
 *  - the bill stays payable for `billExpiryDays` (a full day) while the stock
 *    behind it goes back on sale here, at two hours. Without deactivation a
 *    customer can pay into an order that no longer exists, and nothing
 *    reconciles it — the sweep only ever looks at UNPAID orders.
 */
export async function applyFailed(
  fastify: FastifyInstance,
  orderId: string,
  failure?: { reason: PaymentFailureReason; channel?: string }
): Promise<boolean> {
  const reason = failure?.reason ?? 'UNKNOWN';
  const { count } = await fastify.prisma.order.updateMany({
    where: { id: orderId, paymentStatus: 'UNPAID' },
    data: {
      paymentStatus: 'FAILED',
      status: 'CANCELLED',
      paymentFailureReason: reason,
      paymentFailureChannel: failure?.channel ?? null,
    },
  });
  if (count === 0) return false;

  // Atomic, idempotent, floored — safe even if a callback and a sweep both flip
  // this order FAILED at the same time.
  await restoreOrderInventory(fastify, orderId);

  // A customer who selected a payment method and was refused is a lost sale
  // someone should chase, not a statistic — log it loudly enough to find, and
  // distinctly from the ordinary abandons it used to be indistinguishable from.
  if (reason === 'DECLINED' || reason === 'ABANDONED_MID_PAYMENT') {
    fastify.log.warn(
      { orderId, reason, channel: failure?.channel },
      'Order FAILED after a real payment attempt — possible lost sale'
    );
  } else {
    fastify.log.info(`Order ${orderId} marked FAILED (${reason}) — stock & discount restored`);
  }

  // Best-effort and deliberately after the transition: a gateway hiccup here
  // must not leave the order half-released. Runs exactly once per order
  // because the transition above is guarded.
  const order = await fastify.prisma.order.findUnique({
    where: { id: orderId },
    select: { paymentRef: true, paymentGateway: true },
  });
  if (order?.paymentRef) {
    const gateway = getGatewayByBillId(order.paymentRef, order.paymentGateway ?? undefined);
    if (gateway?.deactivateBill) {
      try {
        await gateway.deactivateBill(order.paymentRef);
      } catch (err) {
        fastify.log.warn({ err, orderId, billId: order.paymentRef }, 'failed to deactivate bill');
      }
    }
  }
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
        await applyFailed(fastify, order.id, { reason: 'NO_BILL' });
      }
      continue;
    }

    const gateway = getGatewayByBillId(order.paymentRef, order.paymentGateway ?? undefined);
    if (!gateway) continue;

    try {
      const { paid, failureReason, channel } = await gateway.verifyPaid(order.paymentRef);
      if (paid) {
        await applyPaid(fastify, order);
      } else if (order.createdAt.getTime() < now - RELEASE_AFTER_MS) {
        // Classified from the same re-query that just decided the order's fate,
        // so this costs no extra gateway call. Note that seeing a decline here
        // deliberately does NOT shorten the release window: ToyyibPay bills stay
        // payable after a refused attempt and customers do retry and succeed on
        // the same bill (ASC2608/0020 took five tries), so releasing on the
        // first refusal would take a live sale away from them.
        await applyFailed(fastify, order.id, {
          reason: failureReason ?? 'UNKNOWN',
          channel,
        });
      }
    } catch (err) {
      // Gateway hiccup — leave the order untouched and retry next sweep.
      fastify.log.warn({ err, orderId: order.id }, 'reconcile: gateway verify failed');
    }
  }

  // WhatsApp orders the admin never confirmed: cancel and release the stock.
  // Same stockRestored-guarded restore as the online-payment path, so a
  // concurrent admin action can't double-restore.
  const staleWhatsapp = await fastify.prisma.order.findMany({
    where: {
      paymentMethod: 'WHATSAPP',
      status: 'PENDING',
      paymentStatus: 'UNPAID',
      createdAt: { lt: new Date(now - WHATSAPP_RELEASE_AFTER_MS) },
    },
    select: { id: true, orderNumber: true },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });

  for (const order of staleWhatsapp) {
    // Guarded transition (only from PENDING) — a just-confirmed order is safe.
    const { count } = await fastify.prisma.order.updateMany({
      where: { id: order.id, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    if (count === 0) continue;

    await restoreOrderInventory(fastify, order.id);
    fastify.log.info(`Order ${order.orderNumber} auto-cancelled (WhatsApp, unconfirmed 48h) — stock restored`);
  }
}
