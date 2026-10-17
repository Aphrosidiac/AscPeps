import axios, { AxiosError } from 'axios';
import crypto from 'crypto';
import { env } from '../config/env.js';
import type { BillTransactionStatus } from './toyyibpay.js';

/**
 * CHIP Collect (chip-in.asia). Every path and field here is taken from CHIP's
 * own OpenAPI spec (docs.chip-in.asia/openapi/chip-collect.yaml), not from
 * memory: resource paths are plural with a trailing slash, money is integer
 * sen, and the one bearer key decides test vs live — there is no sandbox host.
 */

const api = () =>
  axios.create({
    baseURL: env.CHIP_API_URL,
    headers: { Authorization: `Bearer ${env.CHIP_SECRET_KEY}`, 'Content-Type': 'application/json' },
    timeout: 30000,
  });

/** The fields of CHIP's Purchase object this integration reads. */
export interface ChipPurchase {
  id: string;
  status: string;
  is_test?: boolean;
  brand_id?: string;
  reference?: string;
  checkout_url?: string | null;
  purchase?: { total?: number; currency?: string };
  payment?: { amount?: number; fee_amount?: number } | null;
  transaction_data?: {
    payment_method?: string;
    attempts?: { successful?: boolean; payment_method?: string; error?: { code?: string } | null }[];
  };
}

/**
 * CHIP answers a bad request with `{ field: [{ message, code }] }` (or
 * `__all__` for request-level errors). Flatten it into one line so the log
 * says WHY the purchase was refused, without dumping the request (which
 * carries the customer's details).
 */
function describeError(err: unknown): string {
  const ax = err as AxiosError<Record<string, unknown>>;
  const status = ax.response?.status;
  const data = ax.response?.data;
  if (data && typeof data === 'object') {
    const parts = Object.entries(data).flatMap(([field, v]) => {
      const list = Array.isArray(v) ? v : [v];
      return list.map((e) => {
        const m = e && typeof e === 'object' ? (e as { message?: string; code?: string }) : { message: String(e) };
        return `${field}: ${m.message ?? ''}${m.code ? ` (${m.code})` : ''}`;
      });
    });
    if (parts.length) return `HTTP ${status} — ${parts.join('; ')}`;
  }
  return status ? `HTTP ${status}` : ax.message || String(err);
}

async function call<T>(fn: () => Promise<{ data: T }>, what: string): Promise<T> {
  try {
    return (await fn()).data;
  } catch (err) {
    throw new Error(`CHIP ${what} failed: ${describeError(err)}`);
  }
}

/** CHIP's Phone format is `<country code> <number>`, e.g. "+60 123456789". */
export function chipPhone(phone: string): string | undefined {
  const digits = phone.replace(/[^0-9]/g, '');
  if (!digits) return undefined;
  const local = digits.startsWith('60') ? digits.slice(2) : digits.replace(/^0/, '');
  return local ? `+60 ${local}` : undefined;
}

export interface CreatePurchaseParams {
  email: string;
  phone: string;
  fullName: string;
  amount: number; // sen
  productName: string;
  reference: string;
  /** Unix seconds. With due_strict the purchase becomes `expired` and unpayable after this. */
  due: number;
  successRedirect: string;
  failureRedirect: string;
  cancelRedirect: string;
  /** Omitted when it can't be valid — CHIP rejects a callback URL with an explicit port. */
  successCallback?: string;
}

export async function createPurchase(p: CreatePurchaseParams): Promise<ChipPurchase> {
  const phone = chipPhone(p.phone);
  const fullName = p.fullName.trim().slice(0, 128);
  const body = {
    brand_id: env.CHIP_BRAND_ID,
    client: {
      email: p.email,
      ...(phone ? { phone } : {}),
      ...(fullName ? { full_name: fullName } : {}),
    },
    purchase: {
      currency: 'MYR',
      // One line for the exact order total. The total already nets shipping
      // and any discount; itemising it here would only give CHIP's page a
      // second, rounded copy of the arithmetic to disagree with.
      products: [{ name: p.productName.slice(0, 256), price: p.amount, quantity: 1 }],
      language: 'en',
      timezone: 'Asia/Kuala_Lumpur',
      due_strict: true,
    },
    due: p.due,
    reference: p.reference,
    // Ascend sends its own receipt from applyPaid; a CHIP one as well would
    // be a second, differently-branded email for the same payment.
    send_receipt: false,
    creator_agent: 'Ascend MY',
    platform: 'api',
    success_redirect: p.successRedirect,
    failure_redirect: p.failureRedirect,
    cancel_redirect: p.cancelRedirect,
    ...(p.successCallback ? { success_callback: p.successCallback } : {}),
  };
  return call(() => api().post<ChipPurchase>('/purchases/', body), 'create purchase');
}

export async function getPurchase(id: string): Promise<ChipPurchase> {
  return call(() => api().get<ChipPurchase>(`/purchases/${encodeURIComponent(id)}/`), 'retrieve purchase');
}

/** "If a Purchase is still payable, this request guarantees that it cannot be paid." */
export async function cancelPurchase(id: string): Promise<ChipPurchase> {
  return call(() => api().post<ChipPurchase>(`/purchases/${encodeURIComponent(id)}/cancel/`), 'cancel purchase');
}

