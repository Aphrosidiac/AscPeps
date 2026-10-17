import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';
import { getGatewayByBillId } from '../../utils/payment-gateway.js';
import { applyPaid, applyFailed } from '../../utils/payment-reconcile.js';
import { verifyCallbackSignature as verifyChipSignature } from '../../utils/chip.js';

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
  // BTCPay and CHIP both mint their payment id only when the create call
  // returns, so their redirect URLs can't carry it the way billplz/toyyibpay's
  // signed redirects do — they carry orderNumber instead, and it is resolved
  // back to the payment id via the order row. Pinned to the named gateway so
  // a hand-edited ?gateway= can't make one gateway verify another's order.
  const byOrderNumber = !isBillplz && (query.gateway === 'btcpay' || query.gateway === 'chip');
  const gatewayName = isBillplz ? 'billplz' : byOrderNumber ? query.gateway : 'toyyibpay';

  let billId = isBillplz ? query['billplz[id]'] : byOrderNumber ? '' : query.billcode || '';
  if (byOrderNumber && query.orderNumber) {
    const order = await fastify.prisma.order.findFirst({
      where: { orderNumber: query.orderNumber, paymentGateway: gatewayName },
    });
    if (order?.paymentRef) {
      billId = order.paymentRef;
      // So buildRedirectUrl can still offer a "resume this payment" link.
      if (gatewayName === 'btcpay') query.invoiceId = billId;
      else query.purchaseId = billId;
    }
  }

  const gateway = getGatewayByBillId(billId, gatewayName);
  if (!gateway) return `${env.FRONTEND_URL}/checkout/failed`;

  // Not belt-and-suspenders any more — this IS the primary confirmation path.
  // ToyyibPay's server-to-server callback has never once been delivered to
  // this origin, so every online payment is confirmed either here or by the
  // reconcile sweep. Verify server-side and confirm the order.
  let verifiedPaid = false;
  if (billId) {
    try {
      const { paid, fee } = await gateway.verifyPaid(billId);
      verifiedPaid = paid;
      if (paid) {
        const order = await fastify.prisma.order.findFirst({ where: { paymentRef: billId } });
        if (order) await applyPaid(fastify, order, { fee });
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
 * CHIP's success callback: POSTed when a purchase is paid, a JSON-encoded
 * Purchase signed (X-Signature) over the raw body. CHIP retries any non-2xx up
 * to 8 times over 36 hours, and may deliver the same callback twice, so every
 * outcome after the signature check is a 200 and applyPaid's guarded
 * transition makes repeats no-ops.
 *
 * The payload only identifies the purchase. Whether it is paid is asked of
 * CHIP itself through verifyPaid — the same question the redirect and the
 * sweep ask — so the live-deployment test-key guard and the real fee figure
 * apply here exactly as they do there.
 */
export async function handleChipCallback(
  fastify: FastifyInstance,
  rawBody: Buffer,
  signature: string | undefined
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  let valid = false;
  try {
    valid = await verifyChipSignature(rawBody, signature);
  } catch (err) {
    // Couldn't fetch the public key. A 5xx makes CHIP retry later, which is
    // what we want — the payment is real, we just can't check it right now.
    fastify.log.error({ err }, 'CHIP callback: could not load the public key');
    return { statusCode: 503, body: { error: 'Signature key unavailable' } };
  }
  if (!valid) {
    fastify.log.warn('CHIP callback: invalid signature');
    return { statusCode: 400, body: { error: 'Invalid signature' } };
  }

  let purchaseId: string | undefined;
  try {
    const payload = JSON.parse(rawBody.toString('utf8'));
    purchaseId = typeof payload?.id === 'string' ? payload.id : undefined;
  } catch {
    // Signed but unparseable: nothing a retry would fix.
  }
  if (!purchaseId) return { statusCode: 200, body: { received: true } };

  const order = await fastify.prisma.order.findFirst({
    where: { paymentRef: purchaseId, paymentGateway: 'chip' },
  });
  if (!order) {
    fastify.log.warn(`CHIP callback: no order for purchase ${purchaseId}`);
    return { statusCode: 200, body: { received: true } };
  }
  if (order.paymentStatus !== 'UNPAID') return { statusCode: 200, body: { received: true } };

  const gateway = getGatewayByBillId(purchaseId, 'chip')!;
  try {
    const result = await gateway.verifyPaid(purchaseId);
    if (result.paid) {
      if (result.amount != null && result.amount !== order.total) {
        fastify.log.warn(
          { orderNumber: order.orderNumber, expected: order.total, received: result.amount },
          'Payment amount mismatch'
        );
      }
      if (await applyPaid(fastify, order, { fee: result.fee })) {
        fastify.log.info(`Order ${order.orderNumber} paid via chip (purchase ${purchaseId})`);
      }
    }
  } catch (err) {
    // CHIP is up enough to call us but not to answer: let it retry.
    fastify.log.warn({ err, purchaseId }, 'CHIP callback: verify failed');
    return { statusCode: 503, body: { error: 'Verify failed' } };
  }
  return { statusCode: 200, body: { received: true } };
}
