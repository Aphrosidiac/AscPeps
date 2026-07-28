import { PostHog } from 'posthog-node';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';

/**
 * Server-side PostHog client.
 *
 * Why this exists at all: the storefront's client-side `checkout_submitted`
 * event fires when an order row is CREATED, which for online payment is before
 * the customer has even seen the gateway. Orders get abandoned there routinely
 * (that's what reconcileStaleOrders exists to clean up), so counting revenue
 * from the browser would overstate it by every abandoned checkout. Money is
 * only real once the payment is confirmed server-side — so `purchase` is
 * emitted from here, never from the browser.
 *
 * Null when unconfigured: no key (or POSTHOG_ENABLED=false) disables capture
 * entirely rather than erroring, so the site runs identically without it.
 */
let client: PostHog | null = null;
let initialised = false;

function getClient(): PostHog | null {
  if (initialised) return client;
  initialised = true;

  if (!env.POSTHOG_ENABLED || !env.POSTHOG_API_KEY) return null;

  client = new PostHog(env.POSTHOG_API_KEY, {
    host: env.POSTHOG_HOST,
    // Purchases are rare and individually valuable — dispatch on capture
    // rather than batching. This also means there's nothing meaningful left
    // to flush at shutdown, which matters here: server.ts installs no
    // SIGTERM/SIGINT handling, so a PM2 restart kills the process outright
    // and any queued-but-unsent batch would simply be lost.
    flushAt: 1,
    flushInterval: 0,
  });
  return client;
}

type PurchaseOrder = {
  orderNumber: string;
  total: number;
  subtotal?: number;
  shippingFee?: number;
  discountAmount?: number;
  paymentMethod: string;
  paymentGateway?: string | null;
};

/**
 * Emit the `purchase` event for a confirmed-paid order.
 *
 * distinct_id is `order_<orderNumber>` — deliberately NOT the customer's email
 * or phone. The browser calls posthog.alias() with the same string at checkout,
 * which merges this event onto the person who actually browsed, so the funnel
 * joins up without any PII ever reaching PostHog.
 *
 * Safe to call more than once per order in principle, but both call sites are
 * already behind guarded UNPAID -> PAID transitions, so in practice it fires
 * exactly once.
 *
 * Never throws: analytics must not be able to fail a payment confirmation.
 */
export function capturePurchase(fastify: FastifyInstance, order: PurchaseOrder): void {
  const ph = getClient();
  if (!ph) return;

  try {
    ph.capture({
      distinctId: `order_${order.orderNumber}`,
      event: 'purchase',
      properties: {
        order_number: order.orderNumber,
        // Cents are the storage unit everywhere in this codebase; PostHog's
        // revenue views want a major-unit number, so send both and never
        // make the dashboard do the division.
        revenue: order.total / 100,
        currency: 'MYR',
        total_cents: order.total,
        subtotal_cents: order.subtotal,
        shipping_fee_cents: order.shippingFee,
        discount_amount_cents: order.discountAmount,
        discount_applied: (order.discountAmount ?? 0) > 0,
        payment_method: order.paymentMethod,
        payment_gateway: order.paymentGateway ?? undefined,
      },
    });
  } catch (err) {
    fastify.log.warn({ err, orderNumber: order.orderNumber }, 'posthog: purchase capture failed');
  }
}
