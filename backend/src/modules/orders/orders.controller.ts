import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { generateOrderNumber } from '../../utils/order-number.js';
import { buildWhatsAppUrl } from '../../utils/whatsapp.js';
import { getActiveGateway } from '../../utils/payment-gateway.js';
import { validateDiscountCode } from '../admin/admin-discounts.controller.js';
import { env } from '../../config/env.js';

const createOrderSchema = z.object({
  customerName: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email().optional(),
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
      productId: z.string(),
      quantity: z.number().int().min(1).max(100),
    })
  ).min(1).max(50),
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

  let order;
  try {
    order = await fastify.prisma.$transaction(async (tx) => {
    const products = await tx.product.findMany({
      where: { id: { in: data.items.map((i) => i.productId) }, active: true },
    });

    if (products.length !== data.items.length) {
      throw { statusCode: 400, message: 'One or more products not found or inactive' };
    }

    const productMap = new Map(products.map((p) => [p.id, p]));

    for (const item of data.items) {
      const product = productMap.get(item.productId)!;
      if (product.stock < item.quantity) {
        throw { statusCode: 400, message: `Insufficient stock for ${product.name}` };
      }
    }

    const subtotal = data.items.reduce((sum, item) => {
      const product = productMap.get(item.productId)!;
      return sum + product.price * item.quantity;
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
          create: data.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: productMap.get(item.productId)!.price,
          })),
        },
      },
      include: { items: { include: { product: true } } },
    });

    // Conditional decrement guards against oversell under concurrency: the
    // WHERE clause only matches if enough stock remains, so two simultaneous
    // orders for the last unit can't both succeed. A miss rolls back the tx.
    for (const item of data.items) {
      const dec = await tx.product.updateMany({
        where: { id: item.productId, stock: { gte: item.quantity } },
        data: { stock: { decrement: item.quantity } },
      });
      if (dec.count === 0) {
        const product = productMap.get(item.productId)!;
        throw { statusCode: 400, message: `Insufficient stock for ${product.name}` };
      }
    }

      return created;
    }, { timeout: 15000, maxWait: 5000 });
  } catch (err) {
    // Lost the idempotency-key race: a concurrent request with the same key
    // already created the order. Return that one instead of erroring.
    if (data.idempotencyKey && (err as { code?: string })?.code === 'P2002') {
      const existing = await fastify.prisma.order.findUnique({
        where: { idempotencyKey: data.idempotencyKey },
      });
      if (existing) return { order: existing, paymentUrl: reconstructPaymentUrl(existing) };
    }
    throw err;
  }

  let whatsappUrl: string | undefined;
  let paymentUrl: string | undefined;

  if (data.paymentMethod === 'WHATSAPP') {
    whatsappUrl = buildWhatsAppUrl({
      orderNumber: order.orderNumber,
      items: order.items.map((item) => ({
        name: item.product.name,
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
  const hasPhone = phone && phone.trim().length >= 3;
  const hasOrderNumber = orderNumber && orderNumber.trim().length >= 3;

  // Require at least one identifier
  if (!hasPhone && !hasOrderNumber) {
    throw { statusCode: 400, message: 'Please enter your order number or phone number' };
  }

  // Build where clause based on what was provided
  const where: Record<string, string> = {};
  if (hasPhone) where.phone = phone.trim();
  if (hasOrderNumber) where.orderNumber = orderNumber.trim().toUpperCase();

  // Return only what the tracking UI needs — never the customer's address,
  // email, name, or notes.
  const orders = await fastify.prisma.order.findMany({
    where,
    select: {
      id: true,
      orderNumber: true,
      status: true,
      total: true,
      createdAt: true,
      items: {
        select: {
          id: true,
          quantity: true,
          unitPrice: true,
          product: { select: { name: true, code: true, imageUrl: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  return orders;
}
