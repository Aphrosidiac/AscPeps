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

/**
 * ToyyibPay only accepts alphanumerics, spaces and underscores in `billName`
 * and `billDescription`, and its hosted bill page renders the payer name into
 * a READONLY input guarded by `pattern="[a-zA-Z0-9\s]+"`. Anything outside
 * that set is a real failure, not a cosmetic one:
 *  - our order numbers carry a "/" (ASC2608/0013), which is out of spec for
 *    the two bill text fields;
 *  - a name like "Dr. Chong" produces a form the browser refuses to submit
 *    and the customer cannot correct, because the field is readonly — an
 *    unrecoverable dead end at the last step of checkout.
 * Substitute rather than strip so "ASC2608/0013" stays readable as
 * "ASC2608 0013" on the customer's bill.
 */
function toyyibSafeText(value: string, fallback: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9 _]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || fallback;
}

export async function createBill(params: CreateBillParams): Promise<string> {
  const safeDescription = toyyibSafeText(params.description, 'Order');
  const formData = new URLSearchParams();
  formData.append('userSecretKey', params.secretKey);
  formData.append('categoryCode', params.categoryCode);
  formData.append('billName', safeDescription.slice(0, 30).trim());
  formData.append('billDescription', safeDescription.slice(0, 100).trim());
  formData.append('billPriceSetting', '1');
  formData.append('billPayorInfo', '1');
  formData.append('billAmount', String(params.amount));
  formData.append('billReturnUrl', params.returnUrl);
  formData.append('billCallbackUrl', params.callbackUrl);
  formData.append('billExternalReferenceNo', params.orderNumber);
  formData.append('billTo', toyyibSafeText(params.name, 'Customer').slice(0, 100).trim());
  formData.append('billEmail', params.email);
  formData.append('billPhone', params.phone.replace(/[^0-9]/g, ''));
  formData.append('billPaymentChannel', '2');
  // FPX on its own leaves the customer exactly one way to pay, and the account
  // is not approved for cards — so a bank-selection page they can't use is a
  // dead end. DuitNow QR IS activated on this account (verified via
  // checkDuitNowQRStatus), and covers e-wallets plus every DuitNow bank.
  // chargeDuitNowQR=0 keeps the fee on us, matching how FPX is already set up,
  // so the customer is never asked for more than the total we quoted.
  if (env.TOYYIBPAY_DUITNOW_QR) {
    formData.append('enableDuitNowQR', '1');
    formData.append('chargeDuitNowQR', '0');
  }
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

/**
 * Why an unpaid order is being given up on.
 *
 * The distinction is operational, not cosmetic. `DECLINED` and `ABANDONED_MID_PAYMENT`
 * are customers who picked a payment method and tried to hand us money — a real
 * lost sale worth a follow-up message. `NO_ATTEMPT` is someone who was handed
 * the bill page and never chose anything, which is ordinary checkout drop-off.
 * Reporting the two as one "FAILED" bucket is what hid a genuine bank decline
 * (ASC2608/0021, RM220) among eight abandons.
 */
export type PaymentFailureReason =
  /** The gateway explicitly reported the transaction unsuccessful (status 3). */
  | 'DECLINED'
  /** A channel was selected and handed off, but no final result ever came back. */
  | 'ABANDONED_MID_PAYMENT'
  /** The bill was issued and no payment method was ever chosen. */
  | 'NO_ATTEMPT'
  /** createBill never produced a bill, so there was nothing to pay. */
  | 'NO_BILL'
  /** The gateway couldn't be asked, or doesn't report attempt detail. */
  | 'UNKNOWN';

export interface BillTransactionStatus {
  paid: boolean;
  amount?: number; // in sen/cents
  /** Only meaningful when paid is false. */
  failureReason?: PaymentFailureReason;
  /** The channel the customer actually tried, e.g. "FPX B2C" / "DuitNow QR". */
  channel?: string;
}

/**
 * Re-query ToyyibPay for the true status of a bill. Used to reconcile orders
 * whose callback was missed/delayed, and to release stale unpaid orders.
 * Returns paid=true only if at least one successful (status 1) transaction exists.
 *
 * This deliberately asks for ALL transaction rows rather than filtering to
 * `billpaymentStatus=1` server-side. The unsuccessful rows are the whole point:
 * ToyyibPay writes a channel-less stub row at bill creation and only fills
 * `billpaymentChannel` once the payer actually selects a method, so the
 * presence of a channel is the one reliable signal that a human tried to pay.
 * Because the filter is gone, `paid` must now be derived from an explicit
 * status-1 row — a non-empty response no longer implies payment.
 */
export async function getBillTransactions(
  billCode: string,
  secretKey: string
): Promise<BillTransactionStatus> {
  const formData = new URLSearchParams();
  formData.append('userSecretKey', secretKey);
  formData.append('billCode', billCode);

  const { data } = await axios.post(
    `${getBaseUrl()}/index.php/api/getBillTransactions`,
    formData.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000 }
  );

  return classifyBillRows(data);
}

