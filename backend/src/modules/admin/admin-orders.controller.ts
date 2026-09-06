import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPaginationParams, paginatedResponse } from '../../utils/pagination.js';
import { refundBill } from '../../utils/billplz.js';
import { restoreOrderInventory } from '../../utils/order-inventory.js';
import { enqueueEmail } from '../../utils/email-outbox.js';
import { capturePurchase } from '../../utils/posthog.js';
import { isOnlineMethod } from '../../utils/payment-gateway.js';
import { computeGatewayFee } from '../../utils/gateway-fee.js';

const updateOrderSchema = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED']).optional(),
  paymentStatus: z.enum(['UNPAID', 'PAID', 'FAILED', 'REFUNDED']).optional(),
  trackingNumber: z.string().max(50).optional(),
  notes: z.string().optional(),
  profitShared: z.boolean().optional(),
  // How much was actually handed back. Sent alongside paymentStatus REFUNDED
  // for a partial refund; omitted, a refund is taken to be the whole total.
  refundedAmount: z.number().int().min(0).max(100_000_000).optional(),
});

// Cents. Capped well above any plausible order so a mistyped figure can't
// silently overflow the INTEGER column.
const moneyCents = z.number().int().min(0).max(100_000_000);

// Item costs and extra costs are saved together: they're two halves of the same
// "what did this order cost us" answer and the UI has one Save button for both.
const orderCostsSchema = z.object({
  itemCosts: z
    .array(
      z.object({
        itemId: z.string().min(1),
        // Nullable so a line can be cleared back to "not priced yet".
        unitCost: moneyCents.nullable(),
      })
    )
    .max(100),
  extraCosts: z
    .array(z.object({ label: z.string().trim().min(1, 'Label is required').max(60), amount: moneyCents }))
    .max(20),
  // Stamped automatically at the PAID transition from the configured rule, and
  // editable here because a published rate is a schedule, not a promise — the
  // real settlement can differ, and the order should record what was actually
  // taken. Omitted leaves whatever is already stored.
  gatewayFee: moneyCents.optional(),
});

// No .default() on any field — this schema is only ever used for partial
// updates, and a default would silently write itself on every request that
// omits the key. See the same footgun documented on the product schemas.
const profitSharesSchema = z.object({
  shares: z
    .array(
      z.object({
        name: z.string().trim().min(1, 'Name is required').max(60),
        // Share of this order's PROFIT.
        shareBps: z.number().int().min(0).max(10_000),
        // Cents of this order's COSTS this person paid for up front. Owed
        // back to them on top of their profit cut — see the schema comment.
        capitalAmount: z.number().int().min(0).max(100_000_000).optional(),
      })
    )
    .max(10),
});

// Payment statuses accepted as a list filter. Checked against this list
// before it reaches Prisma: an unrecognised value would otherwise be handed
// straight to the query and blow up as a 500 instead of being ignored.
const LIST_PAYMENT_STATUSES = ['UNPAID', 'PAID', 'FAILED', 'REFUNDED'];

const resendEmailSchema = z.object({
  type: z.enum(['ORDER_CONFIRMATION', 'PAYMENT_RECEIPT']),
});

// Outbox fields surfaced per order in the admin list/detail responses —
// enough for the "sent / pending / failed (n attempts)" chips and nothing
// internal (no resendId/nextAttemptAt).
const EMAIL_STATUS_SELECT = {
  select: { type: true, status: true, attempts: true, sentAt: true, lastError: true },
} as const;

// Order status and payment status are otherwise freely editable in any
// direction — the only restriction is this one: once a gateway-settled
// payment (Billplz/ToyyibPay, or a BTCPay crypto invoice) has been confirmed
// Paid, it's locked and can never be changed again through this endpoint. A
// WhatsApp/manual-transfer order's Paid status stays editable, since that was
// an admin's manual call in the first place (and can just as easily be an
// admin's manual fix).
function isLockedOnlinePayment(order: { paymentMethod: string; paymentStatus: string }): boolean {
  return isOnlineMethod(order.paymentMethod) && order.paymentStatus === 'PAID';
}

