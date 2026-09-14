import path from 'node:path';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { createManualPayGate, DiskProofFileStore, type ManualPayGate } from 'manualpaygate/server';
import { PrismaSessionStore, type PrismaLike } from 'manualpaygate/server/prisma';
import { checkoutConfigSchema, type CheckoutConfig } from 'manualpaygate/core';
import { env } from '../config/env.js';
import { DOCUMENTS_DIR } from '../utils/document-store.js';
import { applyPaid } from '../utils/payment-reconcile.js';
import { restoreOrderInventory } from '../utils/order-inventory.js';
import { enqueueEmail } from '../utils/email-outbox.js';

/**
 * ManualPayGate — the hosted "pay by DuitNow QR / bank transfer, then upload
 * proof" checkout. One gateway object per process, decorated as
 * `fastify.manualPay`; the HTTP routes are mounted separately in server.ts.
 *
 * How it maps onto the order model without touching the PaymentMethod enum
 * (an ALTER TYPE needs type ownership and has broken `migrate deploy` here
 * before): a hosted-checkout order is `paymentMethod: WHATSAPP` — it IS the
 * manual method — with `paymentGateway: 'manualpaygate'` and `paymentRef` set
 * to the session id. Plain WhatsApp orders keep `paymentGateway: null`, so
 * everything that already treats WHATSAPP as "confirm by hand" keeps working
 * and the new flow is one `WHERE paymentGateway = 'manualpaygate'` away.
 */
export const MANUALPAY_GATEWAY = 'manualpaygate';
/** Setting key holding the whole CheckoutConfig as JSON (branding + methods with on/off flags). */
export const MANUALPAY_CONFIG_KEY = 'manualpay_config';
/** Public on/off switch for the method as a whole, alongside online_payment_enabled etc. */
export const MANUALPAY_ENABLED_KEY = 'manual_payment_enabled';

/** Proof screenshots sit beside the bookkeeping documents: never under the public uploads mount. */
export const PROOFS_DIR = path.join(DOCUMENTS_DIR, 'proofs');

export function defaultManualPayConfig(): CheckoutConfig {
  return {
    branding: {
      merchantName: 'Ascend MY',
      accentColor: '#0074d4',
      supportUrl: `https://wa.me/${env.WHATSAPP_NUMBER}`,
      supportLabel: 'WhatsApp us',
      termsUrl: `${env.FRONTEND_URL}/terms`,
      privacyUrl: `${env.FRONTEND_URL}/privacy`,
    },
    // Nothing enabled until the admin fills in real account details — an empty
    // method list renders a "contact us" page, never a page with placeholder
    // bank numbers a customer could pay into.
    methods: [],
    sessionTtlSeconds: 48 * 3600,
  };
}

export async function loadManualPayConfig(fastify: FastifyInstance): Promise<CheckoutConfig> {
  const row = await fastify.prisma.setting.findUnique({ where: { key: MANUALPAY_CONFIG_KEY } });
  if (!row) return defaultManualPayConfig();
  try {
    return checkoutConfigSchema.parse(JSON.parse(row.value));
  } catch (err) {
    // A corrupt setting must not take checkout down; log and run with defaults.
    fastify.log.error({ err }, 'manualpay_config is not a valid CheckoutConfig — using defaults');
    return defaultManualPayConfig();
  }
}

export async function isManualPayEnabled(fastify: FastifyInstance): Promise<boolean> {
  const row = await fastify.prisma.setting.findUnique({ where: { key: MANUALPAY_ENABLED_KEY } });
  return row?.value === 'true';
}

async function orderForSession(fastify: FastifyInstance, reference: string) {
  return fastify.prisma.order.findFirst({
    where: { orderNumber: reference, paymentGateway: MANUALPAY_GATEWAY, deletedAt: null },
  });
}

export function buildManualPayGate(fastify: FastifyInstance): ManualPayGate {
  return createManualPayGate({
    store: new PrismaSessionStore(fastify.prisma as unknown as PrismaLike),
    files: new DiskProofFileStore(PROOFS_DIR),
    config: () => loadManualPayConfig(fastify),
    logger: {
      info: (...a) => fastify.log.info(a.map(String).join(' ')),
      warn: (...a) => fastify.log.warn(a.map(String).join(' ')),
      error: (...a) => fastify.log.error(a.map(String).join(' ')),
    },
    hooks: {
      onProofSubmitted: async (session) => {
        fastify.log.info(`ManualPay: proof submitted for ${session.reference} (${session.id})`);
        // The page asks for an email (Stripe does too). An order placed
        // without one gets it now, so the receipt email has somewhere to go.
        const email = session.customer?.email;
        if (email) {
          const { count } = await fastify.prisma.order.updateMany({
            where: { orderNumber: session.reference, paymentGateway: MANUALPAY_GATEWAY, email: null },
            data: { email },
          });
          // The order was placed without an address, so no confirmation was
          // queued at checkout. Queue it now that there is somewhere to send
          // it — the (orderId, type) unique key keeps this a one-off.
          if (count > 0) {
            const order = await orderForSession(fastify, session.reference);
            if (order) await fastify.prisma.$transaction((tx) => enqueueEmail(tx, order, 'ORDER_CONFIRMATION'));
          }
        }
      },
      // The one transition that touches money: the same guarded UNPAID → PAID
      // path every gateway uses, so the receipt email, CONFIRMED status and
      // the purchase analytics event all happen exactly once.
      onPaid: async (session, _proof, reviewer) => {
        const order = await orderForSession(fastify, session.reference);
        if (!order) {
          fastify.log.error(`ManualPay: session ${session.id} PAID but no order ${session.reference}`);
          return;
        }
        const moved = await applyPaid(fastify, order);
        fastify.log.info(`ManualPay: ${order.orderNumber} ${moved ? 'marked PAID' : 'was already PAID'} (reviewed by ${reviewer})`);
      },
      onRejected: async (session, _proof, reason, reviewer) => {
        fastify.log.info(`ManualPay: ${session.reference} proof rejected by ${reviewer}: ${reason}`);
      },
      // The session outlived its window with nothing accepted: release the
      // stock the order reserved, same guarded cancel the 48h WhatsApp sweep
      // does for plain WhatsApp orders.
      onExpired: async (session) => {
        const order = await orderForSession(fastify, session.reference);
        if (!order || order.paymentStatus === 'PAID') return;
        const { count } = await fastify.prisma.order.updateMany({
          where: { id: order.id, status: 'PENDING', paymentStatus: 'UNPAID' },
          data: { status: 'CANCELLED' },
        });
        if (count === 0) return;
        await restoreOrderInventory(fastify, order.id);
        fastify.log.info(`Order ${order.orderNumber} auto-cancelled (ManualPay session expired) — stock restored`);
      },
    },
  });
}

declare module 'fastify' {
  interface FastifyInstance {
    manualPay: ManualPayGate;
  }
}

export default fp(async (fastify) => {
  fastify.decorate('manualPay', buildManualPayGate(fastify));
});