/** Full refund when `amount` is omitted; otherwise a partial refund in sen. */
export async function refundPurchase(id: string, amount?: number): Promise<{ id?: string; status?: string }> {
  return call(
    () => api().post(`/purchases/${encodeURIComponent(id)}/refund/`, amount != null ? { amount } : {}),
    'refund purchase'
  );
}

// ---- Success-callback signatures ----------------------------------------
//
// Each callback carries X-Signature: a base64 RSA PKCS#1 v1.5 signature of the
// SHA-256 digest of the RAW body. The key is company-wide and comes from
// GET /public_key/, which returns a JSON-encoded PEM string. CHIP_PUBLIC_KEY
// pins it; otherwise it is fetched once and kept in memory.

let cachedKey: string | null = null;
let lastFetch = 0;
const REFETCH_AFTER_MS = 5 * 60 * 1000;

/** Accepts a PEM pasted into .env with literal "\n"s, which is how it usually arrives. */
function normalisePem(pem: string): string {
  return pem.replace(/\\n/g, '\n').trim();
}

async function fetchPublicKey(): Promise<string> {
  const data = await call(() => api().get<unknown>('/public_key/'), 'fetch public key');
  if (typeof data !== 'string' || !data.includes('BEGIN PUBLIC KEY')) {
    throw new Error('CHIP fetch public key failed: unexpected response shape');
  }
  lastFetch = Date.now();
  cachedKey = normalisePem(data);
  return cachedKey;
}

export function verifySignatureWithKey(rawBody: Buffer, signature: string | undefined, publicKeyPem: string): boolean {
  if (!signature) return false;
  try {
    return crypto.verify('sha256', rawBody, normalisePem(publicKeyPem), Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

export async function verifyCallbackSignature(rawBody: Buffer, signature: string | undefined): Promise<boolean> {
  if (!signature) return false;
  if (env.CHIP_PUBLIC_KEY) return verifySignatureWithKey(rawBody, signature, env.CHIP_PUBLIC_KEY);

  const key = cachedKey ?? (await fetchPublicKey());
  if (verifySignatureWithKey(rawBody, signature, key)) return true;
  // One refetch in case the key was rotated since it was cached — rate-limited
  // so a stream of forged callbacks can't turn into a stream of API calls.
  if (Date.now() - lastFetch > REFETCH_AFTER_MS) {
    return verifySignatureWithKey(rawBody, signature, await fetchPublicKey());
  }
  return false;
}

// ---- Status classification ----------------------------------------------

// Paid, and still paid: cleared/settled are later card-network stages of the
// same successful payment, and FPX/QR purchases simply stay `paid`.
const PAID = new Set(['paid', 'cleared', 'settled']);
// Money is moving but the acquirer hasn't answered yet. Releasing the stock
// now could take a payment for an order we've just cancelled.
const IN_FLIGHT = new Set(['pending_execute', 'pending_charge', 'pending_capture']);

/**
 * Turn a CHIP Purchase into the shared verdict. Pure, so it is tested against
 * the shapes in scripts/test-chip.ts without a network call.
 *
 * `acceptTest` is false on a live deployment: a purchase made with a test key
 * reports `paid` for a test card number, and must never ship real goods.
 */
export function classifyPurchase(p: ChipPurchase, opts: { acceptTest: boolean }): BillTransactionStatus {
  const attempts = p.transaction_data?.attempts ?? [];
  const channel =
    p.transaction_data?.payment_method || attempts.find((a) => a.payment_method)?.payment_method || undefined;

  if (p.is_test && !opts.acceptTest) return { paid: false, failureReason: 'UNKNOWN', channel };

  if (PAID.has(p.status)) {
    return {
      paid: true,
      amount: p.payment?.amount ?? p.purchase?.total,
      fee: p.payment?.fee_amount,
      channel,
    };
  }

  if (IN_FLIGHT.has(p.status)) {
    return { paid: false, pending: true, failureReason: 'ABANDONED_MID_PAYMENT', channel };
  }

  // `error` = the payer's instrument was refused; `blocked` = refused by fraud
  // scoring. Either way somebody tried to hand us money — a decline, which is
  // a lost sale worth chasing, not a drop-off. A failed attempt on the
  // attempts list says the same thing for a purchase that has since expired.
  const declined = attempts.find((a) => a.successful === false);
  if (p.status === 'error' || p.status === 'blocked' || declined) {
    return { paid: false, failureReason: 'DECLINED', channel: declined?.payment_method || channel };
  }

  // A refund or chargeback on a purchase whose order we never marked paid:
  // someone acted on it in the CHIP portal. Not ours to guess — hand it to a
  // human rather than call it paid (it isn't, any more) or an abandon.
  if (['refunded', 'pending_refund', 'chargeback'].includes(p.status)) {
    return { paid: false, failureReason: 'UNKNOWN', channel };
  }

  // created / sent / viewed / overdue / expired / cancelled with no attempt on
  // record: the page was handed over and nothing was ever submitted.
  return { paid: false, failureReason: 'NO_ATTEMPT', channel };
}
