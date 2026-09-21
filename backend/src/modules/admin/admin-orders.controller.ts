import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPaginationParams, paginatedResponse } from '../../utils/pagination.js';
import { refundBill } from '../../utils/billplz.js';
import { restoreOrderInventory } from '../../utils/order-inventory.js';
import { enqueueEmail } from '../../utils/email-outbox.js';
import { capturePurchase } from '../../utils/posthog.js';
import { isOnlineMethod } from '../../utils/payment-gateway.js';
import { computeGatewayFee } from '../../utils/gateway-fee.js';
import { MANUALPAY_GATEWAY } from '../../plugins/manualpay.js';
import { carryDiscount, goodsSubtotal, manualDiscountSchema, resolveManualDiscount } from '../../utils/manual-discount.js';
import { getEffectivePrice } from '../../utils/product-pricing.js';
import { getVariantDisplayName } from '../../utils/product-addons.js';

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
        // Whose price list the cost came from, for traceability. Omitted
        // leaves whatever is stored; null means keyed in by hand.
        supplierId: z.string().min(1).nullable().optional(),
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

// The order's lines as they should be from now on: every line, not a diff.
// Quantity 0 drops a line, a variant not on the order yet is added. The cap
// per line matches checkout's; there is no cap on the number of units across
// the order because the orders that get edited by hand are the bulk ones.
const orderItemsSchema = z.object({
  items: z
    .array(z.object({ variantId: z.string().min(1), quantity: z.number().int().min(0).max(100) }))
    .min(1)
    .max(50),
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

  // The review queue: hosted-checkout orders whose customer has uploaded a
  // proof nobody has looked at yet. Resolved through the session table so
  // the list never needs a second round-trip per row.
  if (query.awaitingProof === 'true') {
    const pending = await fastify.prisma.checkoutSession.findMany({
      where: { status: 'PROOF_SUBMITTED' },
      select: { id: true },
    });
    where.paymentGateway = MANUALPAY_GATEWAY;
    where.paymentRef = { in: pending.map((s) => s.id) };
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
        items: { include: { variant: { select: { code: true, size: true, product: { select: { name: true } } } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
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
      // In the order they were placed: without it Postgres hands back rows
      // in whatever order an update last touched them, and a line the
      // operator just edited jumps to the bottom of the list. Lines placed
      // together share a createdAt to the millisecond, so the id breaks the
      // tie the same way every time.
      items: {
        include: { variant: { include: { product: true } }, supplier: { select: { id: true, name: true, active: true } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
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

  // A supplier is the answer to "whose price is this?", so a line cannot name
  // one while having no price, and the name has to be a real supplier — an
  // inactive one is fine (this may be an old order being costed late).
  const supplierIds = [...new Set(itemCosts.map((c) => c.supplierId).filter((x): x is string => !!x))];
  if (supplierIds.length > 0) {
    const found = await fastify.prisma.supplier.count({ where: { id: { in: supplierIds } } });
    if (found !== supplierIds.length) throw { statusCode: 400, message: 'One or more suppliers do not exist.' };
  }
  if (itemCosts.some((c) => c.supplierId && c.unitCost === null)) {
    throw { statusCode: 400, message: 'A line with a supplier needs a unit cost.' };
  }

  await fastify.prisma.$transaction([
    ...(gatewayFee !== undefined
      ? [fastify.prisma.order.update({ where: { id }, data: { gatewayFee } })]
      : []),
    ...itemCosts.map((c) =>
      fastify.prisma.orderItem.update({
        where: { id: c.itemId },
        data: {
          unitCost: c.unitCost,
          // Clearing the cost clears its provenance with it.
          ...(c.unitCost === null ? { supplierId: null } : c.supplierId !== undefined ? { supplierId: c.supplierId } : {}),
        },
      })
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

// A discount keyed by hand on an existing order: RM off or a percentage, with
// the reason. Sets the order's ONE discount figure — on the rare order that
// also redeemed a code, this replaces the code's amount rather than stacking on
// it, because a stored total can only carry one discount and the person typing
// here is looking at that total. The total is recomputed the way checkout
// computes it, so the receipt, the WhatsApp summary and the books all move
// together; nothing else about the order changes.
//
// It exists because the alternative was an "Extra Cost" row called
// "discount": the profit came out right, but the customer's total, the
// receipt and the revenue figure were all wrong, and the discount was invisible
// to reporting.
export async function adminSetOrderDiscount(fastify: FastifyInstance, id: string, body: unknown) {
  const input = manualDiscountSchema.parse(body);

  const order = await fastify.prisma.order.findUnique({
    where: { id },
    select: {
      id: true, subtotal: true, shippingFee: true, discountAmount: true, total: true, gatewayFee: true,
      paymentMethod: true, paymentStatus: true, paymentGateway: true, paymentRef: true,
    },
  });
  if (!order) throw { statusCode: 404, message: 'Order not found' };
  const subtotal = goodsSubtotal(order);

  // The customer already paid the total the gateway charged. A different
  // total now would not match the money that arrived — give some back as a
  // partial refund instead, which is what actually happens.
  if (isLockedOnlinePayment(order)) {
    throw {
      statusCode: 400,
      message: 'This order was paid online for its current total. To give money back, record a partial refund instead.',
    };
  }
  if (order.paymentStatus === 'REFUNDED') {
    throw { statusCode: 400, message: 'This order has been refunded — its total can no longer change.' };
  }
  // The hosted bank-transfer page shows a fixed amount and cannot be repriced.
  if (order.paymentGateway === MANUALPAY_GATEWAY && order.paymentRef && order.paymentStatus === 'UNPAID') {
    throw {
      statusCode: 400,
      message: `This order has a payment page open for RM${(order.total / 100).toFixed(2)}, which cannot be repriced. Mark it paid for what arrives and refund the difference, or cancel and re-create the order with the discount.`,
    };
  }

  const { amount, note } = resolveManualDiscount(input, { subtotal, shippingFee: order.shippingFee });
  const total = Math.max(subtotal + order.shippingFee - amount, 0);
  if (total < order.gatewayFee) {
    throw {
      statusCode: 400,
      message: `The discount would take the total below the RM${(order.gatewayFee / 100).toFixed(2)} gateway fee already recorded.`,
    };
  }

  await fastify.prisma.order.update({
    where: { id },
    // `subtotal` is written back too: on the handful of first orders that
    // never stored one, this is the moment it gets rebuilt.
    data: { subtotal, discountAmount: amount, discountNote: note, total },
  });
  return adminGetOrder(fastify, id);
}

// Changes WHAT an order is for after it was placed: a quantity corrected, a
// line dropped, a size added. Until this existed the only lever was the unit
// cost on the Profit tab, so a wrong quantity was "fixed" by typing a cost
// that made the line total come out right — the books balanced and the
// order, the receipt and the stock were all wrong.
//
// Stock moves by the difference, with the same conditional decrement checkout
// uses so two edits cannot oversell the last unit. An existing line keeps the
// price it was sold at and the cost already entered for it; a new line is
// priced at today's effective price and has no cost yet. The discount follows
// the rule it was given under (carryDiscount), shipping stays, and the total
// is recomputed the way checkout computes it. Same refusals as a discount:
// the customer's total cannot change under a settled online payment, a
// refund, or an open hosted payment page. Nothing is emailed — the operator
// resends the confirmation if the customer needs the new one.
export async function adminSetOrderItems(fastify: FastifyInstance, id: string, body: unknown) {
  const { items } = orderItemsSchema.parse(body);

  // A variant listed twice is one line: the last quantity wins, the way a
  // person re-typing a row would expect.
  const wanted = new Map<string, number>();
  for (const line of items) wanted.set(line.variantId, line.quantity);
  if (![...wanted.values()].some((q) => q > 0)) {
    throw { statusCode: 400, message: 'An order needs at least one item.' };
  }

  return fastify.prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id },
      include: {
        items: { include: { variant: { include: { product: { select: { name: true } } } } } },
        discountCode: { select: { discountType: true, discountValue: true } },
      },
    });
    if (!order) throw { statusCode: 404, message: 'Order not found' };
    if (order.deletedAt) throw { statusCode: 400, message: 'This order is deleted. Restore it first.' };

    if (isLockedOnlinePayment(order)) {
      throw {
        statusCode: 400,
        message: 'This order was paid online for its current total, so its items cannot change. Create a new order for anything extra, or record a partial refund.',
      };
    }
    if (order.paymentStatus === 'REFUNDED') {
      throw { statusCode: 400, message: 'This order has been refunded — its items can no longer change.' };
    }
    // Cancelled/failed orders have had their stock put back; moving it again
    // from here would double-count. Restore-then-edit is not a flow worth
    // building for the handful of times it would be wanted.
    if (order.stockRestored) {
      throw { statusCode: 400, message: 'This order was cancelled and its stock returned, so its items cannot change. Create a new order instead.' };
    }
    if (order.paymentGateway === MANUALPAY_GATEWAY && order.paymentRef && order.paymentStatus === 'UNPAID') {
      throw {
        statusCode: 400,
        message: `This order has a payment page open for RM${(order.total / 100).toFixed(2)}, which cannot be repriced. Cancel it and re-create the order, or mark it paid for what arrives.`,
      };
    }

    const now = new Date();
    const existingByVariant = new Map(order.items.map((i) => [i.variantId, i]));
    const addedIds = [...wanted.keys()].filter((v) => !existingByVariant.has(v) && wanted.get(v)! > 0);
    const added = addedIds.length
      ? await tx.productVariant.findMany({
          where: { id: { in: addedIds }, active: true, product: { active: true } },
          include: { product: { select: { name: true } } },
        })
      : [];
    if (added.length !== addedIds.length) {
      throw { statusCode: 400, message: 'One or more products to add were not found or are no longer sold.' };
    }

    // Stock first, so an oversell rolls the whole edit back before any line
    // has moved. Decrements are conditional (the WHERE only matches while
    // enough remains); increments never fail.
    const moves: { variantId: string; delta: number; name: string }[] = [];
    for (const item of order.items) {
      const next = wanted.has(item.variantId) ? wanted.get(item.variantId)! : 0;
      const delta = next - item.quantity;
      if (delta !== 0) moves.push({ variantId: item.variantId, delta, name: getVariantDisplayName(item.variant.product, item.variant) });
    }
    for (const v of added) {
      moves.push({ variantId: v.id, delta: wanted.get(v.id)!, name: getVariantDisplayName(v.product, v) });
    }
    for (const move of moves) {
      if (move.delta > 0) {
        const dec = await tx.productVariant.updateMany({
          where: { id: move.variantId, stock: { gte: move.delta } },
          data: { stock: { decrement: move.delta } },
        });
        if (dec.count === 0) {
          const v = await tx.productVariant.findUnique({ where: { id: move.variantId }, select: { stock: true } });
          throw { statusCode: 400, message: `Only ${v?.stock ?? 0} more of ${move.name} in stock — ${move.delta} more needed.` };
        }
      } else {
        await tx.productVariant.update({
          where: { id: move.variantId },
          data: { stock: { increment: -move.delta } },
        });
      }
    }

    // Lines. Existing ones are updated in place so their id — and the cost
    // keyed against it — survives; a duplicate line for the same variant
    // (possible on a few old orders) is folded into the first.
    const seen = new Set<string>();
    for (const item of order.items) {
      const next = wanted.has(item.variantId) && !seen.has(item.variantId) ? wanted.get(item.variantId)! : 0;
      seen.add(item.variantId);
      if (next === 0) {
        await tx.orderItem.delete({ where: { id: item.id } });
      } else if (next !== item.quantity) {
        await tx.orderItem.update({ where: { id: item.id }, data: { quantity: next } });
      }
    }
    if (added.length) {
      await tx.orderItem.createMany({
        data: added.map((v) => ({ orderId: id, variantId: v.id, quantity: wanted.get(v.id)!, unitPrice: getEffectivePrice(v, now) })),
      });
    }

    const lines = await tx.orderItem.findMany({ where: { orderId: id }, select: { quantity: true, unitPrice: true } });
    const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
    const discountAmount = carryDiscount(order, { subtotal, shippingFee: order.shippingFee });
    const total = Math.max(subtotal + order.shippingFee - discountAmount, 0);
    if (total < order.gatewayFee) {
      throw {
        statusCode: 400,
        message: `The new total would be below the RM${(order.gatewayFee / 100).toFixed(2)} gateway fee already recorded.`,
      };
    }
    // A discount that has shrunk to nothing takes its reason with it.
    await tx.order.update({
      where: { id },
      data: { subtotal, discountAmount, discountNote: discountAmount > 0 ? order.discountNote : null, total },
    });

    return order;
  }, { timeout: 15000, maxWait: 5000 }).then(() => adminGetOrder(fastify, id));
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
    // A hosted-checkout order: close the payment page as well, so a customer
    // who still has the link cannot upload a proof against a dead order.
    if (order.paymentGateway === MANUALPAY_GATEWAY && order.paymentRef) {
      await fastify.manualPay.cancel(order.paymentRef).catch((err) =>
        fastify.log.warn({ err, orderId: order.id }, 'manualpay: could not cancel session')
      );
    }
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
    // A hosted-checkout order confirmed by hand (screenshot came over
    // WhatsApp, or the bank statement was checked): close the payment page to
    // match, without the gateway's onPaid running applyPaid a second time.
    if (order.paymentGateway === MANUALPAY_GATEWAY && order.paymentRef) {
      await fastify.manualPay.markPaid(order.paymentRef, 'admin').catch((err) =>
        fastify.log.warn({ err, orderId: order.id }, 'manualpay: could not mark session paid')
      );
    }
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
