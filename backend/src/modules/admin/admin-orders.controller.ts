import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPaginationParams, paginatedResponse } from '../../utils/pagination.js';
import { refundBill } from '../../utils/billplz.js';
import { restoreOrderInventory } from '../../utils/order-inventory.js';
import { enqueueEmail } from '../../utils/email-outbox.js';

const updateOrderSchema = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED']).optional(),
  paymentStatus: z.enum(['UNPAID', 'PAID', 'FAILED', 'REFUNDED']).optional(),
  trackingNumber: z.string().max(50).optional(),
  notes: z.string().optional(),
});

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
// direction — the only restriction is this one: once an online-gateway
// payment (Billplz/ToyyibPay) has been confirmed Paid, it's locked and can
// never be changed again through this endpoint. A WhatsApp/manual-transfer
// order's Paid status stays editable, since that was an admin's manual call
// in the first place (and can just as easily be an admin's manual fix).
function isLockedOnlinePayment(order: { paymentMethod: string; paymentStatus: string }): boolean {
  return order.paymentMethod === 'BILLPLZ' && order.paymentStatus === 'PAID';
}

export async function adminListOrders(fastify: FastifyInstance, query: Record<string, string>) {
  const { page, limit, skip } = getPaginationParams(query);

  // "DELETED" is a pseudo-status, not a real OrderStatus value — it shows
  // only soft-deleted orders. Every other view (including "ALL") excludes
  // them by default so a deleted order never resurfaces in the main list.
  const where: Record<string, unknown> = query.status === 'DELETED'
    ? { deletedAt: { not: null } }
    : { deletedAt: null, ...(query.status ? { status: query.status } : {}) };
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
    },
  });

  if (!order) throw { statusCode: 404, message: 'Order not found' };
  return order;
}

export async function adminUpdateOrder(fastify: FastifyInstance, id: string, body: unknown) {
  const data = updateOrderSchema.parse(body);

  const order = await fastify.prisma.order.findUnique({ where: { id }, include: { items: true } });
  if (!order) throw { statusCode: 404, message: 'Order not found' };

  if (data.paymentStatus && isLockedOnlinePayment(order)) {
    throw {
      statusCode: 400,
      message: 'This order was paid via online transfer and is locked — payment status can no longer be changed.',
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

  // Admin manually marking an order Paid (the WhatsApp/manual-transfer flow)
  // is a real payment confirmation — queue the receipt email with the same
  // same-transaction guarantee the gateway path gets in applyPaid.
  if (data.paymentStatus === 'PAID' && order.paymentStatus !== 'PAID') {
    return fastify.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({ where: { id }, data: updateData });
      await enqueueEmail(tx, updated, 'PAYMENT_RECEIPT');
      return updated;
    });
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
