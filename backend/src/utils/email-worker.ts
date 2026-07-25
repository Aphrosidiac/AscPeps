import type { FastifyInstance } from 'fastify';
import type { EmailOutbox } from '@prisma/client';
import { env } from '../config/env.js';
import { isEmailEnabled, sendEmail } from './email.js';
import { generateReceiptPdf } from './receipt-pdf.js';
import { renderOrderConfirmation } from '../emails/order-confirmation.js';
import { renderPaymentReceipt } from '../emails/payment-receipt.js';

const BATCH_SIZE = 10;
// Retry backoff by attempt count; after the last slot the row goes FAILED
// for good (admin can reset it via the resend-email endpoint).
const BACKOFF_MS = [
  1 * 60 * 1000, // 1m
  5 * 60 * 1000, // 5m
  30 * 60 * 1000, // 30m
  2 * 60 * 60 * 1000, // 2h
  6 * 60 * 60 * 1000, // 6h
];
const MAX_ATTEMPTS = BACKOFF_MS.length;

// Rebuild the gateway's payment URL from what IS persisted on the order —
// the bill URL itself never is. Both gateways use stable <host>/<ref> style
// URLs, so this matches what createBill originally returned.
export function reconstructPaymentUrl(order: { paymentGateway: string | null; paymentRef: string | null }): string | undefined {
  if (!order.paymentRef) return undefined;
  if (order.paymentGateway === 'toyyibpay') {
    const host = env.TOYYIBPAY_SANDBOX ? 'https://dev.toyyibpay.com' : 'https://toyyibpay.com';
    return `${host}/${order.paymentRef}`;
  }
  if (order.paymentGateway === 'billplz') {
    const host = env.BILLPLZ_SANDBOX ? 'https://www.billplz-sandbox.com' : 'https://www.billplz.com';
    return `${host}/bills/${order.paymentRef}`;
  }
  return undefined;
}

async function processRow(fastify: FastifyInstance, row: EmailOutbox): Promise<void> {
  const order = await fastify.prisma.order.findUnique({
    where: { id: row.orderId },
    include: {
      items: { include: { variant: { select: { code: true, size: true, product: { select: { name: true } } } } } },
      discountCode: { select: { code: true, discountType: true, discountValue: true } },
    },
  });

  // Order gone/deleted, or a confirmation for an order that got cancelled
  // before we sent it — pointless (or confusing) to email now. Receipts are
  // exempt from the cancel check: a PAID order stays paid through later
  // status changes and the customer is owed the receipt regardless.
  const ineligible =
    !order ||
    order.deletedAt !== null ||
    (row.type === 'ORDER_CONFIRMATION' && order.status === 'CANCELLED');
  if (ineligible) {
    await fastify.prisma.emailOutbox.update({
      where: { id: row.id },
      data: { status: 'FAILED', lastError: 'order no longer eligible' },
    });
    return;
  }

  try {
    let subject: string;
    let html: string;
    let attachments: { filename: string; content: Buffer }[] | undefined;

    if (row.type === 'PAYMENT_RECEIPT') {
      ({ subject, html } = renderPaymentReceipt(order, order.updatedAt));
      const settingsRows = await fastify.prisma.setting.findMany();
      const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));
      const pdf = await generateReceiptPdf(order, settings);
      attachments = [{ filename: `receipt-${order.orderNumber}.pdf`, content: pdf }];
    } else {
      const paymentUrl =
        order.paymentMethod === 'WHATSAPP' || order.paymentStatus === 'PAID'
          ? undefined
          : reconstructPaymentUrl(order);
      ({ subject, html } = renderOrderConfirmation(order, paymentUrl));
    }

    const { id: resendId } = await sendEmail({ to: row.toEmail, subject, html, attachments });
    await fastify.prisma.emailOutbox.update({
      where: { id: row.id },
      data: { status: 'SENT', sentAt: new Date(), resendId },
    });
    fastify.log.info(`Email ${row.type} sent for order ${order.orderNumber} (resend ${resendId})`);
  } catch (err) {
    const attempts = row.attempts + 1;
    const message = err instanceof Error ? err.message : String(err);
    await fastify.prisma.emailOutbox.update({
      where: { id: row.id },
      data: {
        attempts,
        lastError: message.slice(0, 500),
        ...(attempts >= MAX_ATTEMPTS
          ? { status: 'FAILED' }
          : { nextAttemptAt: new Date(Date.now() + BACKOFF_MS[attempts - 1]) }),
      },
    });
    fastify.log.warn({ err, outboxId: row.id, attempts }, `email ${row.type} send failed for order ${order.orderNumber}`);
  }
}

// Overlap guard: a slow batch (PDF render + 10 Resend calls) can outlive the
// 30s interval — skip the tick instead of double-sending.
let running = false;

/** Drain due PENDING outbox rows. Scheduled from server.ts. */
export async function processEmailOutbox(fastify: FastifyInstance): Promise<void> {
  if (running || !(await isEmailEnabled(fastify.prisma))) return;
  running = true;
  try {
    const rows = await fastify.prisma.emailOutbox.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });
    for (const row of rows) {
      await processRow(fastify, row);
    }
  } finally {
    running = false;
  }
}
