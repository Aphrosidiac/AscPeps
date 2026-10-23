import type { PaymentAttempt, PaymentDevice, PaymentEvent, PaymentFailureReason } from '@/types';
import { formatPrice } from './utils';

/**
 * How the payment trail (backend utils/payment-trail.ts) reads in admin — one
 * place, so the order page and Admin → Payments say the same thing about the
 * same event. Every sentence names what the gateway or the customer's browser
 * actually did; where the gateway is silent (Billplz never says which bank or
 * why an attempt failed) the copy says so rather than filling the gap.
 */

export const GATEWAY_NAMES: Record<string, string> = {
  billplz: 'Billplz',
  toyyibpay: 'ToyyibPay',
  btcpay: 'BTCPay',
  manualpaygate: 'bank-transfer page',
};
export const gatewayName = (g: string | null | undefined) => (g ? GATEWAY_NAMES[g] ?? g : 'the gateway');

export const REASON_LABELS: Record<PaymentFailureReason, string> = {
  DECLINED: 'Attempt failed',
  ABANDONED_MID_PAYMENT: 'Left at the bank',
  NO_ATTEMPT: 'Never chose a payment method',
  NEVER_OPENED: 'Never opened the payment page',
  NO_BILL: 'No bill created',
  UNKNOWN: 'Reason not recorded',
};

/** One line on what each reason means — the legend on Admin → Payments. */
export const REASON_HINTS: Record<PaymentFailureReason, string> = {
  DECLINED: 'Chose a method; the attempt failed — the bank refused it or they cancelled on the bank page. The gateway does not say which.',
  ABANDONED_MID_PAYMENT: 'Chose a method and was handed to the bank; no result ever came back.',
  NO_ATTEMPT: 'Had the payment page and never picked a payment method. Since page visits are tracked, someone who never opened the page at all is counted under its own reason instead.',
  NEVER_OPENED: 'The bill was ready; the customer never opened the payment page at all.',
  NO_BILL: 'The gateway refused to create the bill, so there was nothing to pay.',
  UNKNOWN: 'Released before reasons were recorded, and the gateway could not be asked since.',
};

export const SOURCE_LABELS: Record<string, string> = {
  checkout: 'checkout',
  email: 'the order email',
  retry: 'the "try again" button',
  track: 'the tracking page',
  other: 'an unknown link',
};

export const ATTEMPT_STATUS: Record<PaymentAttempt['status'], { label: string; tone: string }> = {
  completed: { label: 'Paid', tone: 'bg-success/10 text-success' },
  failed: { label: 'Failed', tone: 'bg-danger/10 text-danger' },
  pending: { label: 'No result', tone: 'bg-warning/10 text-warning' },
  opened: { label: 'Page shown', tone: 'bg-surface-elevated text-text-secondary' },
};

export function deviceText(d: PaymentDevice | null | undefined, country?: string): string {
  if (!d) return 'Not recorded';
  const what = d.inApp ? `${d.inApp} in-app browser` : d.browser;
  return `${d.os} · ${what}${country ? ` · ${country}` : ''}`;
}

