import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { sendWhatsAppMessage } from './whatsapp-send.js';
import { rm } from '../modules/ai-agent/tool-kit.js';
import { readSetting, SETTING_KEYS } from '../modules/ai-agent/schedule.js';

/**
 * The new-order notice: one WhatsApp line to the operators and groups that
 * switched it on (Routines panel), the moment an order is created.
 *
 * Written by code, not by the model. A notification has to be immediate,
 * identical every time, and never wrong about the number — none of which is
 * what a model call buys, and the assistant is one message away for anything
 * a person wants to know about the order. Fire-and-forget from the checkout
 * path: a failed send is logged and never fails the order.
 */

const KEY = SETTING_KEYS.orderNotify;

export async function orderNotifyEnabled(fastify: FastifyInstance): Promise<boolean> {
  return (await readSetting(fastify, KEY)) === 'true';
}

export async function orderNoticeText(fastify: FastifyInstance, orderId: string): Promise<string | null> {
  const o = await fastify.prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { variant: { include: { product: { select: { name: true } } } } } } },
  });
  if (!o) return null;
  const lines = o.items.map((i) => `${i.quantity}× ${i.variant.product.name}${i.variant.size ? ` ${i.variant.size}` : ''}`);
  const method = o.paymentMethod === 'WHATSAPP' ? 'bank transfer via WhatsApp' : o.paymentMethod === 'CRYPTO' ? 'crypto' : `online (${o.paymentGateway ?? 'gateway'})`;
  const paid = o.paymentStatus === 'PAID' ? 'paid' : 'unpaid';
  return [
    `🛒 New order *${o.orderNumber}* — *${rm(o.total)}*`,
    `${o.customerName} · ${o.phone} · ${o.city ? `${o.city}, ` : ''}${o.state}`,
    lines.join(', '),
    `${method}, ${paid}${o.notes ? ` · note: ${o.notes.slice(0, 120)}` : ''}`,
    `${env.FRONTEND_URL.replace(/\/$/, '')}/admin/orders/${o.id}`,
  ].join('\n');
}

export async function orderNotifyRecipients(fastify: FastifyInstance) {
  const [operators, groups] = await Promise.all([
    fastify.prisma.whatsAppOperator.findMany({ where: { active: true, orderNotify: true }, select: { phone: true, name: true } }),
    fastify.prisma.whatsAppGroup.findMany({ where: { active: true, orderNotify: true }, select: { groupJid: true, subject: true } }),
  ]);
  return [...operators.map((o) => ({ to: { phone: o.phone }, name: o.name })), ...groups.map((g) => ({ to: { jid: g.groupJid }, name: `group ${g.subject}` }))];
}

/** Sends the notice for one order. Resolves with how many went out; never throws. */
export async function notifyNewOrder(fastify: FastifyInstance, orderId: string, opts: { force?: boolean } = {}): Promise<{ sent: number; recipients: number; text: string | null }> {
  try {
    if (!opts.force && !(await orderNotifyEnabled(fastify))) return { sent: 0, recipients: 0, text: null };
    const [text, targets] = await Promise.all([orderNoticeText(fastify, orderId), orderNotifyRecipients(fastify)]);
    if (!text || !targets.length) return { sent: 0, recipients: targets.length, text };
    let sent = 0;
    for (const t of targets) {
      try {
        await sendWhatsAppMessage(t.to, text);
        sent++;
      } catch (err) {
        fastify.log.error({ err, orderId, to: t.name }, 'new-order notice could not be sent');
      }
    }
    fastify.log.info({ orderId, sent, recipients: targets.length }, 'new-order notice');
    return { sent, recipients: targets.length, text };
  } catch (err) {
    fastify.log.error({ err, orderId }, 'new-order notice failed');
    return { sent: 0, recipients: 0, text: null };
  }
}
