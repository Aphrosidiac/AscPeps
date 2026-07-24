import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPaginationParams, paginatedResponse } from '../../utils/pagination.js';
import { renderOrderConfirmation } from '../../emails/order-confirmation.js';
import { renderPaymentReceipt } from '../../emails/payment-receipt.js';
import { reconstructPaymentUrl } from '../../utils/email-worker.js';

const listEmailsQuerySchema = z.object({
  status: z.enum(['PENDING', 'SENT', 'FAILED']).optional(),
  page: z.coerce.number().int().optional(),
  pageSize: z.coerce.number().int().optional(),
});

export async function adminListEmails(fastify: FastifyInstance, query: Record<string, string>) {
  const parsed = listEmailsQuerySchema.parse(query);
  // getPaginationParams reads `limit` — map the route's pageSize onto it so
  // its clamping (1..100, default 20) stays the single source of truth.
  const { page, limit, skip } = getPaginationParams({ page: parsed.page, limit: parsed.pageSize });

  const where = parsed.status ? { status: parsed.status } : {};
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [rows, total, pending, failed, sentLast7Days] = await Promise.all([
    fastify.prisma.emailOutbox.findMany({
      where,
      select: {
        id: true,
        type: true,
        toEmail: true,
        status: true,
        attempts: true,
        lastError: true,
        sentAt: true,
        createdAt: true,
        nextAttemptAt: true,
        order: { select: { id: true, orderNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    fastify.prisma.emailOutbox.count({ where }),
    // Stats are always global (unfiltered) — they feed the summary strip and
    // the Failed-tab badge, which must not change as the filter changes.
    fastify.prisma.emailOutbox.count({ where: { status: 'PENDING' } }),
    fastify.prisma.emailOutbox.count({ where: { status: 'FAILED' } }),
    fastify.prisma.emailOutbox.count({ where: { status: 'SENT', sentAt: { gte: sevenDaysAgo } } }),
  ]);

  return {
    ...paginatedResponse(rows, total, page, limit),
    stats: { pending, failed, sentLast7Days },
  };
}

const previewEmailQuerySchema = z.object({
  type: z.enum(['ORDER_CONFIRMATION', 'PAYMENT_RECEIPT']),
  orderId: z.string().optional(),
});

// Render a template against a real order (given id, or the latest order) and
// return { subject, html } for the admin read-only preview. Mirrors exactly
// what the worker sends, including the payment-link reconstruction rules.
export async function adminPreviewEmail(fastify: FastifyInstance, query: Record<string, string>) {
  const parsed = previewEmailQuerySchema.parse(query);
  const order = await fastify.prisma.order.findFirst({
    where: parsed.orderId ? { id: parsed.orderId } : { deletedAt: null },
    ...(parsed.orderId ? {} : { orderBy: { createdAt: 'desc' as const } }),
    include: {
      items: { include: { variant: { select: { code: true, size: true, product: { select: { name: true } } } } } },
      discountCode: { select: { code: true, discountType: true, discountValue: true } },
    },
  });
  if (!order) throw { statusCode: 404, message: 'No order available to preview with' };

  if (parsed.type === 'PAYMENT_RECEIPT') {
    return renderPaymentReceipt(order, order.updatedAt);
  }
  const paymentUrl =
    order.paymentMethod === 'WHATSAPP' || order.paymentStatus === 'PAID'
      ? undefined
      : reconstructPaymentUrl(order);
  return renderOrderConfirmation(order, paymentUrl);
}

// Bulk ops-recovery: re-queue every FAILED email with a fresh attempt budget,
// exactly like a per-order resend but across the whole outbox. The worker
// picks them up on its next tick.
export async function adminRetryFailedEmails(fastify: FastifyInstance) {
  const { count } = await fastify.prisma.emailOutbox.updateMany({
    where: { status: 'FAILED' },
    data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null },
  });
  return { retried: count };
}
