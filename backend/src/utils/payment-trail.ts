import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Prisma } from '@prisma/client';
import { getGatewayByBillId } from './payment-gateway.js';
import type { BillInspection, NormalizedAttempt, PaymentFailureReason } from './payment-gateway.js';

/**
 * The payment trail: everything that happened to an order's payment, kept so
 * that a failed payment can be explained exactly instead of guessed at.
 *
 * Two tables (schema.prisma): PaymentEvent is what happened, in order;
 * PaymentAttempt is each try at paying, exactly as the gateway lists it. The
 * gateways tell us very little on their own — Billplz gives an attempt an id, a
 * status, a channel and (only if it succeeded) a time — so most of the useful
 * detail is ours: the device at checkout, whether the payment page was ever
 * opened (the pay link goes through our own redirect), whether the customer
 * came back from the gateway and what it said, and every callback.
 *
 * Recording never fails a payment. Every write here is caught and logged: a
 * trail with a hole is a much smaller problem than a customer whose payment
 * errored because an analytics row could not be written.
 */

export type PaymentEventType =
  /** The order was written. data: method, gateway, total, client (device). */
  | 'ORDER_PLACED'
  /** The gateway issued a bill. data: billId, gatewayUrl, amount. */
  | 'BILL_CREATED'
  /** The gateway refused to issue one. data: HTTP status and its answer. */
  | 'BILL_FAILED'
  /** The customer followed the pay link. data: src (checkout/email/retry), client. */
  | 'PAGE_OPENED'
  /** The customer came back from the gateway. data: every parameter, signatureValid. */
  | 'RETURNED'
  /** The gateway's server-to-server callback. data: every field, signatureValid. */
  | 'CALLBACK'
  /** We asked the gateway about the bill. data: trigger, verdict, raw answer. */
  | 'GATEWAY_CHECK'
  /** Asking failed. data: trigger, status, message. */
  | 'GATEWAY_CHECK_FAILED'
  /** UNPAID -> PAID. data: via, gatewayFee. */
  | 'PAID'
  /** Given up on: FAILED + CANCELLED, stock back. data: reason, channel, billClosed. */
  | 'RELEASED'
  /** Money arrived for an order already released. data: via, amount. */
  | 'LATE_PAYMENT';

export type CheckTrigger = 'return' | 'callback' | 'sweep' | 'admin' | 'backfill';

export interface DeviceInfo {
  os: string;
  browser: string;
  /** The app whose built-in browser this is (Instagram, TikTok…), if any. */
  inApp?: string;
  mobile: boolean;
}

export interface ClientContext {
  userAgent?: string;
  /** Cloudflare's CF-IPCountry for the request, e.g. "MY". */
  country?: string;
  /** Origin and path of the page the request came from, query stripped. */
  referrer?: string;
  device: DeviceInfo;
}

// In-app browsers first: they are the ones that break bank redirects, and
// their user agents also contain "Safari"/"Chrome", so order matters.
const IN_APP: [RegExp, string][] = [
  [/Instagram/i, 'Instagram'],
  [/Barcelona/i, 'Threads'],
  [/FBAN|FBAV|FB_IAB|FBIOS/i, 'Facebook'],
  [/musical_ly|BytedanceWebview|TikTok/i, 'TikTok'],
  [/WhatsApp/i, 'WhatsApp'],
  [/Telegram/i, 'Telegram'],
  [/\bLine\//i, 'LINE'],
  [/Twitter/i, 'X'],
  [/Snapchat/i, 'Snapchat'],
  [/GSA\//i, 'Google app'],
];

/** A plain reading of a user agent — enough to group failures by device. */
export function parseUserAgent(ua: string | undefined): DeviceInfo {
  const s = ua ?? '';
  const os = /iPhone|iPad|iPod/i.test(s)
    ? 'iOS'
    : /Android/i.test(s)
      ? 'Android'
      : /Windows/i.test(s)
        ? 'Windows'
        : /Mac OS X|Macintosh/i.test(s)
          ? 'macOS'
          : /Linux|CrOS/i.test(s)
            ? 'Linux'
            : 'Other';
  const inApp = IN_APP.find(([re]) => re.test(s))?.[1];
  const browser = /SamsungBrowser/i.test(s)
    ? 'Samsung Internet'
    : /Edg\//i.test(s)
      ? 'Edge'
      : /OPR\/|Opera/i.test(s)
        ? 'Opera'
        : /Firefox|FxiOS/i.test(s)
          ? 'Firefox'
          : /CriOS|Chrome\//i.test(s)
            ? 'Chrome'
            : /Safari/i.test(s)
              ? 'Safari'
              : 'Other';
  return { os, browser, inApp, mobile: /Mobi|iPhone|iPod|Android/i.test(s) };
}

export function clientContext(request: FastifyRequest): ClientContext {
  const header = (name: string) => {
    const v = request.headers[name];
    return (Array.isArray(v) ? v[0] : v) || undefined;
  };
  const userAgent = header('user-agent')?.slice(0, 500);
  let referrer: string | undefined;
  const ref = header('referer');
  if (ref) {
    try {
      const u = new URL(ref);
      referrer = `${u.origin}${u.pathname}`;
    } catch {
      referrer = undefined;
    }
  }
  const country = header('cf-ipcountry');
  return { userAgent, country: country && country !== 'XX' ? country : undefined, referrer, device: parseUserAgent(userAgent) };
}

/** Gateway signatures are proof, not information — never stored. */
export function withoutSignature(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'x_signature' || k === 'billplz[x_signature]') continue;
    out[k] = v;
  }
  return out;
}

