import axios from 'axios';
import crypto from 'crypto';
import { env } from '../config/env.js';
import type { BillTransactionStatus, NormalizedAttempt } from './toyyibpay.js';

const getBaseUrl = () =>
  env.BILLPLZ_SANDBOX ? 'https://www.billplz-sandbox.com/api' : 'https://www.billplz.com/api';

const getAuth = () => ({
  username: env.BILLPLZ_API_KEY || '',
  password: '',
});

interface CreateBillParams {
  collectionId: string;
  name: string;
  email?: string;
  mobile?: string;
  amount: number;
  description: string;
  callbackUrl: string;
  redirectUrl: string;
  referenceOne?: string;
}

export interface BillResponse {
  id: string;
  collection_id: string;
  paid: boolean;
  /** due | paid | deleted */
  state: string;
  amount: number;
  paid_amount: number;
  paid_at?: string | null;
  due_at?: string;
  url: string;
  name: string;
  description: string;
}

export async function createBill(params: CreateBillParams): Promise<BillResponse> {
  const { data } = await axios.post<BillResponse>(
    `${getBaseUrl()}/v3/bills`,
    {
      collection_id: params.collectionId,
      name: params.name,
      email: params.email || null,
      mobile: params.mobile || null,
      amount: params.amount,
      description: params.description,
      callback_url: params.callbackUrl,
      redirect_url: params.redirectUrl,
      reference_1_label: 'Order Number',
      reference_1: params.referenceOne || '',
    },
    { auth: getAuth(), timeout: 30000 }
  );
  return data;
}

export async function getBill(billId: string): Promise<BillResponse> {
  const { data } = await axios.get<BillResponse>(
    `${getBaseUrl()}/v3/bills/${billId}`,
    { auth: getAuth(), timeout: 30000 }
  );
  return data;
}

export interface BillplzTransaction {
  id: string;
  /** pending | completed | failed */
  status: string;
  /** ISO 8601; null unless completed. */
  completed_at: string | null;
  /** FPX, TOUCHNGO, BOOST, BILLPLZ (card), TWOCTWOP… */
  payment_channel: string | null;
}

/**
 * Every payment attempt on a bill — the only attempt detail Billplz has: an
 * id, a status, a completion time and a channel. No bank, no decline reason,
 * and no time at all on a failed attempt. An empty list means the payer never
 * picked a payment method. Still answers for deleted bills.
 *
 * 15 per page; read until a page comes back short. Each page is one GET
 * against the 100 (or 10) per 5 minutes budget, so callers ask once per look
 * at a bill, never on a timer.
 */
export async function getBillTransactions(billId: string): Promise<BillplzTransaction[]> {
  const all: BillplzTransaction[] = [];
  for (let page = 1; page <= 10; page++) {
    const { data } = await axios.get<{ transactions?: BillplzTransaction[] }>(
      `${getBaseUrl()}/v3/bills/${billId}/transactions`,
      { auth: getAuth(), timeout: 30000, params: { page } }
    );
    const rows = data.transactions ?? [];
    all.push(...rows);
    if (rows.length < 15) break;
  }
  return all;
}

/**
 * A bill's verdict from its own state and its attempts. Pure, so it is tested
 * against real recorded bills (scripts/test-payment-trail.ts).
 *
 *  - paid: the bill says so; the channel is the completed attempt's.
 *  - DECLINED: at least one attempt failed and none completed. Billplz's
 *    "failed" covers a bank refusal AND a customer pressing cancel at the
 *    bank — it does not say which.
 *  - ABANDONED_MID_PAYMENT: an attempt is still pending — a method was chosen
 *    and handed to the bank, and no result came back.
 *  - NO_ATTEMPT: no attempts at all; the payer never picked a method. Unlike
 *    ToyyibPay an empty list is a real answer here, not "could not tell".
 */
export function classifyBillplz(bill: Pick<BillResponse, 'paid' | 'paid_amount'>, txns: BillplzTransaction[]): BillTransactionStatus {
  const completed = txns.find((t) => t.status === 'completed');
  if (bill.paid) {
    return { paid: true, amount: bill.paid_amount, channel: completed?.payment_channel || undefined };
  }
  const failed = txns.find((t) => t.status === 'failed');
  if (failed) return { paid: false, failureReason: 'DECLINED', channel: failed.payment_channel || undefined };
  const pending = txns.find((t) => t.status === 'pending');
  if (pending) return { paid: false, failureReason: 'ABANDONED_MID_PAYMENT', channel: pending.payment_channel || undefined };
  return { paid: false, failureReason: 'NO_ATTEMPT' };
}

// Billplz lists a bill's attempts newest first; they are stored oldest first,
// so a first sighting (firstSeenAt) keeps the order they happened in.
export function billplzAttempts(bill: Pick<BillResponse, 'amount'>, txns: BillplzTransaction[]): NormalizedAttempt[] {
  return [...txns].reverse().map((t) => {
    const completedAt = t.completed_at ? new Date(t.completed_at) : undefined;
    return {
      externalId: t.id,
      status: t.status === 'completed' || t.status === 'failed' ? t.status : 'pending',
      channel: t.payment_channel || undefined,
      amount: bill.amount,
      attemptedAt: completedAt,
      completedAt,
      raw: t,
    };
  });
}

/**
 * Delete a still-due bill so it can no longer be paid (Billplz: only "due"
 * bills can be deleted; a paid one answers 422). Returns false when Billplz
 * refused because the bill is already paid. Note Billplz's own caveat: a
 * customer already on the bank page can still complete payment, and the bill
 * then comes back as paid.
 */
export async function deleteBill(billId: string): Promise<boolean> {
  try {
    await axios.delete(`${getBaseUrl()}/v3/bills/${billId}`, { auth: getAuth(), timeout: 30000 });
    return true;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 422) return false;
    throw err;
  }
}

// Billplz has no refund API: money goes back by hand, from the Billplz
// dashboard or a bank transfer. See admin-orders.controller.ts.

export function verifyCallbackSignature(body: Record<string, string>): boolean {
  const signatureKey = env.BILLPLZ_SIGNATURE_KEY;
  if (!signatureKey) return false;

  const receivedSignature = body.x_signature;
  if (!receivedSignature) return false;

  const sourceItems: string[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (key === 'x_signature') continue;
    sourceItems.push(`${key}${value}`);
  }

  sourceItems.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const sourceString = sourceItems.join('|');

  const computed = crypto
    .createHmac('sha256', signatureKey)
    .update(sourceString)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(computed, 'hex'),
      Buffer.from(receivedSignature, 'hex')
    );
  } catch {
    return false;
  }
}

export function verifyRedirectSignature(query: Record<string, string>): boolean {
  const signatureKey = env.BILLPLZ_SIGNATURE_KEY;
  if (!signatureKey) return false;

  const receivedSignature = query['billplz[x_signature]'];
  if (!receivedSignature) return false;

  const sourceItems: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (key === 'billplz[x_signature]') continue;
    if (!key.startsWith('billplz[')) continue;
    const flatKey = key.replace('[', '').replace(']', '');
    sourceItems.push(`${flatKey}${value}`);
  }

  sourceItems.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const sourceString = sourceItems.join('|');

  const computed = crypto
    .createHmac('sha256', signatureKey)
    .update(sourceString)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(computed, 'hex'),
      Buffer.from(receivedSignature, 'hex')
    );
  } catch {
    return false;
  }
}
