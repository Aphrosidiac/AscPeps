import type { FastifyInstance } from 'fastify';
import { normalizePhone } from '../../utils/phone.js';
import { generateReceiptPdf } from '../../utils/receipt-pdf.js';

export async function getReceiptData(fastify: FastifyInstance, orderNumber: string, phone: string) {
  const normalized = normalizePhone(phone);
  if (normalized.length < 10) {
    throw { statusCode: 400, message: 'Invalid phone number' };
  }

  const order = await fastify.prisma.order.findUnique({
    where: { orderNumber },
    include: {
      items: { include: { product: { select: { name: true, code: true, imageUrl: true } } } },
      discountCode: { select: { code: true, discountType: true, discountValue: true } },
    },
  });

  if (!order) throw { statusCode: 404, message: 'Order not found' };

  if (normalizePhone(order.phone) !== normalized) {
    throw { statusCode: 403, message: 'Phone number does not match this order' };
  }

  return order;
}

export async function getReceiptPdf(fastify: FastifyInstance, orderNumber: string, phone: string) {
  const order = await getReceiptData(fastify, orderNumber, phone);
  const settingsRows = await fastify.prisma.setting.findMany();
  const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));
  return generateReceiptPdf(order, settings);
}

export async function adminGetReceiptPdf(fastify: FastifyInstance, id: string) {
  const order = await fastify.prisma.order.findUnique({
    where: { id },
    include: {
      items: { include: { product: { select: { name: true, code: true, imageUrl: true } } } },
      discountCode: { select: { code: true, discountType: true, discountValue: true } },
    },
  });

  if (!order) throw { statusCode: 404, message: 'Order not found' };

  const settingsRows = await fastify.prisma.setting.findMany();
  const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));
  return generateReceiptPdf(order, settings);
}