// Prisma's Json input refuses undefined and Dates as-is; a JSON round trip
// gives it exactly what will be stored.
const asJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value ?? {}));

export async function recordPaymentEvent(
  fastify: FastifyInstance,
  event: { orderId: string; type: PaymentEventType; gateway?: string | null; data?: unknown }
): Promise<void> {
  try {
    await fastify.prisma.paymentEvent.create({
      data: { orderId: event.orderId, type: event.type, gateway: event.gateway ?? null, data: asJson(event.data) },
    });
  } catch (err) {
    fastify.log.warn({ err, orderId: event.orderId, type: event.type }, 'payment trail: event not recorded');
  }
}

/**
 * Store the gateway's attempts for an order. Upserted on (gateway, externalId):
 * a re-read refreshes status, channel and the raw row and bumps lastSeenAt,
 * but never moves firstSeenAt — that is the nearest thing to a time Billplz
 * gives a failed attempt. Returns how many attempts are new or changed status,
 * which is what decides whether a routine check is worth an event.
 */
export async function upsertAttempts(
  fastify: FastifyInstance,
  orderId: string,
  gateway: string,
  attempts: NormalizedAttempt[]
): Promise<number> {
  let changed = 0;
  for (const a of attempts) {
    try {
      const existing = await fastify.prisma.paymentAttempt.findUnique({
        where: { gateway_externalId: { gateway, externalId: a.externalId } },
        select: { status: true },
      });
      if (!existing || existing.status !== a.status) changed++;
      await fastify.prisma.paymentAttempt.upsert({
        where: { gateway_externalId: { gateway, externalId: a.externalId } },
        create: {
          orderId,
          gateway,
          externalId: a.externalId,
          status: a.status,
          channel: a.channel ?? null,
          amount: a.amount ?? null,
          attemptedAt: a.attemptedAt ?? null,
          completedAt: a.completedAt ?? null,
          raw: asJson(a.raw),
        },
        update: {
          status: a.status,
          channel: a.channel ?? null,
          amount: a.amount ?? null,
          ...(a.attemptedAt ? { attemptedAt: a.attemptedAt } : {}),
          ...(a.completedAt ? { completedAt: a.completedAt } : {}),
          lastSeenAt: new Date(),
          raw: asJson(a.raw),
        },
      });
    } catch (err) {
      fastify.log.warn({ err, orderId, externalId: a.externalId }, 'payment trail: attempt not recorded');
    }
  }
  return changed;
}

/** Counts of an inspection's attempts by status, for the event and the logs. */
function attemptSummary(attempts: NormalizedAttempt[]) {
  const by = (status: NormalizedAttempt['status']) => attempts.filter((a) => a.status === status).length;
  return { total: attempts.length, completed: by('completed'), failed: by('failed'), pending: by('pending'), opened: by('opened') };
}

