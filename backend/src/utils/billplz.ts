import axios from 'axios';
import crypto from 'crypto';
import { env } from '../config/env.js';

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

interface BillResponse {
  id: string;
  collection_id: string;
  paid: boolean;
  state: string;
  amount: number;
  paid_amount: number;
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
