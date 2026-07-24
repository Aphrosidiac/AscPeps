import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { generateOrderNumber } from '../../utils/order-number.js';
import { buildWhatsAppUrl } from '../../utils/whatsapp.js';
import { getActiveGateway } from '../../utils/payment-gateway.js';
import { validateDiscountCode } from '../admin/admin-discounts.controller.js';
import { normalizePhone } from '../../utils/phone.js';
import { env } from '../../config/env.js';
import { getEffectivePrice } from '../../utils/product-pricing.js';
import { getVariantDisplayName } from '../../utils/product-addons.js';

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
  paymentMethod: z.enum(['WHATSAPP', 'BILLPLZ']),
  discountCode: z.string().optional(),
  notes: z.string().optional(),
  idempotencyKey: z.string().min(8).max(100).optional(),
  items: z.array(
    z.object({
      variantId: z.string(),
      quantity: z.number().int().min(1).max(100),
    })
  ).min(1).max(50),
}).superRefine((data, ctx) => {
  // ToyyibPay rejects createBill outright with an empty billEmail — catch this
  // before the order transaction runs, not after stock is already reserved.
  if (data.paymentMethod === 'BILLPLZ' && !data.email) {
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

// Rebuild the online-payment URL for an already-created order (used on the
// idempotent-retry path, where the original bill should be reused).
function reconstructPaymentUrl(order: { paymentGateway: string | null; paymentRef: string | null }): string | undefined {
  if (order.paymentGateway === 'toyyibpay' && order.paymentRef) {
    const host = env.TOYYIBPAY_SANDBOX ? 'https://dev.toyyibpay.com' : 'https://toyyibpay.com';
    return `${host}/${order.paymentRef}`;
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

export async function createOrder(fastify: FastifyInstance, body: unknown) {
  const data = createOrderSchema.parse(body);

  // Idempotency: a network retry of a request the server already committed must
  // NOT create a second order (double stock decrement + double bill = double
  // charge). Return the original order instead.
  if (data.idempotencyKey) {
    const existing = await fastify.prisma.order.findUnique({
      where: { idempotencyKey: data.idempotencyKey },
    });
    if (existing) {
      return { order: existing, paymentUrl: reconstructPaymentUrl(existing) };
    }
  }

  const runCreateTransaction = () =>
    fastify.prisma.$transaction(async (tx) => {
    // Server-side enforcement of "required" add-ons (e.g. Bac Water + syringes
    // for a reconstitution-needing peptide): the storefront pre-checks and
    // locks these, but a bypassed/buggy client must still not be able to ship
    // a peptide without its required supplies. Required add-ons are
    // configured on the parent Product (apply regardless of which of its own
    // variants is purchased), so first resolve which parents were bought.
    const purchasedVariants = await tx.productVariant.findMany({
      where: { id: { in: data.items.map((i) => i.variantId) } },
      select: { id: true, productId: true },
    });
    const parentIds = [...new Set(purchasedVariants.map((v) => v.productId))];
    // Only add-ons that are themselves still purchasable (variant active AND
    // its own parent active) get force-injected — otherwise a supply that
    // gets discontinued/deactivated would permanently block checkout of
    // every product that requires it, instead of just dropping out quietly.
    const requiredRelations = await tx.productAddOn.findMany({
      where: { productId: { in: parentIds }, required: true, addOn: { active: true, product: { active: true } } },
    });
    // For each required add-on, make sure the order includes at least the
    // configured fixed quantity — this does NOT scale with how many units of
    // the parent product were ordered, and if two purchased products both
    // require the same add-on at different quantities, the larger of the
    // two wins rather than summing.
    const requiredMinByAddOnId = new Map<string, number>();
    for (const rel of requiredRelations) {
      requiredMinByAddOnId.set(rel.addOnId, Math.max(requiredMinByAddOnId.get(rel.addOnId) ?? 0, rel.quantity));
    }
    const items = data.items.map((i) => ({ ...i }));
    for (const [addOnId, minQuantity] of requiredMinByAddOnId) {
      const existing = items.find((i) => i.variantId === addOnId);
      if (existing) {
        existing.quantity = Math.max(existing.quantity, minQuantity);
      } else {
        items.push({ variantId: addOnId, quantity: minQuantity });
      }
    }

    const variants = await tx.productVariant.findMany({
      where: { id: { in: items.map((i) => i.variantId) }, active: true, product: { active: true } },
      include: { product: { select: { name: true } } },
    });

    if (variants.length !== items.length) {
      throw { statusCode: 400, message: 'One or more products not found or inactive' };
    }

    const variantMap = new Map(variants.map((v) => [v.id, v]));
    // Captured once so subtotal and each stored unitPrice agree on whether a
    // sale is active, even in the unlikely event a sale boundary is crossed
    // mid-transaction.
    const now = new Date();

    for (const item of items) {
      const variant = variantMap.get(item.variantId)!;
      if (variant.stock < item.quantity) {
        throw { statusCode: 400, message: `Insufficient stock for ${getVariantDisplayName(variant.product, variant)}` };
      }
    }

    const subtotal = items.reduce((sum, item) => {
      const variant = variantMap.get(item.variantId)!;
      return sum + getEffectivePrice(variant, now) * item.quantity;
    }, 0);

    const shippingSetting = await tx.setting.findUnique({ where: { key: 'shipping_fee' } });
    // Guard against a non-numeric/empty setting value: parseFloat("") is NaN,
    // and NaN would propagate into total and the gateway amount.
    const shippingParsed = shippingSetting ? parseFloat(shippingSetting.value) : 0;
    const shippingFee = Number.isFinite(shippingParsed) && shippingParsed > 0 ? Math.round(shippingParsed * 100) : 0;

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

    const total = Math.max(subtotal + shippingFee - discountAmount, 0);
    const orderNumber = await generateOrderNumber(tx);

    const created = await tx.order.create({
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
        total,
        paymentMethod: data.paymentMethod,
        discountCodeId,
        notes: data.notes,
        idempotencyKey: data.idempotencyKey,
        items: {
          create: items.map((item) => ({
            variantId: item.variantId,
            quantity: item.quantity,
            unitPrice: getEffectivePrice(variantMap.get(item.variantId)!, now),
          })),
        },
      },
      include: { items: { include: { variant: { include: { product: true } } } } },
    });

    // Conditional decrement guards against oversell under concurrency: the
    // WHERE clause only matches if enough stock remains, so two simultaneous
    // orders for the last unit can't both succeed. A miss rolls back the tx.
    for (const item of items) {
      const dec = await tx.productVariant.updateMany({
        where: { id: item.variantId, stock: { gte: item.quantity } },
        data: { stock: { decrement: item.quantity } },
      });
      if (dec.count === 0) {
        const variant = variantMap.get(item.variantId)!;
        throw { statusCode: 400, message: `Insufficient stock for ${getVariantDisplayName(variant.product, variant)}` };
      }
    }

      return created;
    }, { timeout: 15000, maxWait: 5000 });

  let order;
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
        if (existing) return { order: existing, paymentUrl: reconstructPaymentUrl(existing) };
      }
      if (code === 'P2002' && attempt < MAX_ATTEMPTS && isOrderNumberConflict(err)) continue;
      throw err;
    }
  }

  let whatsappUrl: string | undefined;
  let paymentUrl: string | undefined;

  if (data.paymentMethod === 'WHATSAPP') {
    whatsappUrl = buildWhatsAppUrl({
      orderNumber: order.orderNumber,
      items: order.items.map((item) => ({
        name: getVariantDisplayName(item.variant.product, item.variant),
        quantity: item.quantity,
        unitPrice: item.unitPrice,
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
  } else if (data.paymentMethod === 'BILLPLZ') {
    // Payment gateways enforce a minimum charge (RM1). A total below that
    // (e.g. a near-100% discount) can't be billed online.
    if (order.total < 100) {
      throw { statusCode: 400, message: 'Order total is too low for online payment. Please use WhatsApp checkout.' };
    }
    const settings = await fastify.prisma.setting.findMany({
      where: { key: { in: ['payment_gateway'] } },
    });
    const gatewayName = settings.find(s => s.key === 'payment_gateway')?.value || 'billplz';
    const gateway = getActiveGateway(gatewayName);

    if (gateway) {
      const bill = await gateway.createBill({
        name: order.customerName,
        email: order.email || undefined,
        phone: order.phone,
        amount: order.total,
        description: `ASCEND Order ${order.orderNumber}`,
        orderNumber: order.orderNumber,
        orderId: order.id,
      });

      await fastify.prisma.order.update({
        where: { id: order.id },
        data: { paymentRef: bill.billId, paymentGateway: bill.gateway },
      });

      paymentUrl = bill.paymentUrl;
    }
  }

  return { order, whatsappUrl, paymentUrl };
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
      total: true,
      trackingNumber: true,
      createdAt: true,
      items: {
        select: {
          id: true,
          quantity: true,
          unitPrice: true,
          variant: {
            select: { code: true, size: true, imageUrl: true, product: { select: { name: true } } },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  // A wrong phone gets the identical empty result as a nonexistent order —
  // no oracle for probing which order numbers exist.
  return orders
    .filter((o) => normalizePhone(o.phone) === normalizedPhone)
    .map(({ phone: _phone, ...rest }) => rest);
}
