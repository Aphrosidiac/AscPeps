# Payments

How an order turns into money, and what to check when it does not. The code
is in `backend/src/utils/payment-gateway.ts` (the gateway adapters),
`backend/src/utils/payment-reconcile.ts` (the PAID/FAILED transitions and the
sweep), `backend/src/modules/payments/` (callback and return routes) and
`createOrder` in `backend/src/modules/orders/orders.controller.ts`.

## The methods

| Checkout choice | Stored as | Settled by | Released if unpaid after |
|---|---|---|---|
| Online payment | `BILLPLZ` (legacy enum name for "a fiat gateway") | whichever gateway the `payment_gateway` setting names — **Billplz since 2026-10-19**, ToyyibPay before | 2 h |
| Bitcoin | `CRYPTO` | BTCPay, always (the setting does not apply) | 24 h |
| WhatsApp | `WHATSAPP` | a person marks it paid | 48 h (cancelled) |
| Bank transfer page | `WHATSAPP` + gateway `manualpaygate` | a person reviews the uploaded proof | when its session expires |

`payment_gateway` is a dropdown in Admin → Settings. Switching it only
changes which gateway *new* orders use; an order keeps the gateway it was
billed on (`Order.paymentGateway`).

## Billplz

### Keys

Four values in `backend/.env`:

| Variable | Where it comes from |
|---|---|
| `BILLPLZ_API_KEY` | Billplz → Settings → Keys & Integration → API Secret Key |
| `BILLPLZ_SIGNATURE_KEY` | same page → XSignature Key. **Tick "Enable XSignature Payment Completion"** or callbacks and returns cannot be verified and no order is ever marked paid |
| `BILLPLZ_COLLECTION_ID` | Billing → the collection the bills go into (live: the "ASCEND" collection) |
| `BILLPLZ_SANDBOX` | `false` for real money. Sandbox (`billplz-sandbox.com`) and live (`billplz.com`) are separate accounts with separate keys |

To tell which environment a key belongs to, `GET /api/v3/collections` with it
against both hosts — the wrong one answers "Access denied".

On a real domain (any `FRONTEND_URL` that is not `http://localhost…`) a gateway
still in sandbox mode is **refused**, not used: it would take no money while
reporting success. Checkout then answers "Online payment is temporarily
unavailable".

### The page customers see

The bill page is Billplz's. It shows the account's registered business name
(currently FF DEV STUDIO) and whichever payment methods are enabled on the
Billplz account — at the time of writing, Online Banking (FPX) only. Adding
DuitNow QR, cards or e-wallets is done with Billplz, not in this codebase.

### What the API does and does not have

From Billplz's docs (support.billplz.com/api) and live calls:

- Bills: `POST /v3/bills` (amount in sen, `email` or a `60…` mobile, `callback_url`,
  `redirect_url`, `reference_1`), `GET /v3/bills/:id`, `DELETE /v3/bills/:id`
  (due bills only — a paid one answers 422).
- **No refund API.** Refunds are made by hand; see below.
- **Status reads are rate-limited**: 100 (or 10, under abuse) GETs per 5 minutes
  per account. Do not poll.
- Callbacks are form-encoded POSTs signed with X-Signature (every field except
  `x_signature`, `key+value`, sorted case-insensitively, joined by `|`,
  HMAC-SHA256). Return-URL parameters are signed the same way with a
  `billplz` prefix on each key. A callback must be answered with a 200 within
  20 s; failures are retried 4 more times over a day and lower the account's
  webhook rank (`GET /api/v4/webhook_rank`, 0 is healthy).

## An online order, end to end

1. **The gateway is resolved before anything is written.** No usable gateway
   (unconfigured, or sandbox on a real domain) is a 503 with no order, no
   stock held and no email.
2. **The order transaction** prices every line on the server, reserves stock,
   reserves a discount use, and queues the confirmation email — all or
   nothing. Included add-ons (syringes, swabs…) are built here; see
   [add-ons.md](add-ons.md).
3. **The bill is opened** (`openBill`) and its id stored as `Order.paymentRef`.
   If the gateway call fails, the order stays UNPAID with no bill and the
   customer sees "We could not open the payment page". Checkout keeps its
   idempotency key, so pressing Place Order again comes back to the same order
   and opens its bill, or hands back the bill it already has.
4. The customer pays on the gateway page.
5. **Confirmation** — any of these, whichever lands first; the
   `UNPAID → PAID` change is one guarded `updateMany` in `applyPaid`, so a
   second one does nothing:
   - the gateway's signed **callback** (`POST /api/v1/payments/callback`);
   - the customer's **return** (`GET /api/v1/payments/redirect`), signature
     checked and the bill re-read server-side;
   - the **sweep** (every 2 minutes). For Billplz it reads a bill once, just
     before the order would be released, because callbacks are reliable and
     reads are rate-limited. For ToyyibPay — whose callback has never reached
     this origin — it re-reads every unpaid bill older than 3 minutes.
6. **On PAID**: receipt email, gateway fee stamped (`gateway-fee.ts`: RM1 flat
   for Billplz and ToyyibPay unless set in Settings), purchase event, the
   operators' "paid" notice.

