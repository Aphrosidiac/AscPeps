import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';
import { getGatewayByBillId } from '../../utils/payment-gateway.js';
import { applyPaid, applyFailed } from '../../utils/payment-reconcile.js';

export async function handlePaymentCallback(fastify: FastifyInstance, body: Record<string, string>) {
  const isBillplz = !!body.x_signature;
  const billId = isBillplz ? body.id : body.billcode;
  const gatewayName = isBillplz ? 'billplz' : 'toyyibpay';

  const gateway = getGatewayByBillId(billId, gatewayName);
  if (!gateway) {
    fastify.log.warn(`Payment callback: unknown gateway for bill ${billId}`);
    return { status: 'ok' };
  }

  if (!gateway.verifyCallback(body)) {
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
    const paid = await applyPaid(fastify, order);
    if (paid) {
      fastify.log.info(`Order ${order.orderNumber} paid via ${gateway.name} (bill ${result.billId})`);
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
  const gatewayName = isBillplz ? 'billplz' : 'toyyibpay';
  const billId = isBillplz ? query['billplz[id]'] : query.billcode || '';

  const gateway = getGatewayByBillId(billId, gatewayName);
  if (!gateway) return `${env.FRONTEND_URL}/checkout/failed`;

  // Not belt-and-suspenders any more — this IS the primary confirmation path.
  // ToyyibPay's server-to-server callback has never once been delivered to
  // this origin, so every online payment is confirmed either here or by the
  // reconcile sweep. Verify server-side and confirm the order.
  let verifiedPaid = false;
  if (billId) {
    try {
      const { paid } = await gateway.verifyPaid(billId);
      verifiedPaid = paid;
      if (paid) {
        const order = await fastify.prisma.order.findFirst({ where: { paymentRef: billId } });
        if (order) await applyPaid(fastify, order);
      }
    } catch (err) {
      fastify.log.warn({ err, billId }, 'redirect: gateway verify failed');
    }
  }

  // Pass the verified state through so the page the customer sees can never
  // contradict the order state we just committed.
  return gateway.buildRedirectUrl(query, verifiedPaid);
}
