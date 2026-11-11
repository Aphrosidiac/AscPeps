import { groupOrderItems } from '../utils/order-lines.js';
import {
  renderLayout,
  renderOrderSummary,
  renderSubject,
  orderMeta,
  firstName,
  paragraph,
  heading,
  button,
  spacer,
  linkList,
  whatsappUrl,
  escapeHtml,
  formatRM,
  SITE_URL,
  type EmailOrder,
} from './layout.js';

const DEFAULT_SUBJECT = 'Order {orderNumber} received — Ascend MY';
const DEFAULT_BUTTON_LABEL = 'Complete payment';
const DEFAULT_WHATSAPP_INSTRUCTIONS =
  "Payment is completed through our WhatsApp chat. We'll confirm your order once it's received.";

// Reference material rather than product cross-sell: recommending compounds to
// someone who just bought one is the framing the catalogue avoids.
const WHILE_YOU_WAIT = [
  {
    label: 'Reconstitution calculator',
    blurb: 'Work out BAC water volume and units per dose before your vial arrives.',
    href: `${SITE_URL}/calculator`,
  },
  {
    label: 'Handling and storage guide',
    blurb: 'How to store, reconstitute and handle lyophilised material.',
    href: `${SITE_URL}/guide`,
  },
];

export function renderOrderConfirmation(
  order: EmailOrder,
  /** Rebuilt by the worker from the payment ref; the bill URL is never stored. */
  paymentUrl: string | undefined,
  /** Admin-editable copy; free text, so escape it. */
  settings: Record<string, string>
): { subject: string; html: string } {
  const name = firstName(order.customerName);
  const chat = whatsappUrl(`Hi, about order #${order.orderNumber}`);
  const paid = order.paymentStatus === 'PAID';

  let intro: string;
  let action = '';
  if (paid) {
    intro = `Hi ${name}, thanks for your order. Your payment is in, so we&#39;re getting it ready to ship. We&#39;ll email you again when it&#39;s on its way.`;
  } else if (order.paymentGateway === 'manualpaygate' && paymentUrl) {
    intro = `Hi ${name}, thanks for your order. If you haven&#39;t sent the bank transfer or DuitNow payment yet, the payment page has the account details and the exact amount. Upload your transfer screenshot there and we&#39;ll confirm your order.`;
    action = button('Open payment page', paymentUrl);
  } else if (order.paymentMethod === 'WHATSAPP') {
    intro = `Hi ${name}, thanks for your order. ${escapeHtml(settings.email_whatsapp_instructions || DEFAULT_WHATSAPP_INSTRUCTIONS)}`;
    action = button('Open WhatsApp', chat);
  } else if (paymentUrl) {
    intro = `Hi ${name}, thanks for your order. If you haven&#39;t finished paying yet, you can pick up where you left off below. We start packing as soon as payment comes through.`;
    action = button(escapeHtml(settings.email_button_label || DEFAULT_BUTTON_LABEL), paymentUrl);
  } else {
    intro = `Hi ${name}, thanks for your order. If you haven&#39;t finished paying yet, message us on WhatsApp and we&#39;ll send you a fresh payment link.`;
    action = button('Message us on WhatsApp', chat);
  }

  const count = groupOrderItems(order.items).lines.length;
  const next = paid
    ? "paid, we'll let you know when it ships."
    : order.paymentMethod === 'WHATSAPP'
      ? "we'll confirm as soon as your transfer lands."
      : paymentUrl
        ? 'finish payment and we start packing.'
        : "we'll let you know when it ships.";

  const html = renderLayout({
    headline: paid ? 'Thanks, your order is confirmed' : 'Thanks for your order',
    meta: orderMeta(order),
    body: `${paragraph(intro, { mb: action ? 12 : 0 })}${action}${spacer(32)}${renderOrderSummary(order)}
${heading('While you wait')}${linkList(WHILE_YOU_WAIT)}`,
    preheader: `${formatRM(order.total)} · ${count} item${count === 1 ? '' : 's'} · ${next}`,
    settings,
  });

  return { subject: renderSubject(settings.email_subject_confirmation || DEFAULT_SUBJECT, order.orderNumber), html };
}
