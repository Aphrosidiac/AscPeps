import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { generateOrderNumber } from '../../utils/order-number.js';
import { buildWhatsAppUrl } from '../../utils/whatsapp.js';
import { getActiveGateway, isOnlineMethod, gatewayNameForMethod, payLink, type PaymentGateway } from '../../utils/payment-gateway.js';
import { recordPaymentEvent, type ClientContext } from '../../utils/payment-trail.js';
import { resolveOrderLines, linesSubtotal, stockDemand, OrderLineError, groupOrderItems, groupedLineTotal, includesText, itemName, type ResolvedLine } from '../../utils/order-lines.js';
import { validateDiscountCode } from '../admin/admin-discounts.controller.js';
import { normalizePhone } from '../../utils/phone.js';
import { env } from '../../config/env.js';
import { getVariantDisplayName } from '../../utils/product-addons.js';
import { enqueueEmail } from '../../utils/email-outbox.js';
import { notifyOrder } from '../../utils/order-notify.js';
import { newUnsubscribeToken } from '../../utils/marketing.js';
import { isEastMalaysia, parseEastMalaysiaMinOrder, eastMalaysiaMinOrderMessage, resolveShippingFeeSen, deliveryRegion } from '../../utils/shipping-region.js';
import { parseTracking } from '../../utils/courier.js';
import { MANUALPAY_GATEWAY, isManualPayEnabled } from '../../plugins/manualpay.js';
import { resolveManualDiscount, type ManualDiscountInput } from '../../utils/manual-discount.js';

const createOrderSchema = z.object({
  customerName: z.string().min(1),
  phone: z.string().min(1).transform(normalizePhone),
  // The checkout form sends "" when the (optional) email is left blank —
  // treat that as absent instead of failing .email() validation.
  email: z.preprocess((v) => (v === '' ? undefined : v), z.string().email().optional()),
  address: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  postcode: z.string().min(1),
  // MANUAL is an API-level value only: it is stored as WHATSAPP (the manual
  // method) with paymentGateway 'manualpaygate', so the PaymentMethod enum
  // never needs an ALTER TYPE. See plugins/manualpay.ts.
  paymentMethod: z.enum(['WHATSAPP', 'BILLPLZ', 'CRYPTO', 'MANUAL']),
  discountCode: z.string().optional(),
  notes: z.string().optional(),
  // Checkout's newsletter tickbox. Defaults to false and is never inferred
  // from the presence of an email address — buying something is not consent
  // to be marketed to, and treating it as such is what makes a list worth
  // nothing and a sending domain worth less.
  subscribe: z.boolean().optional(),
  idempotencyKey: z.string().min(8).max(100).optional(),
  items: z.array(
    z.object({
      variantId: z.string(),
      quantity: z.number().int().min(1).max(100),
      // Optional INCLUDED add-ons ticked for this line (see utils/order-lines.ts).
      addOnIds: z.array(z.string()).max(20).optional(),
    })
  ).min(1).max(50),
}).superRefine((data, ctx) => {
  // ToyyibPay rejects createBill outright with an empty billEmail — catch this
  // before the order transaction runs, not after stock is already reserved.
  // CRYPTO needs one for a different reason: a Bitcoin payment can settle long
  // after the customer has closed the tab, so email is the only way to tell
  // them it cleared.
  if (isOnlineMethod(data.paymentMethod) && !data.email) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['email'], message: 'Email is required for online payment' });
  }
  // Cap total units per order — an unauthenticated checkout (especially
  // WhatsApp, which needs no payment) must not be able to reserve the whole
  // inventory in one request.
  const totalQuantity = data.items.reduce((sum, i) => sum + i.quantity, 0);
  if (totalQuantity > 50) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'Order exceeds the maximum of 50 items. Please contact us for bulk orders.' });
  }
});

/**
 * Whether the store is currently accepting crypto. Defaults to OFF — only the
 * literal string 'true' counts, so an absent row (every deployment that has
 * never touched the setting) means disabled rather than enabled.
 */
async function isCryptoEnabled(fastify: FastifyInstance): Promise<boolean> {
  const setting = await fastify.prisma.setting.findUnique({
    where: { key: 'crypto_payment_enabled' },
  });
  return setting?.value === 'true';
}