/**
 * Ask the gateway about an order's bill, store every attempt it lists, and
 * record what it said. Returns null when the gateway has no attempt detail to
 * give (BTCPay) — the caller then falls back to verifyPaid. Throws when the
 * gateway could not be asked, after recording that it could not.
 *
 * `quiet` is for the ToyyibPay sweep, which looks at every open bill every two
 * minutes: the attempts are still upserted each time, but an event is written
 * only when something changed, so the trail is not buried in identical checks.
 */
export async function inspectAndRecord(
  fastify: FastifyInstance,
  order: { id: string; paymentRef: string | null; paymentGateway: string | null },
  trigger: CheckTrigger,
  opts: { quiet?: boolean } = {}
): Promise<BillInspection | null> {
  if (!order.paymentRef) return null;
  const gateway = getGatewayByBillId(order.paymentRef, order.paymentGateway ?? undefined);
  if (!gateway?.inspectBill) return null;

  let inspection: BillInspection;
  try {
    inspection = await gateway.inspectBill(order.paymentRef);
  } catch (err) {
    const response = (err as { response?: { status?: number; data?: unknown } }).response;
    await recordPaymentEvent(fastify, {
      orderId: order.id,
      type: 'GATEWAY_CHECK_FAILED',
      gateway: gateway.name,
      data: { trigger, billId: order.paymentRef, status: response?.status, answer: response?.data, message: (err as Error)?.message },
    });
    throw err;
  }

  const changed = await upsertAttempts(fastify, order.id, gateway.name, inspection.attempts);
  if (!opts.quiet || changed > 0 || inspection.paid) {
    await recordPaymentEvent(fastify, {
      orderId: order.id,
      type: 'GATEWAY_CHECK',
      gateway: gateway.name,
      data: {
        trigger,
        billId: order.paymentRef,
        paid: inspection.paid,
        state: inspection.state,
        verdict: inspection.paid ? 'PAID' : inspection.failureReason,
        channel: inspection.channel,
        amount: inspection.amount,
        attempts: attemptSummary(inspection.attempts),
        raw: inspection.raw,
      },
    });
  }
  return inspection;
}

/**
 * The reason an order is released with. The gateway's verdict, sharpened by
 * what only we know: a bill that went out through the tracked pay link
 * (BILL_CREATED recorded) and was never followed (no PAGE_OPENED) and has no
 * attempt of any kind was never even looked at — NEVER_OPENED, not the
 * ordinary NO_ATTEMPT. Orders from before the pay link have no BILL_CREATED,
 * so they keep the gateway's NO_ATTEMPT rather than a guess.
 */
export async function releaseReason(
  fastify: FastifyInstance,
  orderId: string,
  gatewayReason: PaymentFailureReason | undefined,
  attempts: NormalizedAttempt[]
): Promise<PaymentFailureReason> {
  const reason = gatewayReason ?? 'UNKNOWN';
  if (reason !== 'NO_ATTEMPT' || attempts.length > 0) return reason;
  const events = await fastify.prisma.paymentEvent.findMany({
    where: { orderId, type: { in: ['BILL_CREATED', 'PAGE_OPENED'] } },
    select: { type: true },
  });
  const tracked = events.some((e) => e.type === 'BILL_CREATED');
  const opened = events.some((e) => e.type === 'PAGE_OPENED');
  return tracked && !opened ? 'NEVER_OPENED' : reason;
}

/**
 * Give an already-released order the reason a fresh look at its bill supports,
 * when it was released without one (null / UNKNOWN — every Billplz failure
 * before the payment trail existed). A reason that was already recorded is
 * never overwritten: it was read at the moment of release, which is the
 * better witness. Returns the reason now on the order.
 */
export async function refineFailureReason(
  fastify: FastifyInstance,
  order: { id: string; paymentStatus: string; paymentFailureReason: string | null },
  inspection: BillInspection
): Promise<string | null> {
  if (order.paymentStatus !== 'FAILED' || inspection.paid) return order.paymentFailureReason;
  if (order.paymentFailureReason && order.paymentFailureReason !== 'UNKNOWN') return order.paymentFailureReason;
  const reason = await releaseReason(fastify, order.id, inspection.failureReason, inspection.attempts);
  if (reason === 'UNKNOWN') return order.paymentFailureReason;
  await fastify.prisma.order.update({
    where: { id: order.id },
    data: { paymentFailureReason: reason, paymentFailureChannel: inspection.channel ?? null },
  });
  return reason;
}
