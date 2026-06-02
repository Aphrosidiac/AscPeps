import axios from 'axios';
import crypto from 'crypto';
import { env } from '../config/env.js';

const getBaseUrl = () =>
  env.TOYYIBPAY_SANDBOX ? 'https://dev.toyyibpay.com' : 'https://toyyibpay.com';

interface CreateBillParams {
  secretKey: string;
  categoryCode: string;
  name: string;
  email: string;
  phone: string;
  amount: number;
  description: string;
  orderNumber: string;
  callbackUrl: string;
  returnUrl: string;
}

export async function createBill(params: CreateBillParams): Promise<string> {
  const formData = new URLSearchParams();
  formData.append('userSecretKey', params.secretKey);
  formData.append('categoryCode', params.categoryCode);
  formData.append('billName', params.description.slice(0, 30));
  formData.append('billDescription', params.description.slice(0, 100));
  formData.append('billPriceSetting', '1');
  formData.append('billPayorInfo', '1');
  formData.append('billAmount', String(params.amount));
  formData.append('billReturnUrl', params.returnUrl);
  formData.append('billCallbackUrl', params.callbackUrl);
  formData.append('billExternalReferenceNo', params.orderNumber);
  formData.append('billTo', params.name);
  formData.append('billEmail', params.email);
  formData.append('billPhone', params.phone.replace(/[^0-9]/g, ''));
  formData.append('billPaymentChannel', '2');
  // Expire the bill after 1 day so an abandoned link can't be paid long after
  // we've already released the reserved stock (which would take money with no
  // confirmable order).
  formData.append('billExpiryDays', '1');

  const { data } = await axios.post(
    `${getBaseUrl()}/index.php/api/createBill`,
    formData.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000 }
  );

  if (Array.isArray(data) && data[0]?.BillCode) {
    return data[0].BillCode;
  }

  throw new Error(`ToyyibPay createBill failed: ${JSON.stringify(data)}`);
}

export function verifyCallbackHash(body: Record<string, string>, secretKey: string): boolean {
  const { status, order_id, refno, hash } = body;
  if (!hash || !status || !order_id || !refno) return false;

  const computed = crypto
    .createHash('md5')
    .update(`${secretKey}${status}${order_id}${refno}ok`)
    .digest('hex');

  // ToyyibPay hashes are hex MD5; normalise case so an upper-case hash from
  // the gateway can't reject an otherwise-valid callback.
  const a = Buffer.from(computed.toLowerCase());
  const b = Buffer.from(String(hash).toLowerCase());
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

interface BillTransactionStatus {
  paid: boolean;
  amount?: number; // in sen/cents
}

/**
 * Re-query ToyyibPay for the true status of a bill. Used to reconcile orders
 * whose callback was missed/delayed, and to release stale unpaid orders.
 * Returns paid=true only if at least one successful (status 1) transaction exists.
 */
export async function getBillTransactions(
  billCode: string,
  secretKey: string
): Promise<BillTransactionStatus> {
  const formData = new URLSearchParams();
  formData.append('userSecretKey', secretKey);
  formData.append('billCode', billCode);
  formData.append('billpaymentStatus', '1'); // only successful payments

  const { data } = await axios.post(
    `${getBaseUrl()}/index.php/api/getBillTransactions`,
    formData.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000 }
  );

  if (Array.isArray(data) && data.length > 0) {
    const txn = data.find((t) => String(t?.billpaymentStatus) === '1') ?? data[0];
    const raw = txn?.billpaymentAmount;
    // getBillTransactions returns amount in RM (e.g. "1.00") — convert to sen.
    const amount =
      raw != null && !Number.isNaN(parseFloat(raw)) ? Math.round(parseFloat(raw) * 100) : undefined;
    return { paid: true, amount };
  }

  return { paid: false };
}