// Rebuild the online-payment URL for an already-created order (used on the
// idempotent-retry path, where the original bill should be reused).
/**
 * The hosted checkout session for a MANUAL order — created on first call,
 * found again on every later one (idempotent on orderNumber). Split out from
 * createOrder because the order row commits BEFORE the session exists: a
 * retry that hits the idempotency key must be able to finish the job rather
 * than hand back an order with no way to pay for it.
 */
async function ensureManualPaySession(
  fastify: FastifyInstance,
  order: { id: string; orderNumber: string; total: number; subtotal: number; shippingFee: number; discountAmount: number; customerName: string; email: string | null; phone: string; paymentRef: string | null },
  discountLabel?: string,
): Promise<string> {
  if (order.paymentRef) return `${env.FRONTEND_URL}/pay/${order.paymentRef}`;
  const full = await fastify.prisma.order.findUniqueOrThrow({
    where: { id: order.id },
    include: { items: { include: { variant: { include: { product: true } } } } },
  });
  // The session snapshots the order's lines and totals (what the customer
  // sees on the page is what the admin later compares against the
  // screenshot), and the order carries the session id as paymentRef so the
  // two can always find each other.
  const session = await fastify.manualPay.createSession({
    reference: full.orderNumber,
    amount: full.total,
    currency: 'MYR',
    idempotent: true,
    // One line per product the customer chose. What came included is named
    // under it, and a priced include is added to its line's amount, so the
    // page's lines still add up to the subtotal.
    lineItems: groupOrderItems(full.items).lines.map((line) => {
      const total = groupedLineTotal(line);
      return {
        name: line.includes.length ? `${itemName(line.item)} (incl. ${includesText(line.includes)})` : itemName(line.item),
        quantity: line.item.quantity,
        unitAmount: Math.round(total / line.item.quantity),
      };
    }),
    amounts: {
      subtotal: full.subtotal,
      shipping: full.shippingFee,
      discount: full.discountAmount > 0 ? { label: discountLabel, amount: full.discountAmount } : undefined,
    },
    customer: { name: full.customerName, email: full.email ?? undefined, phone: full.phone },
    successUrl: `${env.FRONTEND_URL}/checkout/success?manual=1&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${env.FRONTEND_URL}/cart`,
    metadata: { orderId: full.id },
  });
  await fastify.prisma.order.update({ where: { id: full.id }, data: { paymentRef: session.id } });
  return `${env.FRONTEND_URL}/pay/${session.id}`;
}

function reconstructPaymentUrl(order: { paymentGateway: string | null; paymentRef: string | null }): string | undefined {
  // Through the pay link, as the first checkout was: the visit is recorded.
  if ((order.paymentGateway === 'billplz' || order.paymentGateway === 'toyyibpay') && order.paymentRef) {
    return payLink(order.paymentRef, 'checkout');
  }
  // A BTCPay invoice URL is derivable from its id, so a retry hands the
  // customer back the invoice they already have rather than minting a second
  // one — which matters more here than for fiat: a new invoice would carry a
  // freshly quoted BTC rate instead of the one they were shown.
  if (order.paymentGateway === 'btcpay' && order.paymentRef && env.BTCPAY_URL) {
    return `${env.BTCPAY_URL}/i/${order.paymentRef}`;
  }
  // The hosted manual checkout is ours, so the page is always re-openable.
  if (order.paymentGateway === MANUALPAY_GATEWAY && order.paymentRef) {
    return `${env.FRONTEND_URL}/pay/${order.paymentRef}`;
  }
  return undefined; // Billplz bill URL isn't persisted; the customer must re-open from email
}

// P2002 field extraction mirrors error-handler.ts: the driver-adapter build
// reports the violated constraint under meta.driverAdapterError, not meta.target.
function isOrderNumberConflict(err: unknown): boolean {
  const meta = (err as { meta?: { target?: string | string[]; driverAdapterError?: { cause?: { constraint?: { fields?: string[] } } } } })?.meta;
  const fields = meta?.target ?? meta?.driverAdapterError?.cause?.constraint?.fields;
  return Array.isArray(fields)
    ? fields.includes('orderNumber')
    : typeof fields === 'string' && fields.includes('orderNumber');
}