/**
 * The rules that turn ToyyibPay's transaction rows into a verdict. Pure and
 * exported so it can be tested against real recorded bill shapes without a
 * network call — the classification is the part that must not drift, and it is
 * invisible from outside once it's buried behind an HTTP request.
 *
 * ToyyibPay's `billpaymentStatus`: 1 = success, 2 = pending, 3 = unsuccessful,
 * 4 = the channel-less stub row written when the bill is created.
 */
export function classifyBillRows(data: unknown): BillTransactionStatus {
  // "No data found!" (a bare string) and any unexpected shape both mean we
  // learned nothing — never that the bill was paid.
  const rows: Record<string, string>[] = Array.isArray(data) ? data : [];

  const statusOf = (t: Record<string, string>) => String(t?.billpaymentStatus ?? '');
  const channelOf = (t: Record<string, string>) => String(t?.billpaymentChannel ?? '').trim();

  const paidRow = rows.find((t) => statusOf(t) === '1');
  if (paidRow) {
    const raw = paidRow.billpaymentAmount;
    // getBillTransactions returns amount in RM (e.g. "1.00") — convert to sen.
    const amount =
      raw != null && !Number.isNaN(parseFloat(raw)) ? Math.round(parseFloat(raw) * 100) : undefined;
    return { paid: true, amount, channel: channelOf(paidRow) || undefined };
  }

  if (rows.length === 0) return { paid: false, failureReason: 'UNKNOWN' };

  // A declined row is the strongest signal available, so it wins over a
  // still-open attempt regardless of row order.
  const declined = rows.find((t) => statusOf(t) === '3');
  if (declined) {
    return { paid: false, failureReason: 'DECLINED', channel: channelOf(declined) || undefined };
  }

  const attempted = rows.find((t) => channelOf(t) !== '');
  if (attempted) {
    return {
      paid: false,
      failureReason: 'ABANDONED_MID_PAYMENT',
      channel: channelOf(attempted),
    };
  }

  return { paid: false, failureReason: 'NO_ATTEMPT' };
}

/**
 * Take a bill out of service. Called when we release an abandoned order's
 * stock: `billExpiryDays: 1` leaves the bill payable for a full day, but the
 * stock behind it goes back on sale after two hours — so without this there is
 * a ~22h window where a customer can pay a bill whose order we already
 * cancelled and restocked, and nothing will ever reconcile it (the sweep only
 * looks at UNPAID orders, never FAILED ones). Money in, no order.
 *
 * Note the field is `secretKey` here, NOT `userSecretKey` as on every other
 * endpoint. Best-effort: "Bill has pending transaction process" is a legitimate
 * refusal from ToyyibPay, not an error on our side.
 */
export async function inactiveBill(billCode: string, secretKey: string): Promise<boolean> {
  const formData = new URLSearchParams();
  formData.append('secretKey', secretKey);
  formData.append('billCode', billCode);

  const { data } = await axios.post(
    `${getBaseUrl()}/index.php/api/inactiveBill`,
    formData.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000 }
  );

  const result = Array.isArray(data) ? data[0] : data;
  return result?.status === 'success';
}