The storefront never shows "Order Received" for an online order that came
back without a payment link.

### Unpaid orders

After 2 hours an unpaid online order is marked FAILED and CANCELLED, its stock
and discount use are put back, and its bill is closed — Billplz bills are
deleted, ToyyibPay bills deactivated — so it cannot be paid for stock that is
no longer held. Billplz's own caveat: someone already on the bank page can
still finish paying a deleted bill. If money arrives for an order already
released, the API logs **`LATE PAYMENT`** with the order number; that needs a
person to reinstate the order or refund it.

An optional abandoned-checkout email (`abandoned_checkout_enabled`) reminds
customers of an unpaid order once.

### Refunds

Neither Billplz nor ToyyibPay has a refund API. Marking an order REFUNDED in
admin (or through the assistant) records the refund — revenue reversed by the
exact amount, stock and discount restored — and logs a reminder; the money
itself is returned by hand from the gateway dashboard or by bank transfer.

## The payment trail

Every online order keeps a record of what happened to its payment, so a
failure can be explained instead of guessed at. Code:
`backend/src/utils/payment-trail.ts`; tables `payment_events` and
`payment_attempts`.

- **Attempts** — every try at paying, exactly as the gateway lists it, raw row
  included. Billplz (`GET /v3/bills/:id/transactions`) gives an attempt an id,
  a status (completed / failed / pending), a channel (FPX, TOUCHNGO…) and,
  only if it succeeded, a time. It never says which bank was chosen or why an
  attempt failed — "failed" covers a bank refusal and a customer cancelling on
  the bank page alike. ToyyibPay's rows carry an invoice no. and a time on
  every row, and a channel-less row each time its bill page is shown.
- **Events** — in order: `ORDER_PLACED` (device, browser, in-app app, country),
  `BILL_CREATED` / `BILL_FAILED` (Billplz's whole answer), `PAGE_OPENED`,
  `RETURNED` (every parameter the gateway sent back), `CALLBACK` (every field,
  signature valid or not), `GATEWAY_CHECK` (what we asked and what it said),
  `PAID` (and how), `RELEASED` (reason, whether the bill was closed),
  `LATE_PAYMENT`.
- **The pay link.** Checkout, emails and the "try again" button send customers
  to `/api/v1/payments/go/:billId?src=…`, which records `PAGE_OPENED` and
  redirects to the gateway's page. It is the only way to tell a customer who
  never opened the payment page (`NEVER_OPENED`) from one who opened it and
  picked nothing (`NO_ATTEMPT`).
- **When the gateway is asked**: on every return from the gateway (a failed
  return is the only moment a Billplz failure is seen as it happens — Billplz
  sends no callback for one), after a paid callback, once before release, and
  from **Check with Billplz** on the order page.

Where it shows: the **Payment trail** panel on an order's Info tab (facts,
attempts, timeline, raw data per row; Mark as test), and **Admin → Payments**
(funnel, reasons, attempts by channel, devices, every failed order and whether
the same phone bought within 7 days). Test orders are left out unless asked for.

**Turn on "Extra Payment Completion Information"** in Billplz (Settings → Keys
& Integration) and a returning customer's failed attempt arrives with its
transaction id and status. Signatures keep verifying: every `billplz[...]`
parameter is signed.

History: `npx tsx scripts/backfill-payment-trail.ts --apply` reads every
Billplz and ToyyibPay bill on record and fills in attempts and missing
failure reasons (never overwriting one). Device, page visits, returns and
callbacks exist only for orders placed after the trail went live.

## Testing on live

The **Payment Test** product (`/products/payment-test`, SKU `PAYTEST`, RM1) has
"No shipping charge" on, so a cart holding only it totals RM1.00. Buy it with
online payment, then check: the bill opens on `billplz.com` for RM1.00, you
return to the success page, and the order shows PAID in admin within a minute.
**Switch the product off when you are done** — it is visible in the shop while
active. ASC2610/0039 (2026-10-19) was the first live Billplz payment, confirmed
by the signed callback.

## When payment breaks

| Symptom | Look at |
|---|---|
| "Online payment is temporarily unavailable" | API log `No active payment gateway`. Keys missing, `BILLPLZ_SANDBOX=true` on live, or the running process has old values (next row) |
| Changed `.env` but nothing changed | `config/env.ts` loads `.env` with `override: true`, so `.env` wins over the environment pm2 saved at first start. If it still misbehaves, compare `pm2 env <id>` with `.env`. Prove a change on the **running** process, not with a fresh `tsx` script: `POST /api/v1/orders` with a made-up variantId answers 400 "products not found" once the gateway resolves, 503 when it does not — and writes nothing |
| Paid on the gateway, order still UNPAID | API log for `Payment callback: invalid signature` (wrong `BILLPLZ_SIGNATURE_KEY`, or X-Signature not enabled) and for `/api/v1/payments/callback` reaching the API at all |
| `Could not create payment bill` | the logged Billplz status and body: 401 = wrong key or wrong environment, 422 = a field Billplz refused |
| `LATE PAYMENT` | money arrived for a released order — reinstate or refund it by hand |
| Why did this one fail? | The order's Payment trail panel. Press **Check with Billplz** to read the bill again |