/** "21 Oct 2026, 19:49:39" in Malaysia time — seconds matter on a trail. */
export function formatMoment(iso: string): string {
  return new Date(iso).toLocaleString('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/** "+8 min", "+2 h 01 min" after the order was placed. */
export function sinceOrder(iso: string, createdAt: string): string {
  const ms = new Date(iso).getTime() - new Date(createdAt).getTime();
  if (ms < 60_000) return ms < 1000 ? 'at checkout' : `+${Math.round(ms / 1000)} s`;
  const min = Math.round(ms / 60_000);
  if (min < 60) return `+${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `+${h} h ${String(min % 60).padStart(2, '0')} min`;
  return `+${Math.round(h / 24)} days`;
}

export const minutesText = (m: number | null) =>
  m == null ? '—' : m < 1 ? `${Math.round(m * 60)} s` : m < 60 ? `${Math.round(m)} min` : `${(m / 60).toFixed(1)} h`;

const yesNo = (v: unknown) => (v === true || v === 'true' ? 'paid' : v === false || v === 'false' ? 'not paid' : String(v ?? '—'));

/** The title and the one-line detail for a trail event. */
export function describeEvent(e: PaymentEvent): { title: string; detail?: string; tone?: 'good' | 'bad' | 'warn' } {
  const d = e.data ?? {};
  const gw = gatewayName(e.gateway);
  switch (e.type) {
    case 'ORDER_PLACED': {
      const via = d.source === 'assistant' ? 'keyed in by the assistant' : deviceText(d.client?.device, d.client?.country);
      return { title: `Order placed (${String(d.method ?? '').toLowerCase()})`, detail: `${formatPrice(d.total ?? 0)} · ${via}` };
    }
    case 'BILL_CREATED':
      return { title: `Bill created on ${gw}`, detail: `Bill ${d.billId}${d.emailSent ? ' · customer email on the bill' : ''}` };
    case 'BILL_FAILED':
      return {
        title: `${gw} refused to create the bill`,
        detail: [d.status ? `HTTP ${d.status}` : null, typeof d.answer === 'string' ? d.answer : d.answer ? JSON.stringify(d.answer) : d.message]
          .filter(Boolean)
          .join(' · '),
        tone: 'bad',
      };
    case 'PAGE_OPENED':
      return {
        title: 'Opened the payment page',
        detail: `From ${SOURCE_LABELS[d.src] ?? d.src} · ${deviceText(d.client?.device, d.client?.country)}`,
      };
    case 'RETURNED': {
      const p = d.params ?? {};
      const paid = p['billplz[paid]'] ?? (p.status_id === '1' ? 'true' : p.status_id ? 'false' : undefined);
      const txn = p['billplz[transaction_status]'];
      const bits = [
        `${gw} said ${yesNo(paid)}`,
        txn ? `attempt ${p['billplz[transaction_id]'] ?? ''} ${txn}` : null,
        p.msg ? `“${p.msg}”` : null,
        d.signatureValid === false ? 'signature did NOT verify' : null,
      ].filter(Boolean);
      return { title: `Came back from ${gw}`, detail: bits.join(' · '), tone: paid === 'true' ? 'good' : 'warn' };
    }
    case 'CALLBACK': {
      const f = d.fields ?? {};
      const paid = f.paid ?? (f.status === '1' ? 'true' : f.status ? 'false' : undefined);
      const bits = [
        `${yesNo(paid)}${f.state ? ` (${f.state})` : ''}`,
        f.paid_amount ? formatPrice(Number(f.paid_amount)) : null,
        f.transaction_status ? `attempt ${f.transaction_id ?? ''} ${f.transaction_status}` : null,
        d.signatureValid ? 'signature verified' : 'signature did NOT verify — ignored',
      ].filter(Boolean);
      return { title: `${gw} callback`, detail: bits.join(' · '), tone: d.signatureValid ? undefined : 'bad' };
    }
    case 'GATEWAY_CHECK': {
      const a = d.attempts ?? {};
      const counts = [
        a.completed ? `${a.completed} paid` : null,
        a.failed ? `${a.failed} failed` : null,
        a.pending ? `${a.pending} without a result` : null,
        a.opened ? `${a.opened} page view${a.opened === 1 ? '' : 's'}` : null,
      ].filter(Boolean);
      const trigger: Record<string, string> = {
        return: 'on their return',
        callback: 'after the callback',
        sweep: 'before release',
        admin: 'by hand',
        backfill: 'backfill',
      };
      return {
        title: `Checked with ${gw} (${trigger[d.trigger] ?? d.trigger})`,
        detail: [
          d.paid ? 'paid' : d.verdict ? REASON_LABELS[d.verdict as PaymentFailureReason] ?? d.verdict : null,
          d.state ? `bill ${d.state}` : null,
          counts.length ? counts.join(', ') : 'no attempts listed',
        ]
          .filter(Boolean)
          .join(' · '),
      };
    }
    case 'GATEWAY_CHECK_FAILED':
      return { title: `Could not check with ${gw}`, detail: [d.status ? `HTTP ${d.status}` : null, d.message].filter(Boolean).join(' · '), tone: 'warn' };
    case 'PAID':
      return { title: 'Marked paid', detail: `Confirmed by the ${d.via ?? 'gateway'}${d.gatewayFee ? ` · fee ${formatPrice(d.gatewayFee)}` : ''}`, tone: 'good' };
    case 'RELEASED': {
      const closed: Record<string, string> = {
        closed: 'bill closed',
        refused: 'gateway refused to close the bill',
        error: 'could not close the bill',
        no_bill: 'there was no bill',
        not_supported: 'bill left open',
      };
      return {
        title: 'Released — cancelled, stock back',
        detail: `${REASON_LABELS[d.reason as PaymentFailureReason] ?? d.reason}${d.channel ? ` (${d.channel})` : ''} · ${closed[d.billClosed] ?? d.billClosed}`,
        tone: 'bad',
      };
    }
    case 'LATE_PAYMENT':
      return { title: 'LATE PAYMENT — money arrived after release', detail: 'Reinstate the order or refund it by hand.', tone: 'bad' };
    default:
      return { title: e.type };
  }
}
