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

  const { data } = await axios.post(
    `${getBaseUrl()}/index.php/api/createBill`,
    formData.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
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

  try {
    return crypto.timingSafeEqual(
      Buffer.from(computed),
      Buffer.from(hash)
    );
  } catch {
    return false;
  }
}
