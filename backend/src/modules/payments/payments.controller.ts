import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';
import { getGatewayByBillId } from '../../utils/payment-gateway.js';
import { verifyRedirectSignature as verifyBillplzRedirect } from '../../utils/billplz.js';
import { applyPaid, applyFailed } from '../../utils/payment-reconcile.js';
import { inspectAndRecord, recordPaymentEvent, withoutSignature } from '../../utils/payment-trail.js';
import type { ClientContext } from '../../utils/payment-trail.js';
import type { PayLinkSource } from '../../utils/payment-gateway.js';

export async function handlePaymentCallback(fastify: FastifyInstance, body: Record<string, string>) {
  const isBillplz = !!body.x_signature;
  const billId = isBillplz ? body.id : body.billcode;
  const gatewayName = isBillplz ? 'billplz' : 'toyyibpay';

  const gateway = getGatewayByBillId(billId, gatewayName);
  if (!gateway) {
    fastify.log.warn(`Payment callback: unknown gateway for bill ${billId}`);
    return { status: 'ok' };
  }

  const signatureValid = gateway.verifyCallback(body);
  // Every callback goes on the order's trail, the refused ones included — a
  // run of invalid signatures is exactly what explains "paid on Billplz, still
  // UNPAID here". Only for a bill that is really ours, so a forged flood
  // against made-up ids writes nothing.
  const trailOrder = billId
    ? await fastify.prisma.order.findFirst({ where: { paymentRef: billId }, select: { id: true } })
    : null;
  if (trailOrder) {
    await recordPaymentEvent(fastify, {
      orderId: trailOrder.id,
      type: 'CALLBACK',
      gateway: gateway.name,
      data: { signatureValid, fields: withoutSignature(body) },
    });
  }

  if (!signatureValid) {
    // Don't log the full body — a forged/invalid callback may carry attacker- or
    // customer-supplied PII. The bill id is enough to investigate.
    fastify.log.warn({ gateway: gateway.name, billId }, 'Payment callback: invalid signature');
    throw { statusCode: 400, message: 'Invalid signature' };
  }

  const result = gateway.parseCallback(body);

  // Pending callbacks (e.g. ToyyibPay status 2) are not final — do nothing and
  // wait for the success/fail callback. Marking them failed here would block the
  // later success callback from ever confirming the order.
  if (result.status === 'pending') {
    return { status: 'ok' };
  }

  const order = await fastify.prisma.order.findFirst({
    where: { paymentRef: result.billId },
  });

  if (!order) {
    fastify.log.warn(`${gateway.name} callback: no order for bill ${result.billId}`);
    return { status: 'ok' };
  }

  if (order.paymentStatus === 'FAILED' && result.status === 'paid') {
    // Paid after we gave up and released the stock: a customer who was already
    // on the bank page when the bill was closed. The money has arrived, so this
    // needs a person — reinstate the order or refund it.
    fastify.log.error(
      { orderNumber: order.orderNumber, gateway: gateway.name, billId: result.billId, amount: result.amount },
      'LATE PAYMENT: money received for an order already released as FAILED — reinstate or refund by hand'
    );
    await recordPaymentEvent(fastify, {
      orderId: order.id,
      type: 'LATE_PAYMENT',
      gateway: gateway.name,
      data: { via: 'callback', amount: result.amount },
    });
    return { status: 'ok' };
  }
  if (order.paymentStatus === 'PAID' || order.paymentStatus === 'FAILED') {
    return { status: 'ok' };
  }

  if (result.status === 'paid') {
    if (result.amount != null && result.amount !== order.total) {
      // Amount is server-controlled (the payer can't change the bill), so this
      // is a flag for investigation, not a hard block — we still confirm.
      fastify.log.warn(
        { orderNumber: order.orderNumber, expected: order.total, received: result.amount },
        'Payment amount mismatch'
      );
    }
    const paid = await applyPaid(fastify, order, 'callback');
    if (paid) {
      fastify.log.info(`Order ${order.orderNumber} paid via ${gateway.name} (bill ${result.billId})`);
      // The callback says paid but not how: one look at the bill stores the
      // winning attempt with its channel (and any failed tries before it).
      // After answering, so the gateway's 20 s budget is never at risk.
      setImmediate(() => {
        inspectAndRecord(fastify, order, 'callback').catch(() => {});
      });
    }
  } else {
    // Only reachable for an explicit gateway failure — 'pending' returned above.
    // The gateway told us the transaction was refused, so the customer did pick
    // a method and try: that is a DECLINE, never an abandon.
    await applyFailed(fastify, order.id, { reason: 'DECLINED' });
    fastify.log.info(`Order ${order.orderNumber} payment failed via ${gateway.name} (bill ${result.billId})`);
  }

  return { status: 'ok' };
}