export async function adminListOrders(fastify: FastifyInstance, query: Record<string, string>) {
  const { page, limit, skip } = getPaginationParams(query);

  // "DELETED" is a pseudo-status, not a real OrderStatus value — it shows
  // only soft-deleted orders. Every other view (including "ALL") excludes
  // them by default so a deleted order never resurfaces in the main list.
  const where: Record<string, unknown> = query.status === 'DELETED'
    ? { deletedAt: { not: null } }
    : { deletedAt: null, ...(query.status ? { status: query.status } : {}) };

  // Opt-in "hide cancelled" for the views that would otherwise mix them in.
  // Applied server-side so it actually removes them from the page the admin
  // is looking at — filtering client-side would just leave gaps in a page
  // that was already capped at `limit` rows. Ignored when the admin has
  // explicitly asked for a single status (including CANCELLED itself), since
  // that request is unambiguous.
  if (!query.status && query.excludeCancelled === 'true') {
    where.status = { not: 'CANCELLED' };
  }

  // Payment status is an independent axis from order status — an order can be
  // PAID and still PENDING fulfilment, or DELIVERED and still UNPAID — so this
  // stacks with the status tab rather than replacing it.
  if (query.paymentStatus && LIST_PAYMENT_STATUSES.includes(query.paymentStatus)) {
    where.paymentStatus = query.paymentStatus;
  }

  if (query.search) {
    where.OR = [
      { orderNumber: { contains: query.search, mode: 'insensitive' } },
      { customerName: { contains: query.search, mode: 'insensitive' } },
      { phone: { contains: query.search } },
    ];
  }

  const [orders, total] = await Promise.all([
    fastify.prisma.order.findMany({
      where,
      include: {
        items: { include: { variant: { select: { code: true, size: true, product: { select: { name: true } } } } } },
        discountCode: { select: { code: true, discountType: true, discountValue: true } },
        emails: EMAIL_STATUS_SELECT,
        // Only the bps, not the whole row: the list needs to know whether a
        // split exists and totals 100% so it can badge orders that still need
        // costing or dividing. Names and amounts belong to the detail page.
        profitShares: { select: { shareBps: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    fastify.prisma.order.count({ where }),
  ]);

  return paginatedResponse(orders, total, page, limit);
}

export async function adminGetOrder(fastify: FastifyInstance, id: string) {
  const order = await fastify.prisma.order.findUnique({
    where: { id },
    include: {
      items: { include: { variant: { include: { product: true } } } },
      discountCode: { select: { code: true, discountType: true, discountValue: true } },
      emails: EMAIL_STATUS_SELECT,
      profitShares: { orderBy: { createdAt: 'asc' } },
      extraCosts: { orderBy: { createdAt: 'asc' } },
    },
  });

  if (!order) throw { statusCode: 404, message: 'Order not found' };
  return order;
}

// Saves per-line costs and extra costs in one call.
export async function adminUpdateOrderCosts(fastify: FastifyInstance, id: string, body: unknown) {
  const { itemCosts, extraCosts, gatewayFee } = orderCostsSchema.parse(body);

  const order = await fastify.prisma.order.findUnique({
    where: { id },
    select: { id: true, total: true, items: { select: { id: true } } },
  });
  if (!order) throw { statusCode: 404, message: 'Order not found' };

  // Every itemId must belong to THIS order. Without this check the endpoint
  // would happily write a cost onto another order's line by id.
  const ownIds = new Set(order.items.map((i) => i.id));
  const foreign = itemCosts.filter((c) => !ownIds.has(c.itemId));
  if (foreign.length > 0) {
    throw { statusCode: 400, message: 'One or more items do not belong to this order.' };
  }

  if (gatewayFee !== undefined && gatewayFee > order.total) {
    throw {
      statusCode: 400,
      message: `The gateway fee cannot exceed the order total (RM${(order.total / 100).toFixed(2)}).`,
    };
  }

  await fastify.prisma.$transaction([
    ...(gatewayFee !== undefined
      ? [fastify.prisma.order.update({ where: { id }, data: { gatewayFee } })]
      : []),
    ...itemCosts.map((c) =>
      fastify.prisma.orderItem.update({ where: { id: c.itemId }, data: { unitCost: c.unitCost } })
    ),
    // Replace-all, same as the profit split: extra costs are only meaningful as
    // a set, and diffing free-text rows by id buys nothing here.
    fastify.prisma.orderExtraCost.deleteMany({ where: { orderId: id } }),
    ...(extraCosts.length > 0
      ? [fastify.prisma.orderExtraCost.createMany({ data: extraCosts.map((c) => ({ orderId: id, ...c })) })]
      : []),
  ]);

  return adminGetOrder(fastify, id);
}

// Replaces the whole split in one shot rather than exposing per-row CRUD: the
// shares are only meaningful as a set (they have to add up), so a partial edit
// that leaves the total at something other than 100% is not a state worth
// being able to persist.
export async function adminUpdateOrderProfitShares(fastify: FastifyInstance, id: string, body: unknown) {
  const { shares } = profitSharesSchema.parse(body);

  const order = await fastify.prisma.order.findUnique({ where: { id }, select: { id: true } });
  if (!order) throw { statusCode: 404, message: 'Order not found' };

  // An empty list is allowed (it means "no split recorded"); a non-empty one
  // must be exact. Validated server-side and not just in the form, since the
  // numbers here decide what people get paid.
  if (shares.length > 0) {
    const total = shares.reduce((sum, s) => sum + s.shareBps, 0);
    if (total !== 10_000) {
      throw {
        statusCode: 400,
        message: `Shares must add up to exactly 100% — currently ${(total / 100).toFixed(2)}%.`,
      };
    }
    const names = shares.map((s) => s.name.toLowerCase());
    if (new Set(names).size !== names.length) {
      throw { statusCode: 400, message: 'Each person can only appear once in the split.' };
    }
  }

  // Resolve each name to a real Partner, creating one if it's new. This is what
  // lets the finance section total a person's earnings across their whole
  // history — without it a split is just a string and "what has Asyraf earned"
  // has no answer. `name` is still stored on the share as a frozen record of
  // what the order agreed to, so renaming a partner can't rewrite history.
  const partnerIdByName = new Map<string, string>();
  for (const share of shares) {
    if (partnerIdByName.has(share.name)) continue;
    const partner = await fastify.prisma.partner.upsert({
      where: { name: share.name },
      update: {},
      create: { name: share.name },
      select: { id: true },
    });
    partnerIdByName.set(share.name, partner.id);
  }

  // Delete-then-recreate inside a transaction: ids here carry no meaning to
  // anything else, and it keeps "what's stored" identical to "what was sent"
  // without diffing.
  await fastify.prisma.$transaction([
    fastify.prisma.orderProfitShare.deleteMany({ where: { orderId: id } }),
    ...(shares.length > 0
      ? [
          fastify.prisma.orderProfitShare.createMany({
            data: shares.map((s) => ({
              orderId: id,
              name: s.name,
              shareBps: s.shareBps,
              capitalAmount: s.capitalAmount ?? 0,
              partnerId: partnerIdByName.get(s.name) ?? null,
            })),
          }),
        ]
      : []),
  ]);

  return fastify.prisma.orderProfitShare.findMany({
    where: { orderId: id },
    orderBy: { createdAt: 'asc' },
  });
}

export async function adminUpdateOrder(fastify: FastifyInstance, id: string, body: unknown) {
  const data = updateOrderSchema.parse(body);

  const order = await fastify.prisma.order.findUnique({ where: { id }, include: { items: true } });
  if (!order) throw { statusCode: 404, message: 'Order not found' };

  // The lock exists to stop a genuinely-paid online order being flipped back to
  // UNPAID or FAILED, which restocks goods that were bought and paid for.
  // REFUNDED is the one transition it must NOT block: it is a forward move that
  // says the money went back, and refusing it left online orders — nearly all of
  // them — with no way to record a refund at all. Reporting then had no refund
  // to reverse and simply kept counting the sale.
  if (data.paymentStatus && data.paymentStatus !== 'REFUNDED' && isLockedOnlinePayment(order)) {
    throw {
      statusCode: 400,
      message: order.paymentMethod === 'CRYPTO'
        ? 'This order was paid in Bitcoin and is locked — it can only be moved to Refunded.'
        : 'This order was paid via online transfer and is locked — it can only be moved to Refunded.',
    };
  }

  if (data.status === 'CANCELLED') {
    await restoreOrderInventory(fastify, order.id);
    fastify.log.info(`Order ${order.orderNumber} cancelled — stock restored`);
  }

  if (data.paymentStatus) {
    if (data.paymentStatus === 'FAILED') {
      await restoreOrderInventory(fastify, order.id);
    }
    if (data.paymentStatus === 'REFUNDED') {
      if (order.paymentRef && order.paymentGateway === 'billplz') {
        try {
          await refundBill(order.paymentRef, `Refund for order ${order.orderNumber}`);
          fastify.log.info(`Billplz refund initiated for order ${order.orderNumber}`);
        } catch (err) {
          fastify.log.error({ err, orderId: order.id }, 'Billplz refund failed');
          throw { statusCode: 400, message: 'Refund API call failed — check logs for details' };
        }
      } else if (order.paymentGateway === 'toyyibpay') {
        // ToyyibPay has no refund API — the money must be returned manually via
        // the ToyyibPay dashboard / bank. We only restore stock + discount here.
        fastify.log.warn(
          `Order ${order.orderNumber} marked REFUNDED for ToyyibPay — process the actual refund MANUALLY in the ToyyibPay dashboard`
        );
      }
      await restoreOrderInventory(fastify, order.id);
    }
  }

  // Clean trackingNumber — store trimmed or null
  const updateData: Record<string, unknown> = { ...data };
  if (data.trackingNumber !== undefined) {
    updateData.trackingNumber = data.trackingNumber.trim() || null;
  }

  // A refund has to carry an amount or reporting cannot reverse it. Marking an
  // order REFUNDED without one means the whole thing came back — the common
  // case, and the only one the UI could express before partial refunds existed.
  if (data.paymentStatus === 'REFUNDED' && data.refundedAmount === undefined) {
    updateData.refundedAmount = order.total;
  }
  if (data.refundedAmount !== undefined && data.refundedAmount > order.total) {
    throw {
      statusCode: 400,
      message: `A refund cannot exceed the order total (RM${(order.total / 100).toFixed(2)}).`,
    };
  }
  // Moving an order back off REFUNDED clears the reversal with it, so the books
  // don't keep deducting a refund that is no longer recorded anywhere visible.
  if (data.paymentStatus && data.paymentStatus !== 'REFUNDED' && order.refundedAmount > 0) {
    updateData.refundedAmount = 0;
  }

  // Admin manually marking an order Paid (the WhatsApp/manual-transfer flow)
  // is a real payment confirmation — queue the receipt email with the same
  // same-transaction guarantee the gateway path gets in applyPaid.
  if (data.paymentStatus === 'PAID' && order.paymentStatus !== 'PAID') {
    // Same stamp applyPaid makes on the gateway path. Zero for WhatsApp and
    // manual transfers, which have no gateway and cost nothing to collect —
    // but an online order confirmed by hand here still carried a processor fee.
    updateData.gatewayFee = await computeGatewayFee(fastify, order.paymentGateway, order.total);

    const updated = await fastify.prisma.$transaction(async (tx) => {
      const row = await tx.order.update({ where: { id }, data: updateData });
      await enqueueEmail(tx, row, 'PAYMENT_RECEIPT');
      return row;
    });
    // Manual confirmation is a real payment — WhatsApp orders never reach
    // applyPaid, so without this they'd be invisible in revenue reporting.
    capturePurchase(fastify, updated);
    return updated;
  }

  return fastify.prisma.order.update({ where: { id }, data: updateData });
}

// Soft-delete: never removes the row. It just sets deletedAt so the order
// disappears from every normal view and only shows up under the "DELETED"
// filter — order/payment status and stock are untouched either way.
export async function adminDeleteOrder(fastify: FastifyInstance, id: string) {
  const order = await fastify.prisma.order.findUnique({ where: { id } });
  if (!order) throw { statusCode: 404, message: 'Order not found' };
  return fastify.prisma.order.update({ where: { id }, data: { deletedAt: new Date() } });
}

export async function adminRestoreOrder(fastify: FastifyInstance, id: string) {
  const order = await fastify.prisma.order.findUnique({ where: { id } });
  if (!order) throw { statusCode: 404, message: 'Order not found' };
  return fastify.prisma.order.update({ where: { id }, data: { deletedAt: null } });
}

// Re-queue (or first-queue, if the row never existed — e.g. the email was
// added to the order after checkout) an email for the worker to send. Resets
// a FAILED row's attempt budget so the backoff starts over.
export async function adminResendOrderEmail(fastify: FastifyInstance, id: string, body: unknown) {
  const { type } = resendEmailSchema.parse(body);

  const order = await fastify.prisma.order.findUnique({ where: { id } });
  if (!order) throw { statusCode: 404, message: 'Order not found' };
  if (!order.email) throw { statusCode: 400, message: 'This order has no email address' };

  return fastify.prisma.emailOutbox.upsert({
    where: { orderId_type: { orderId: order.id, type } },
    update: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null, toEmail: order.email },
    create: { orderId: order.id, type, toEmail: order.email },
  });
}
