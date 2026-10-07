import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { sendWhatsAppMessage } from './whatsapp-send.js';
import { getVariantDisplayName } from './product-addons.js';
import { rm } from '../modules/ai-agent/tool-kit.js';
import { readSetting, SETTING_KEYS } from '../modules/ai-agent/schedule.js';

/**
 * The order notices: WhatsApp messages to the operators and groups that
 * switched them on (Routines panel), at the moments an order needs someone.
 *
 *   - Placed: a manual-payment order (WHATSAPP, incl. the hosted proof-upload
 *     flow) as soon as it is created. It is NOT a sale yet — the customer is
 *     about to message us and a person has to confirm the transfer — so it
 *     reads as a heads-up, "awaiting payment", never as the real thing.
 *   - Paid: every order, whatever the method, on its UNPAID → PAID
 *     transition. For online and crypto that is `applyPaid` (callback,
 *     redirect verify or reconcile sweep); for a manual order it is someone
 *     marking it paid (order page, or Abby's `update_order`). Both
 *     transitions are guarded, so an order is announced paid once.
 *
 * Online and crypto orders get nothing at creation: a reservation the
 * customer may walk away from on the gateway is not news.
 *
 * Written by code, not by the model. A notification has to be immediate,
 * identical every time, and never wrong about the number — none of which is
 * what a model call buys, and the assistant is one message away for anything
 * a person wants to know about the order. Fire-and-forget from every hook: a
 * failed send is logged and never fails the order or the payment.
 */

const KEY = SETTING_KEYS.orderNotify;

export type OrderMoment = 'created' | 'paid';

export async function orderNotifyEnabled(fastify: FastifyInstance): Promise<boolean> {
  return (await readSetting(fastify, KEY)) === 'true';
}

/** Whether an order is announced when it is placed — only manual payment is; everything is announced when paid. */
export function announcedOnCreation(paymentMethod: string): boolean {
  return paymentMethod === 'WHATSAPP';
}

const GATEWAY_NAMES: Record<string, string> = { toyyibpay: 'ToyyibPay', billplz: 'Billplz', btcpay: 'BTCPay' };

function paymentLabel(o: { paymentMethod: string; paymentGateway: string | null }): string {
  if (o.paymentMethod === 'WHATSAPP') return o.paymentGateway ? 'Bank transfer (proof uploaded online)' : 'Bank transfer via WhatsApp';
  if (o.paymentMethod === 'CRYPTO') return 'Crypto';
  const gw = o.paymentGateway && (GATEWAY_NAMES[o.paymentGateway] ?? o.paymentGateway);
  return gw ? `Online · ${gw}` : 'Online';
}

/**
 * The message for one order at one moment. The two share a body — customer,
 * items, money, link — so the team reads them the same way; the header and
 * the closing line are what tell them apart at a glance in the chat list.
 */
export async function orderNoticeText(fastify: FastifyInstance, orderId: string, moment: OrderMoment): Promise<string | null> {
  const o = await fastify.prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { orderBy: { createdAt: 'asc' }, include: { variant: { include: { product: { select: { name: true } } } } } } },
  });
  if (!o) return null;

  const paid = moment === 'paid';
  const head = paid ? '✅ *ORDER PAID*' : '🕓 *NEW ORDER · AWAITING PAYMENT*';
  const where = [o.city, o.state].filter(Boolean).join(', ');
  const items = o.items.map((i) => `• ${i.quantity}× ${getVariantDisplayName(i.variant.product, i.variant)} — ${rm(i.unitPrice * i.quantity)}`);
  const money = [`Subtotal ${rm(o.subtotal)}`, `Shipping ${o.shippingFee ? rm(o.shippingFee) : 'free'}`];
  if (o.discountAmount > 0) money.push(`Discount −${rm(o.discountAmount)}`);

  return [
    head,
    `*${o.orderNumber}* · *${rm(o.total)}*`,
    '',
    `👤 ${o.customerName}`,
    `📞 ${o.phone}`,
    ...(where ? [`📍 ${where}`] : []),
    '',
    '*Items*',
    ...items,
    '',
    money.join(' · '),
    `*Total ${rm(o.total)}*`,
    '',
    `💳 ${paymentLabel(o)}`,
    ...(o.notes ? [`📝 ${o.notes.slice(0, 160)}`] : []),
    paid ? '_Payment confirmed — ready to pack._' : '_Not paid yet. Mark it paid once the transfer is confirmed._',
    '',
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
 * Sends the notice for one order at `moment`, if that order is announced at
 * it (`force` skips the master switch, not the moment check — a test still
 * has to be a notice the order would really produce). Resolves with how many
 * went out; never throws.
 */
export async function notifyOrder(fastify: FastifyInstance, orderId: string, moment: OrderMoment, opts: { force?: boolean } = {}): Promise<OrderNoticeResult> {
  try {
    if (!opts.force && !(await orderNotifyEnabled(fastify))) return { sent: 0, recipients: 0, text: null, skipped: 'off' };
    const order = await fastify.prisma.order.findUnique({ where: { id: orderId }, select: { paymentMethod: true } });
    if (!order) return { sent: 0, recipients: 0, text: null, skipped: 'no-order' };
    if (moment === 'created' && !announcedOnCreation(order.paymentMethod)) return { sent: 0, recipients: 0, text: null, skipped: 'not-this-moment' };
    const [text, targets] = await Promise.all([orderNoticeText(fastify, orderId, moment), orderNotifyRecipients(fastify)]);
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

/** The moment an order's notice is shown at today: paid once it is paid, placed while a manual order waits, none for an unpaid online order. */
export function currentMoment(o: { paymentMethod: string; paymentStatus: string }): OrderMoment | null {
  if (o.paymentStatus === 'PAID') return 'paid';
  return announcedOnCreation(o.paymentMethod) ? 'created' : null;
}

/** The latest order that has a notice to show at `moment` — for the panel's preview. */
export async function latestOrderFor(fastify: FastifyInstance, moment: OrderMoment) {
  return fastify.prisma.order.findFirst({
    where: moment === 'paid' ? { deletedAt: null, paymentStatus: 'PAID' } : { deletedAt: null, paymentMethod: 'WHATSAPP' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, paymentMethod: true, paymentStatus: true },
  });
}

/** Test send from the panel: the latest order's notice as it stands, master switch ignored. */
export async function testOrderNotice(fastify: FastifyInstance): Promise<OrderNoticeResult> {
  const latest = await fastify.prisma.order.findFirst({
    where: { deletedAt: null, OR: [{ paymentStatus: 'PAID' }, { paymentMethod: 'WHATSAPP' }] },
    orderBy: { createdAt: 'desc' },
    select: { id: true, paymentMethod: true, paymentStatus: true },
  });
  const moment = latest && currentMoment(latest);
  if (!latest || !moment) return { sent: 0, recipients: 0, text: null, skipped: 'no-order' };
  return notifyOrder(fastify, latest.id, moment, { force: true });
}