export async function handlePaymentRedirect(
  fastify: FastifyInstance,
  query: Record<string, string>
): Promise<string> {
  const isBillplz = !!query['billplz[id]'];
  const isBtcpay = !isBillplz && query.gateway === 'btcpay';
  const gatewayName = isBillplz ? 'billplz' : isBtcpay ? 'btcpay' : 'toyyibpay';

  let billId = isBillplz ? query['billplz[id]'] : isBtcpay ? '' : query.billcode || '';
  if (isBtcpay && query.orderNumber) {
    // BTCPay's redirect URL is built before the invoice exists, so it can't
    // carry the invoice id the way billplz/toyyibpay's signed redirects do —
    // it carries orderNumber instead. Resolve it back to the invoice id via
    // the order row, and pass it through so buildRedirectUrl can still build
    // a "resume this payment" link on failure.
    const order = await fastify.prisma.order.findFirst({ where: { orderNumber: query.orderNumber } });
    if (order?.paymentRef) {
      billId = order.paymentRef;
      query.invoiceId = billId;
    }
  }

  const gateway = getGatewayByBillId(billId, gatewayName);
  if (!gateway) return `${env.FRONTEND_URL}/checkout/failed`;

  // The customer is back from the gateway: record exactly what it handed back
  // (for Billplz with "Extra Payment Completion Information" on, that includes
  // the attempt's id and status), whether or not it verifies.
  const returnedOrder = billId
    ? await fastify.prisma.order.findFirst({ where: { paymentRef: billId }, select: { id: true } })
    : null;
  if (returnedOrder) {
    await recordPaymentEvent(fastify, {
      orderId: returnedOrder.id,
      type: 'RETURNED',
      gateway: gateway.name,
      data: {
        signatureValid: isBillplz ? verifyBillplzRedirect(query) : undefined,
        params: withoutSignature(query),
      },
    });
  }

  // Not belt-and-suspenders any more — this IS the primary confirmation path.
  // ToyyibPay's server-to-server callback has never once been delivered to
  // this origin, so every online payment is confirmed either here or by the
  // reconcile sweep. Verify server-side and confirm the order.
  let verifiedPaid = false;
  if (billId) {
    try {
      const order = await fastify.prisma.order.findFirst({ where: { paymentRef: billId } });
      // A failed return is the one moment a failed attempt can be seen as it
      // happens (Billplz sends no callback for one), so the bill's attempts
      // are read and stored here, paid or not.
      const inspection = order ? await inspectAndRecord(fastify, order, 'return') : null;
      const { paid } = inspection ?? (await gateway.verifyPaid(billId));
      verifiedPaid = paid;
      if (paid) {
        if (order?.paymentStatus === 'FAILED') {
          fastify.log.error(
            { orderNumber: order.orderNumber, gateway: gatewayName, billId },
            'LATE PAYMENT: money received for an order already released as FAILED — reinstate or refund by hand'
          );
          await recordPaymentEvent(fastify, { orderId: order.id, type: 'LATE_PAYMENT', gateway: gatewayName, data: { via: 'return' } });
        } else if (order) {
          await applyPaid(fastify, order, 'return');
        }
      }
    } catch (err) {
      fastify.log.warn({ err, billId }, 'redirect: gateway verify failed');
    }
  }

  // Pass the verified state through so the page the customer sees can never
  // contradict the order state we just committed.
  return gateway.buildRedirectUrl(query, verifiedPaid);
}


/**
 * The pay link (payLink in utils/payment-gateway.ts): note that the customer
 * opened the payment page, and from where, then send them to the gateway's
 * page for the bill. An id that is not one of our bills goes to the failed
 * page rather than anywhere the link could be made to point.
 */
export async function handlePayLink(
  fastify: FastifyInstance,
  billId: string,
  src: string | undefined,
  client: ClientContext
): Promise<string> {
  const order = await fastify.prisma.order.findFirst({
    where: { paymentRef: billId, paymentGateway: { in: ['billplz', 'toyyibpay'] } },
    select: { id: true, paymentGateway: true, paymentStatus: true, status: true },
  });
  if (!order) return `${env.FRONTEND_URL}/checkout/failed`;
  const gateway = getGatewayByBillId(billId, order.paymentGateway ?? undefined);
  if (!gateway) return `${env.FRONTEND_URL}/checkout/failed`;

  const source: PayLinkSource | 'other' =
    src === 'checkout' || src === 'email' || src === 'retry' || src === 'track' ? src : 'other';
  await recordPaymentEvent(fastify, {
    orderId: order.id,
    type: 'PAGE_OPENED',
    gateway: gateway.name,
    data: { src: source, paymentStatus: order.paymentStatus, status: order.status, client },
  });
  return gateway.billUrl(billId);
}