// `internal` is for callers inside the building only — the assistant keying an
// order agreed over WhatsApp. It is deliberately NOT part of the body schema:
// the public checkout route passes the request body alone, so a browser can
// never name its own discount.
export interface CreateOrderInternal {
  manualDiscount?: ManualDiscountInput;
}

// `client` is the browser that placed the order (device, country), read by the
// route from the request headers — never from the body. Absent for orders the
// assistant keys in.
export async function createOrder(
  fastify: FastifyInstance,
  body: unknown,
  internal: CreateOrderInternal = {},
  client?: ClientContext
) {
  const data = createOrderSchema.parse(body);

  // Refuse a switched-off payment method BEFORE anything is written. The
  // gateway checks further down run after the order transaction has committed,
  // so a rejection there still leaves an UNPAID order holding reserved stock
  // until the sweep releases it. That's a tolerable outcome for a gateway that
  // hiccups mid-checkout; it is not one for a method that is deliberately
  // turned off, where every such request is pure garbage in the orders table.
  // Matters most right now: crypto ships disabled, so this is the path any
  // stray or probing CRYPTO request takes.
  if (data.paymentMethod === 'CRYPTO' && !(await isCryptoEnabled(fastify))) {
    throw { statusCode: 503, message: 'Crypto payment is currently unavailable. Please choose another payment method.' };
  }
  if (data.paymentMethod === 'MANUAL' && !(await isManualPayEnabled(fastify))) {
    throw { statusCode: 503, message: 'Bank transfer checkout is currently unavailable. Please choose another payment method.' };
  }
  const isManualPay = data.paymentMethod === 'MANUAL';

  // The online gateway is resolved BEFORE anything is written, for the same
  // reason: a missing or refused gateway used to be discovered only after the
  // order had committed, leaving an UNPAID order with no bill, stock held and
  // a confirmation email sent — and a retry then showed "Order Received" for
  // it (ASC2610/0037, 2026-10-19).
  let onlineGateway: PaymentGateway | null = null;
  if (isOnlineMethod(data.paymentMethod)) {
    onlineGateway = await resolveOnlineGateway(fastify, data.paymentMethod);
  }

  // Idempotency: a network retry of a request the server already committed must
  // NOT create a second order (double stock decrement + double bill = double
  // charge). Return the original order instead.
  if (data.idempotencyKey) {
    const existing = await fastify.prisma.order.findUnique({
      where: { idempotencyKey: data.idempotencyKey },
    });
    if (existing) {
      if (existing.paymentGateway === MANUALPAY_GATEWAY) {
        return { order: existing, paymentUrl: await ensureManualPaySession(fastify, existing, data.discountCode?.toUpperCase()) };
      }
      // The first attempt committed the order but never got a bill (the gateway
      // call failed). Open it now rather than handing back no way to pay.
      if (onlineGateway && !existing.paymentRef && existing.paymentStatus === 'UNPAID') {
        return { order: existing, paymentUrl: await openBill(fastify, existing, onlineGateway) };
      }
      return { order: existing, paymentUrl: reconstructPaymentUrl(existing) };
    }
  }

  const runCreateTransaction = () =>
    fastify.prisma.$transaction(async (tx) => {
    // The order's real lines: each chosen product with the add-ons it includes
    // (required ones always, optional ones when ticked), built from the
    // product's settings rather than trusted from the client. Stock is checked
    // per variant across all of them; see utils/order-lines.ts.
    const now = new Date();
    let lines: ResolvedLine[];
    try {
      lines = await resolveOrderLines(tx, data.items, {
        now,
        warn: (msg, detail) => fastify.log.warn(detail, msg),
      });
    } catch (err) {
      if (err instanceof OrderLineError) throw { statusCode: 400, message: err.message };
      throw err;
    }
    const subtotal = linesSubtotal(lines);

    // East Malaysia minimum. Checked here — after required add-ons have been
    // injected and the real subtotal is known, but before the discount code
    // reservation below — so a rejected order never burns a use of a capped
    // code. (The transaction would roll that back anyway; not depending on it
    // is cheaper and clearer.)
    //
    // The threshold is measured against the goods subtotal: before the
    // discount and before shipping. Measuring after the discount would let a
    // 50%-off code turn an RM800 order into an RM400 one and defeat the rule
    // that exists to cover what East Malaysia costs to ship.
    //
    // Only read the East settings for an order actually going east — that's a
    // small minority of orders, and every other one shouldn't pay for the query.
    const goingEast = isEastMalaysia(data.state);
    let eastShippingFeeValue: string | undefined;
    if (goingEast) {
      const eastSettings = await tx.setting.findMany({
        where: { key: { in: ['east_malaysia_min_order', 'east_malaysia_shipping_fee'] } },
      });
      const eastSetting = (key: string) => eastSettings.find((s) => s.key === key)?.value;
      const minOrder = parseEastMalaysiaMinOrder(eastSetting('east_malaysia_min_order'));
      if (minOrder > 0 && subtotal < minOrder) {
        const message = eastMalaysiaMinOrderMessage(minOrder);
        throw { statusCode: 400, message, details: [{ path: 'state', message }] };
      }
      eastShippingFeeValue = eastSetting('east_malaysia_shipping_fee');
    }

    const shippingSetting = await tx.setting.findUnique({ where: { key: 'shipping_fee' } });
    // No shipping only when every chosen product is noShipping (schema.prisma);
    // what comes included with a line rides along with it.
    const shippingFee = lines.every((l) => l.noShipping)
      ? 0
      : resolveShippingFeeSen(shippingSetting?.value, eastShippingFeeValue, goingEast);

    let discountAmount = 0;
    let discountCodeId: string | undefined;
    if (data.discountCode) {
      const result = await validateDiscountCode(fastify, data.discountCode, subtotal);
      discountAmount = result.discountAmount;
      discountCodeId = result.discount.id;
      // Atomically reserve one use so concurrent orders can't push a capped code
      // past maxUses (the read-based check above is racy on its own).
      if (result.discount.maxUses != null) {
        const reserved = await tx.discountCode.updateMany({
          where: { id: discountCodeId, usedCount: { lt: result.discount.maxUses } },
          data: { usedCount: { increment: 1 } },
        });
        if (reserved.count === 0) {
          throw { statusCode: 400, message: 'This discount code has reached its usage limit' };
        }
      } else {
        await tx.discountCode.update({
          where: { id: discountCodeId },
          data: { usedCount: { increment: 1 } },
        });
      }
    }

    // A discount the operator gave by hand stacks on top of any code: the two
    // are different promises ("use code X" and "I'll knock RM10 off for you")
    // and both were made. Capped together so the total cannot go negative.
    let discountNote: string | null = null;
    if (internal.manualDiscount) {
      const manual = resolveManualDiscount(internal.manualDiscount, { subtotal, shippingFee });
      discountAmount = Math.min(discountAmount + manual.amount, subtotal + shippingFee);
      discountNote = manual.note;
    }

    const total = Math.max(subtotal + shippingFee - discountAmount, 0);
    const orderNumber = await generateOrderNumber(tx);

    const order = await tx.order.create({
      data: {
        orderNumber,
        customerName: data.customerName,
        phone: data.phone,
        email: data.email,
        address: data.address,
        city: data.city,
        state: data.state,
        postcode: data.postcode,
        subtotal,
        shippingFee,
        discountAmount,
        discountNote,
        total,
        paymentMethod: isManualPay ? 'WHATSAPP' : (data.paymentMethod as 'WHATSAPP' | 'BILLPLZ' | 'CRYPTO'),
        paymentGateway: isManualPay ? MANUALPAY_GATEWAY : undefined,
        discountCodeId,
        notes: data.notes,
        idempotencyKey: data.idempotencyKey,
      },
    });
    // Parent lines first, so their includes can point at them.
    for (const line of lines) {
      const parent = await tx.orderItem.create({
        data: { orderId: order.id, variantId: line.variantId, quantity: line.quantity, unitPrice: line.unitPrice },
      });
      if (line.includes.length > 0) {
        await tx.orderItem.createMany({
          data: line.includes.map((inc) => ({
            orderId: order.id, variantId: inc.variantId, quantity: inc.quantity, unitPrice: inc.unitPrice, parentItemId: parent.id,
          })),
        });
      }
    }
    const created = await tx.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: { orderBy: { createdAt: 'asc' }, include: { variant: { include: { product: true } } } } },
    });

    // Same-transaction outbox insert — the confirmation email exists iff the
    // order does. Actual sending happens in the background email worker.
    await enqueueEmail(tx, created, 'ORDER_CONFIRMATION');

    // Conditional decrement guards against oversell under concurrency: the
    // WHERE clause only matches if enough stock remains, so two simultaneous
    // orders for the last unit can't both succeed. A miss rolls back the tx.
    for (const [variantId, quantity] of stockDemand(lines)) {
      const dec = await tx.productVariant.updateMany({
        where: { id: variantId, stock: { gte: quantity } },
        data: { stock: { decrement: quantity } },
      });
      if (dec.count === 0) {
        const line = lines.find((l) => l.variantId === variantId);
        const inc = lines.flatMap((l) => l.includes).find((i) => i.variantId === variantId);
        throw { statusCode: 400, message: `Insufficient stock for ${line?.name ?? inc?.name ?? 'an item'}` };
      }
    }

      return created;
    }, { timeout: 15000, maxWait: 5000 });

  let order: Awaited<ReturnType<typeof runCreateTransaction>>;
  // Order-number generation is read-max-then-increment with no lock, so two
  // concurrent orders can compute the same number — the loser hits the unique
  // constraint and regenerates on a fresh attempt.
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; ; attempt++) {
    try {
      order = await runCreateTransaction();
      break;
    } catch (err) {
      const code = (err as { code?: string })?.code;
      // Lost the idempotency-key race: a concurrent request with the same key
      // already created the order. Return that one instead of erroring.
      if (data.idempotencyKey && code === 'P2002') {
        const existing = await fastify.prisma.order.findUnique({
          where: { idempotencyKey: data.idempotencyKey },
        });
        if (existing) {
          if (existing.paymentGateway === MANUALPAY_GATEWAY) {
            return { order: existing, paymentUrl: await ensureManualPaySession(fastify, existing, data.discountCode?.toUpperCase()) };
          }
          return { order: existing, paymentUrl: reconstructPaymentUrl(existing) };
        }
      }
      if (code === 'P2002' && attempt < MAX_ATTEMPTS && isOrderNumberConflict(err)) continue;
      throw err;
    }
  }

  // Newsletter opt-in, outside the order transaction on purpose: a failure
  // here must never roll back a real order (and with it the reserved stock and
  // the discount-code usage). Idempotent via the email unique key, and it
  // deliberately does not resurrect someone who has already unsubscribed —
  // ticking a box on a later order is not a fresh opt-in from a person who
  // has explicitly opted out.
  if (data.subscribe && order.email) {
    try {
      await fastify.prisma.subscriber.createMany({
        data: {
          email: order.email.trim().toLowerCase(),
          source: 'CHECKOUT',
          unsubscribeToken: newUnsubscribeToken(),
        },
        skipDuplicates: true,
      });
    } catch (err) {
      fastify.log.warn({ err, orderId: order.id }, 'checkout newsletter opt-in failed');
    }
  }

  // The first entry on the order's payment trail: how it was placed and on
  // what device. Every method, not just online — it is what failures by
  // device are measured against.
  await recordPaymentEvent(fastify, {
    orderId: order.id,
    type: 'ORDER_PLACED',
    gateway: onlineGateway?.name ?? (isManualPay ? MANUALPAY_GATEWAY : null),
    data: {
      method: data.paymentMethod,
      total: order.total,
      source: client ? 'storefront' : 'assistant',
      client: client ?? null,
    },
  });

  let whatsappUrl: string | undefined;
  let paymentUrl: string | undefined;

  if (data.paymentMethod === 'WHATSAPP') {
    whatsappUrl = buildWhatsAppUrl({
      orderNumber: order.orderNumber,
      items: groupOrderItems(order.items).lines.map((line) => ({
        name: itemName(line.item),
        quantity: line.item.quantity,
        unitPrice: line.item.unitPrice,
        includes: line.includes.length ? includesText(line.includes, 'x') : undefined,
      })),
      subtotal: order.subtotal,
      shippingFee: order.shippingFee,
      discountAmount: order.discountAmount,
      total: order.total,
      customerName: order.customerName,
      phone: order.phone,
      address: order.address,
      city: order.city,
      state: order.state,
      postcode: order.postcode,
    });
  } else if (isManualPay) {
    paymentUrl = await ensureManualPaySession(fastify, order, data.discountCode?.toUpperCase());
  } else if (isOnlineMethod(data.paymentMethod)) {
    // Payment gateways enforce a minimum charge (RM1). A total below that
    // (e.g. a near-100% discount) can't be billed online.
    if (order.total < 100) {
      throw { statusCode: 400, message: 'Order total is too low for online payment. Please use WhatsApp checkout.' };
    }
    paymentUrl = await openBill(fastify, order, onlineGateway!);
  }

  // The operators' "new order, awaiting payment" notice (Routines → Order
  // notice). Only a manual-payment order is announced here — it needs a
  // person to confirm the transfer, and is announced again as paid when they
  // mark it; an online one is announced only when paid, from applyPaid. After the payment session so the notice never delays the
  // customer's redirect, and fire-and-forget so it can never fail the order.
  void notifyOrder(fastify, order.id, 'created');

  return { order, whatsappUrl, paymentUrl };
}

