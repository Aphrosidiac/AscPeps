import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPaginationParams, paginatedResponse } from '../../utils/pagination.js';
import { renderOrderConfirmation } from '../../emails/order-confirmation.js';
import { renderPaymentReceipt } from '../../emails/payment-receipt.js';
import { reconstructPaymentUrl } from '../../utils/email-worker.js';
import { sendEmail } from '../../utils/email.js';
import { generateReceiptPdf } from '../../utils/receipt-pdf.js';

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
    // Lets the admin UI tell "off because you turned it off" apart from "off
    // because the server has no key at all" — isEmailEnabled() collapses both
    // into a single boolean, which isn't enough to explain the toggle to an
    // admin. Never expose the key itself, just whether one is set.
    hasApiKey: !!process.env.RESEND_API_KEY,
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

  const settingsRows = await fastify.prisma.setting.findMany();
  const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));

  if (parsed.type === 'PAYMENT_RECEIPT') {
    return renderPaymentReceipt(order, order.updatedAt, settings);
  }
  const paymentUrl =
    order.paymentMethod === 'WHATSAPP' || order.paymentStatus === 'PAID'
      ? undefined
      : reconstructPaymentUrl(order);
  return renderOrderConfirmation(order, paymentUrl, settings);
}

const testSendBodySchema = z.object({
  type: z.enum(['ORDER_CONFIRMATION', 'PAYMENT_RECEIPT']),
  orderId: z.string().optional(),
  to: z.string().email(),
});

// Ad-hoc test send: same order lookup + settings fetch as adminPreviewEmail,
// but actually calls Resend instead of just returning { subject, html }.
// Deliberately bypasses isEmailEnabled() — testing a template shouldn't
// require flipping the real production toggle — but still goes through
// sendEmail(), which throws if RESEND_API_KEY isn't configured. Errors
// propagate to the global error handler as-is.
export async function adminSendTestEmail(fastify: FastifyInstance, body: unknown) {
  const parsed = testSendBodySchema.parse(body);

  const order = await fastify.prisma.order.findFirst({
    where: parsed.orderId ? { id: parsed.orderId } : { deletedAt: null },
    ...(parsed.orderId ? {} : { orderBy: { createdAt: 'desc' as const } }),
    include: {
      items: { include: { variant: { select: { code: true, size: true, product: { select: { name: true } } } } } },
      discountCode: { select: { code: true, discountType: true, discountValue: true } },
    },
  });
  if (!order) throw { statusCode: 404, message: 'No order available to send with' };

  const settingsRows = await fastify.prisma.setting.findMany();
  const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));

  let subject: string;
  let html: string;
  let attachments: { filename: string; content: Buffer }[] | undefined;

  if (parsed.type === 'PAYMENT_RECEIPT') {
    ({ subject, html } = renderPaymentReceipt(order, order.updatedAt, settings));
    const pdf = await generateReceiptPdf(order, settings);
    attachments = [{ filename: `receipt-${order.orderNumber}.pdf`, content: pdf }];
  } else {
    const paymentUrl =
      order.paymentMethod === 'WHATSAPP' || order.paymentStatus === 'PAID'
        ? undefined
        : reconstructPaymentUrl(order);
    ({ subject, html } = renderOrderConfirmation(order, paymentUrl, settings));
  }

  // sendEmail() throws a plain Error (no statusCode) — the global handler's
  // fallback branch only preserves `.message` for errors that carry one, so
  // without this it surfaces as a bare 500 "Internal Server Error". The whole
  // point of a test-send button is to tell the admin WHY it failed (missing
  // key, invalid recipient, Resend API error), so wrap and attach one here.
  try {
    const { id } = await sendEmail({ to: parsed.to, subject, html, attachments });
    return { id };
  } catch (err) {
    throw { statusCode: 502, message: err instanceof Error ? err.message : 'Failed to send test email' };
  }
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
