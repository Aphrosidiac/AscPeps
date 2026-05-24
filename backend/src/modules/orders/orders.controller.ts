import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { generateOrderNumber } from '../../utils/order-number.js';
import { buildWhatsAppUrl } from '../../utils/whatsapp.js';

const createOrderSchema = z.object({
  customerName: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email().optional(),
  address: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  postcode: z.string().min(1),
  paymentMethod: z.enum(['WHATSAPP', 'BILLPLZ']),
  notes: z.string().optional(),
  items: z.array(
    z.object({
      productId: z.string(),
      quantity: z.number().int().min(1),
    })
  ).min(1),
});

export async function createOrder(fastify: FastifyInstance, body: unknown) {
  const data = createOrderSchema.parse(body);

  const products = await fastify.prisma.product.findMany({
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

  const total = data.items.reduce((sum, item) => {
    const product = productMap.get(item.productId)!;
    return sum + product.price * item.quantity;
  }, 0);

  const orderNumber = await generateOrderNumber(fastify.prisma);

  const order = await fastify.prisma.$transaction(async (tx) => {
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
        total,
        paymentMethod: data.paymentMethod,
        notes: data.notes,
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

    for (const item of data.items) {
      await tx.product.update({
        where: { id: item.productId },
        data: { stock: { decrement: item.quantity } },
      });
    }

    return created;
  });

  let whatsappUrl: string | undefined;
  if (data.paymentMethod === 'WHATSAPP') {
    whatsappUrl = buildWhatsAppUrl({
      orderNumber: order.orderNumber,
      items: order.items.map((item) => ({
        name: item.product.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
      total: order.total,
      customerName: order.customerName,
      phone: order.phone,
      address: order.address,
      city: order.city,
      state: order.state,
      postcode: order.postcode,
    });
  }

  return { order, whatsappUrl };
}

export async function lookupOrders(fastify: FastifyInstance, phone: string) {
  if (!phone) {
    throw { statusCode: 400, message: 'Phone number is required' };
  }

  const orders = await fastify.prisma.order.findMany({
    where: { phone },
    include: { items: { include: { product: { select: { name: true, code: true, imageUrl: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  return orders;
}