/**
 * The gateway that will take this order's online payment, or a 503 when there
 * is none (not configured, or a sandbox gateway on a real domain). Called
 * before the order is written.
 */
async function resolveOnlineGateway(fastify: FastifyInstance, method: string): Promise<PaymentGateway> {
  const setting = await fastify.prisma.setting.findUnique({ where: { key: 'payment_gateway' } });
  // CRYPTO always resolves to btcpay; the `payment_gateway` setting only
  // chooses between the fiat gateways.
  const gatewayName = gatewayNameForMethod(method, setting?.value || 'billplz');
  const gateway = getActiveGateway(gatewayName);
  if (!gateway) {
    fastify.log.error({ gatewayName }, 'No active payment gateway');
    throw {
      statusCode: 503,
      message: 'Online payment is temporarily unavailable. Please use WhatsApp checkout.',
    };
  }
  return gateway;
}

/**
 * Create the gateway bill for an order and record it. A gateway error leaves
 * the order UNPAID with no bill; the checkout keeps its idempotency key, so
 * the customer's retry comes back through createOrder and lands here again.
 */
async function openBill(
  fastify: FastifyInstance,
  order: { id: string; orderNumber: string; customerName: string; email: string | null; phone: string; total: number },
  gateway: PaymentGateway
): Promise<string> {
  let bill;
  try {
    bill = await gateway.createBill({
      name: order.customerName,
      email: order.email || undefined,
      phone: order.phone,
      amount: order.total,
      description: `Ascend MY Order ${order.orderNumber}`,
      orderNumber: order.orderNumber,
      orderId: order.id,
    });
  } catch (err) {
    const response = (err as { response?: { status?: number; data?: unknown } }).response;
    fastify.log.error(
      { gateway: gateway.name, orderNumber: order.orderNumber, status: response?.status, data: response?.data, err: response ? undefined : err },
      'Could not create payment bill'
    );
    // Billplz's whole answer (a 422 names the field it refused) goes on the
    // trail — it is the entire explanation of a NO_BILL order.
    await recordPaymentEvent(fastify, {
      orderId: order.id,
      type: 'BILL_FAILED',
      gateway: gateway.name,
      data: { status: response?.status ?? null, answer: response?.data ?? null, message: (err as Error)?.message ?? String(err) },
    });
    throw { statusCode: 502, message: 'We could not open the payment page. Please try again in a moment.' };
  }

  await fastify.prisma.order.update({
    where: { id: order.id },
    data: { paymentRef: bill.billId, paymentGateway: bill.gateway },
  });
  await recordPaymentEvent(fastify, {
    orderId: order.id,
    type: 'BILL_CREATED',
    gateway: bill.gateway,
    data: { billId: bill.billId, gatewayUrl: bill.paymentUrl, amount: order.total, emailSent: !!order.email },
  });
  // Billplz and ToyyibPay go through the pay link so the visit is recorded;
  // BTCPay's checkout is handed over as it is.
  return bill.gateway === 'billplz' || bill.gateway === 'toyyibpay' ? payLink(bill.billId, 'checkout') : bill.paymentUrl;
}

