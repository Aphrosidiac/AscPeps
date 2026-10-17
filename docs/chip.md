# CHIP payment gateway

CHIP Collect ([chip-in.asia](https://chip-in.asia)) is the third fiat gateway,
next to ToyyibPay and Billplz. One hosted page takes FPX, DuitNow QR, e-wallets
and cards. Pick it in **Admin → Settings → Payments → Gateway**. Orders still
store `paymentMethod: BILLPLZ` (the legacy "paid online" enum) and
`paymentGateway: 'chip'`.

Every path and field was taken from CHIP's OpenAPI spec
(`docs.chip-in.asia/openapi/chip-collect.yaml`), not from memory.

## Setup

Portal → Developers:

| Env | Where |
|---|---|
| `CHIP_SECRET_KEY` | API keys. A **test** key and a **live** key exist; they are not interchangeable. |
| `CHIP_BRAND_ID` | Brands. The same for test and live. |
| `CHIP_PUBLIC_KEY` | Optional. Leave it unset and the key that signs callbacks is fetched from `GET /public_key/` on the first callback. Set it only to pin the key. A PEM with literal `\n`s works. |

No webhook needs setting up in the portal. Each purchase carries its own
`success_callback` (`https://<domain>/api/v1/payments/chip/callback`).

The admin settings save **refuses to switch the gateway** to one this server has
no credentials for, so set the env and restart before you flip the dropdown.

## How a payment is confirmed

There are three paths. All of them ask CHIP itself (`GET /purchases/{id}/`) and
then go through `applyPaid()`, whose guarded `UNPAID → PAID` transition makes
duplicate confirmations do nothing.

1. **Redirect.** `success_redirect`, `failure_redirect` and `cancel_redirect` all
   point at `/api/v1/payments/redirect?gateway=chip&orderNumber=…`. CHIP doesn't
   sign its redirects, so the server-side re-query is the only thing that
   confirms anything.
2. **Success callback.** This route reads the raw body because the signature
   covers the exact bytes: RSA PKCS#1 v1.5 over SHA-256, base64 in `X-Signature`.
   A forged or missing signature gets a 400. A callback CHIP can't be asked
   about yet gets a 503 so CHIP retries (it tries up to 8 times over 36 h).
   CHIP refuses a callback URL with an explicit port, so the callback is left
   out locally (`http://localhost:3105`). There the redirect and the sweep do
   the confirming.
3. **Reconcile sweep** (every 2 min). Orders more than 3 min old get
   re-queried. After 2 h unpaid an order is released: stock goes back and
   `POST /purchases/{id}/cancel/` makes the purchase unpayable. The purchase also
   has `due` set to 2 h with `due_strict`, so CHIP expires it at the same time.

| CHIP status | Verdict |
|---|---|
| `paid`, `cleared`, `settled` | paid |
| `pending_execute` / `pending_charge` / `pending_capture` | not paid, **in flight**: release held for up to 24 h |
| `error`, `blocked`, or any refused attempt | `DECLINED` (a lost sale, not a drop-off) |
| `created` / `viewed` / `expired` / `cancelled` with no attempt | `NO_ATTEMPT` |
| `refunded` / `chargeback` on an unpaid order | `UNKNOWN`, for a human to look at |

**Fee.** CHIP reports what it kept on each payment (`payment.fee_amount`), and
that number is what goes into `Order.gatewayFee`. The configured rule
(`gateway_fee_chip_*`, default RM1 = FPX B2C) is used only when an order is
marked paid by hand.

## Test key vs live key

CHIP has no sandbox host. Whether you're in test or live mode depends only on
which key you use, and every purchase says which it is (`is_test`). On a real
deployment (a non-localhost `FRONTEND_URL`):

- `createBill` refuses a test purchase and cancels it before the customer sees
  it. Checkout fails loudly instead of taking test cards.
- `verifyPaid` never counts a test purchase as paid.

Test cards (test key only): `4444 3333 2222 1111` (non-3DS) or
`5555 5555 5555 4444` (3DS), CVC `123`, any future expiry. A wrong CVC fails.

## Refunds

When a paid CHIP order is set to **Refunded**, the money goes back through
`POST /purchases/{id}/refund/` straight away. The amount is the full total, or
the partial amount typed on the order page. This happens before anything in our
database changes, and if CHIP refuses, nothing changes. Both admin screens ask
for confirmation and state the amount. Saving an order that's already Refunded
again never sends a second refund. Fix a wrong amount in the CHIP portal.

## Testing without credentials

```bash
npm run test:chip     # classification, phone format, signatures — no network
npm run chip:mock     # local CHIP on :4599 (hosted page with Pay / Decline)
CHIP_API_URL=http://localhost:4599/api/v1 CHIP_SECRET_KEY=mock-key CHIP_BRAND_ID=mock-brand npm run dev
```

The mock follows the spec's contract: Bearer auth, trailing slashes, required
`client.email`, port-in-callback rejection, signed callbacks. It also has
`POST /__mock/callback` to fire a signed (or tampered) callback at any URL.

## Files

- `backend/src/utils/chip.ts`: API client, signature check, status classifier
- `backend/src/utils/payment-gateway.ts`: `chipGateway`
- `backend/src/modules/payments/`: redirect + `/chip/callback`
- `backend/scripts/test-chip.ts`, `backend/scripts/chip-mock.ts`
