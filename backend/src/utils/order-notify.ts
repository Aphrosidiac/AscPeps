import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { sendWhatsAppMessage } from './whatsapp-send.js';
import { rm } from '../modules/ai-agent/tool-kit.js';
import { readSetting, SETTING_KEYS } from '../modules/ai-agent/schedule.js';

/**
 * The order notice: one WhatsApp line to the operators and groups that
 * switched it on (Routines panel), at the moment the order needs someone.
 *
 * That moment differs by payment method, and getting it wrong is what the
 * first version did — it fired on creation for everything, so an online
 * order announced itself "unpaid" while the customer was still on the
 * gateway, and an abandoned checkout pinged the team for nothing.
 *
 *   - Manual (WHATSAPP, incl. the hosted proof-upload flow): fires on
 *     creation. The customer is about to message us and a person has to
 *     confirm the transfer; marking it paid is that person's own action, so
 *     there is no second notice.
 *   - Online gateway and crypto: fires on the UNPAID → PAID transition
 *     (`applyPaid`), which is idempotent, so a callback plus a reconcile
 *     sweep can never send it twice. Nothing on creation: a reservation the
 *     customer may walk away from is not news.
 *
 * Written by code, not by the model. A notification has to be immediate,
 * identical every time, and never wrong about the number — none of which is
 * what a model call buys, and the assistant is one message away for anything
 * a person wants to know about the order. Fire-and-forget from both hooks: a
 * failed send is logged and never fails the order or the payment.
 */

const KEY = SETTING_KEYS.orderNotify;

export type OrderMoment = 'created' | 'paid';

export async function orderNotifyEnabled(fastify: FastifyInstance): Promise<boolean> {
  return (await readSetting(fastify, KEY)) === 'true';
}

/** Which moment an order is announced at. Manual payment on creation, everything else when paid. */
export function orderNoticeMoment(paymentMethod: string): OrderMoment {
  return paymentMethod === 'WHATSAPP' ? 'created' : 'paid';
}

export async function orderNoticeText(fastify: FastifyInstance, orderId: string): Promise<string | null> {
  const o = await fastify.prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { variant: { include: { product: { select: { name: true } } } } } } },
  });
  if (!o) return null;
  const lines = o.items.map((i) => `${i.quantity}× ${i.variant.product.name}${i.variant.size ? ` ${i.variant.size}` : ''}`);
  const manual = o.paymentMethod === 'WHATSAPP';
  const method = manual ? (o.paymentGateway ? 'bank transfer, proof uploaded online' : 'bank transfer via WhatsApp') : o.paymentMethod === 'CRYPTO' ? 'crypto' : `online (${o.paymentGateway ?? 'gateway'})`;
  const paid = o.paymentStatus === 'PAID';
  // The header says what just happened: a manual order is announced while it
  // still wants confirming, an online one only once the money is in.
  const head = paid ? `✅ Order *${o.orderNumber}* paid — *${rm(o.total)}*` : `🛒 New order *${o.orderNumber}* — *${rm(o.total)}*`;
  const state = paid ? 'paid' : manual ? 'awaiting your confirmation' : 'unpaid';
  return [
    head,
    `${o.customerName} · ${o.phone} · ${o.city ? `${o.city}, ` : ''}${o.state}`,
    lines.join(', '),
    `${method}, ${state}${o.notes ? ` · note: ${o.notes.slice(0, 120)}` : ''}`,
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

export interface OrderNoticeResult {
  sent: number;
  recipients: number;
  text: string | null;
  // Why nothing went out, when nothing did.
  skipped?: 'off' | 'not-this-moment' | 'no-order' | 'no-recipients';
}

/**
 * Sends the notice for one order if `moment` is the one its payment method
 * is announced at (`force` skips the master switch, not the moment check —
 * a test still has to be the right kind of notice). Resolves with how many
 * went out; never throws.
 */
export async function notifyOrder(fastify: FastifyInstance, orderId: string, moment: OrderMoment, opts: { force?: boolean } = {}): Promise<OrderNoticeResult> {
  try {
    if (!opts.force && !(await orderNotifyEnabled(fastify))) return { sent: 0, recipients: 0, text: null, skipped: 'off' };
    const order = await fastify.prisma.order.findUnique({ where: { id: orderId }, select: { paymentMethod: true } });
    if (!order) return { sent: 0, recipients: 0, text: null, skipped: 'no-order' };
    if (orderNoticeMoment(order.paymentMethod) !== moment) return { sent: 0, recipients: 0, text: null, skipped: 'not-this-moment' };
    const [text, targets] = await Promise.all([orderNoticeText(fastify, orderId), orderNotifyRecipients(fastify)]);
    if (!text) return { sent: 0, recipients: targets.length, text, skipped: 'no-order' };
    if (!targets.length) return { sent: 0, recipients: 0, text, skipped: 'no-recipients' };
    let sent = 0;
    for (const t of targets) {
      try {
        await sendWhatsAppMessage(t.to, text);
        sent++;
      } catch (err) {
        fastify.log.error({ err, orderId, moment, to: t.name }, 'order notice could not be sent');
      }
    }
    fastify.log.info({ orderId, moment, sent, recipients: targets.length }, 'order notice');
    return { sent, recipients: targets.length, text };
  } catch (err) {
    fastify.log.error({ err, orderId, moment }, 'order notice failed');
    return { sent: 0, recipients: 0, text: null };
  }
}

/** Test send from the panel: the notice for this order as it would go out at its own moment, master switch ignored. */
export async function testOrderNotice(fastify: FastifyInstance, orderId: string): Promise<OrderNoticeResult> {
  const order = await fastify.prisma.order.findUnique({ where: { id: orderId }, select: { paymentMethod: true } });
  if (!order) return { sent: 0, recipients: 0, text: null, skipped: 'no-order' };
  return notifyOrder(fastify, orderId, orderNoticeMoment(order.paymentMethod), { force: true });
}