export async function lookupOrders(fastify: FastifyInstance, phone: string, orderNumber: string) {
  // BOTH identifiers are required: an order number alone is guessable
  // (sequential ASCyymm/NNNN format), and a phone alone would enumerate every
  // order for a guessed number. The phone acts as the shared secret, matched
  // the same way the receipt endpoint does.
  const normalizedPhone = phone ? normalizePhone(phone) : '';
  const hasPhone = normalizedPhone.length >= 10;
  const hasOrderNumber = !!orderNumber && orderNumber.trim().length >= 3;

  if (!hasPhone || !hasOrderNumber) {
    throw { statusCode: 400, message: 'Please enter your order number and phone number' };
  }

  // Return only what the tracking UI needs — never the customer's address,
  // email, name, or notes.
  const orders = await fastify.prisma.order.findMany({
    where: {
      orderNumber: orderNumber.trim().toUpperCase(),
      deletedAt: null,
    },
    select: {
      id: true,
      orderNumber: true,
      // Fetched only for the ownership check below — stripped before returning.
      phone: true,
      status: true,
      paymentStatus: true,
      paymentMethod: true,
      // Only to rebuild the hosted payment page URL below — never returned raw.
      paymentGateway: true,
      paymentRef: true,
      // Only to pick the delivery estimate — the region is returned, the
      // state itself is not.
      state: true,
      subtotal: true,
      shippingFee: true,
      discountAmount: true,
      refundedAmount: true,
      total: true,
      trackingNumber: true,
      createdAt: true,
      // The pipeline on /track: when each step was reached (see schema).
      paidAt: true,
      confirmedAt: true,
      shippedAt: true,
      deliveredAt: true,
      cancelledAt: true,
      // A hand delivery booked in the delivery diary. Driver notes stay out.
      delivery: { select: { scheduledFor: true, durationMinutes: true, status: true, completedAt: true } },
      items: {
        select: {
          id: true,
          quantity: true,
          unitPrice: true,
          parentItemId: true,
          variant: {
            select: { code: true, size: true, imageUrl: true, product: { select: { name: true, addOnOnly: true } } },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  // A wrong phone gets the identical empty result as a nonexistent order —
  // no oracle for probing which order numbers exist.
  const owned = orders.filter((o) => normalizePhone(o.phone) === normalizedPhone);

  // A hosted bank-transfer order whose screenshot is already in is not
  // "waiting for payment" from the customer's side — it is waiting on us.
  const sessionIds = owned
    .filter((o) => o.paymentGateway === MANUALPAY_GATEWAY && o.paymentStatus === 'UNPAID' && o.paymentRef)
    .map((o) => o.paymentRef as string);
  const verifying = new Set(
    sessionIds.length
      ? (
          await fastify.prisma.checkoutSession.findMany({
            where: { id: { in: sessionIds }, status: 'PROOF_SUBMITTED' },
            select: { id: true },
          })
        ).map((s) => s.id)
      : [],
  );

  return owned
    .map(({ phone: _phone, paymentGateway, paymentRef, state, trackingNumber, ...rest }) => ({
      ...rest,
      region: deliveryRegion(state),
      tracking: parseTracking(trackingNumber),
      proofSubmitted: !!paymentRef && verifying.has(paymentRef),
      // The hosted bank-transfer page is the only place an unpaid order can
      // be paid, and its URL is easy to lose. Order number + phone is the
      // same proof of ownership the receipt page accepts, so hand it back.
      paymentUrl:
        paymentGateway === MANUALPAY_GATEWAY && rest.paymentStatus === 'UNPAID' && rest.status !== 'CANCELLED'
          ? reconstructPaymentUrl({ paymentGateway, paymentRef })
          : undefined,
    }));
}
