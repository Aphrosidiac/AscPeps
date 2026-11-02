# Ascend Affiliate

People share their own code. Whoever uses it gets a discount at the store;
the affiliate earns a commission once the order is paid, and asks for a
payout to their bank. Built 2026-11-03 from Fakhrul's note:

| Note | Built as |
|---|---|
| Margin to give up: 10% | `affiliate_margin_budget_pct` = 10. Discount + commission may never go over it — refused for the default rate, for any affiliate's rate, and for the settings themselves |
| Commission 3–5% | `affiliate_default_rate_bps` = 500 (5%) for new affiliates; each affiliate can have their own (Admin or Abby) |
| Discount for the code: 5% | `affiliate_customer_discount_pct` = 5, on every affiliate code at once |
| Possible one-time sign-up bonus: 10% | `signup_bonus_enabled` (off by default) + `signup_bonus_pct` = 10 |
| Popups: sign-up, affiliate | Two store popups that take turns with the newsletter one, one per visit |
| Payout: 3 days minimum after asking, to let refunds land; if a refund still comes, the account goes negative | `affiliate_payout_hold_days` = 3; balances are a ledger and may go below zero |
| Simple UI, ASC's complete style | `app/affiliate`, the ASC staff UI ("Dashboard V15") taken whole |
| affiliate.ascendpeptides.my | `src/proxy.ts` serves `app/affiliate` on that host |

Everything is off until **Admin → Marketing → Affiliates → Settings →
Programme open** is switched on.

---

## Who is an affiliate

A store account (`members`) that applied. One `affiliates` row each:

| Status | Meaning | Their code |
|---|---|---|
| `APPLIED` | waiting for the team | reserved, does nothing; they may still change it |
| `ACTIVE` | approved | works at checkout |
| `PAUSED` | stopped by the team | does nothing; balance kept, payouts wait (Mark paid is refused until they are active again, or the request is cancelled) |
| `REJECTED` | not approved | never goes live |

Joining needs a **confirmed email** (a payout goes to a real person), a
Malaysian mobile number and a code (4–16 letters/numbers, suggested from the
name). The code is an ordinary `discount_codes` row — `PERCENTAGE`, the
customer discount, `scope = STORE` (Group Buy prices are already cut) — kept
`isActive` exactly while the affiliate is `ACTIVE`. A live code can only be
changed by the team, from Affiliates: every link and post already shared uses
it. The Discounts page refuses to edit or delete an affiliate's code. Moving
anyone to `ACTIVE` re-checks their rate against today's margin budget.

## The money

All in `backend/src/utils/affiliate.ts`.

**At checkout** (`validateDiscountCode` → `checkAffiliateCode`) an
affiliate's code is refused when the programme is off, the affiliate is not
active, or the buyer is the affiliate — same inbox **or** same phone. The
inbox ignores case, `+tags` and Gmail's dots (`a.mir+x@gmail.com` is
`amir@gmail.com`); the phone ignores `+60`, a leading 0, spaces and dashes.
Someone with a second inbox and a second SIM still gets through; that is the
limit of what checkout can know. The
order is stamped with `affiliateId` and `affiliateRateBps` (the rate *then*:
a later rate change never moves an order already placed). One code per
order, so the sign-up bonus and an affiliate code never stack.

**What an order earns** is a pure function, `commissionTarget(order)`:

```
goods      = total − shipping            (the goods after every discount)
kept share = (total − refundedAmount) / total
commission = round(goods × kept share × rate)
```

Zero until the order is `PAID`; zero if it is cancelled, deleted or marked
as a test. A refund of a tenth of the order takes back a tenth of the
commission.

**Booking it.** `orders.affiliateCommission` holds what has been booked.
`syncAffiliateOrders` compares it with the target and writes the difference
to `affiliate_entries` — `COMMISSION` up, `REVERSAL` down, with the reason
("Order paid", "Order refunded", "Marked as a test order"…). It moves an order
only from the exact amount it read, so two sweeps never book twice. It runs:

- at the PAID transition (`applyPaid`, and the admin order wrappers in
  `admin-orders.controller.ts`: update, discount, items, delete, restore,
  test-mark — which Abby's order tools go through too);
- as a sweep before every money read (dashboard, Ascend Money, the finance
  input, month-end, share-outs, the affiliate's own pages).

So nothing has to remember to "take the commission back": whatever path
refunds, cancels or deletes an order, the next read books the reversal.

**A cost of the order.** `costOrder` (`utils/profit.ts`) counts
`affiliateCommission` beside the gateway fee, so profit, the partners' split,
the month-end wrap and Ascend Money are all after paying the affiliate. The
order page's Profit tab shows the line.

**The balance** is never stored: the sum of the affiliate's entries.
A payout is a negative entry. A refund after a payout leaves the sum below
zero; new commission pays it back first. The team can add an `ADJUSTMENT`
(either sign, with a reason).

## Payouts

1. The affiliate presses **Ask for a payout** — everything available
   (balance less any open request). Needs bank details. One open request at
   a time. `availableAt = now + hold days`. The team gets a WhatsApp notice
   (the same people and switch as the order notices).
2. Until `availableAt` it is **in hold** — refunds land first.
3. The team transfers from Ascend's bank, then **Mark paid** (Admin →
   Affiliates → Payouts, the affiliate's page, or Abby's
   `mark_affiliate_payout_paid`). It pays the **smaller of the ask and the
   balance now**; if refunds took the balance to nothing, the request is
   cancelled instead. A reference is optional and shown to the affiliate.
   The admin sends the amount it showed; if a refund moved it since the page
   loaded, Mark paid is refused with the new figure, so nobody records a
   different sum than the one transferred.
4. A paid payout is money out of Ascend's bank: `utils/bank.ts` reads it from
   `affiliate_payouts` as an `AFFILIATE` movement (Ascend Money → Bank →
   Affiliates), the way it reads profit payouts — never copied.

There is no payout API: the transfer is made by hand, like profit share-outs.

## The affiliate site

`frontend/src/app/affiliate`, served at **affiliate.ascendpeptides.my**
(`src/proxy.ts` rewrites `/x` to `/affiliate/x` on that host and sends
`/affiliate/x` back to the short form) and at `/affiliate` on the store host.
Locally: `http://affiliate.localhost:3399`.

| Page | What it shows |
|---|---|
| Signed out | the offer and how it works; sign in or create the store account |
| Join | name, WhatsApp, code (live availability check), where they share, the rules |
| Waiting | their reserved code, changeable until approved |
| Overview | balance and **Ask for a payout**; earned / waiting for payment / paid; their code and share link (copy buttons); latest orders |
| Products | every size the code works on (the store's own list and sale prices): price, what the customer pays with the code, what one sale earns and what N sales earn (1, 5, 10, 25, 50 or any number), and a copy link to each product's page with the code |
| Orders | order number, date, status, goods, commission — **never who bought** |
| Payouts | ready to pay out, their payouts, every change to the balance |
| Settings | bank details, name, WhatsApp, where they share — locked; **Edit** a section and saving sends a change request (below) |

The look is the ASC staff UI taken whole (`ASC/docs/staff-ui.md`): lavender
canvas, white 28px panels, ink pills with a travelling tab pill, pastel cards,
Outfit, a sun/moon switch (saved per browser, set before paint). Tokens live
in `affiliate.css` under `.aff`; the store never sees them. Motion is feedback
only.

On the subdomain the store's header, footer and popups must not appear, but
the pathname there reads `/` — so `SiteChrome` drops them after hydration by
hostname, keeping `<main>` in place, and the portal's layout hides them with
CSS for the first paint.

Any other path on the subdomain (`/checkout`, `/products/…`) shows "That
page is on the store" with a link to it there (`app/affiliate/[...rest]`).

Members sign in separately on the subdomain (the session is per-origin
localStorage, like the store's).

## Changing their details

Fakhrul, 2026-11-03: an affiliate can't just change their bank account, name,
WhatsApp or where they share. Settings shows them greyed out; **Edit** opens
one section, and saving is **Request change** (`modules/affiliates/affiliate-changes.ts`).

- Nothing moves until the team approves. Even the first bank details go
  through it, so a payout never goes to an account the team hasn't seen.
- One request at a time (`affiliate_change_requests`, status `PENDING`).
  Editing again starts from what is already asked for, and sending replaces
  the waiting request in place, so the team only ever sees the latest one.
  Sending the approved details back unchanged withdraws it; so does
  **Withdraw it**.
- The request keeps only the fields that differ, with what they were
  (`changes`, `previous`), and the team gets a WhatsApp notice (account
  numbers as ····1234).
- **Admin → Affiliates → Changes** (and a card on the affiliate's page):
  before → after per field with full account numbers; **Approve** applies it
  and moves a payout still waiting to the new account; **Reject** needs a
  reason, which the affiliate sees on Settings until they send another.
- Bank details can be changed, never removed, and come as all three (bank,
  account holder, number) or none. The code is not part of this: a live code
  only changes through the team.
- The team can still edit an affiliate directly on their admin page.

## The store

- **Share link** `ascendpeptides.my/?ref=CODE`: `RefCapture` (in
  `SiteChrome`) keeps the code 30 days; checkout offers it — "Code AMIR5
  from your link. Apply it" — and never applies it unasked.
- **Popups** (`components/popups`): sign-up bonus ("10% off your first
  order", hidden for signed-in members) and affiliate invitation. With the
  newsletter they take turns, one per visit (`popup-turn.ts`); a live Group
  Buy popup outranks all. Same manners as the newsletter popup: never on
  checkout/cart/account, exit-intent on desktop after a few seconds, a set
  time or scroll point on a phone, a dismissal holds a set number of days.
- **Admin → Marketing → Popups** sets all three popups (newsletter, sign-up,
  affiliate): on/off, the desktop wait, the phone delay and scroll point, the
  days a closed one stays hidden, and the sign-up and affiliate wording
  (`{discount}`, `{commission}`, `{bonus}` fill in the live numbers), plus the
  affiliate earnings card. Plain store settings `popup_<kind>_<field>`
  (`frontend/src/lib/popup-settings.ts` holds the defaults, which are the
  old fixed behaviour; the API bounds the timings). The programme and bonus
  switches still decide first.
- **Sign-up bonus**: minted when the account's email is **confirmed** (a
  made-up address never gets one), once per inbox (an alias of an address
  that already had one gets none), single use, bound to that email, shown on
  the account card until used.
- Saving the programme settings revalidates the store, so the popups follow
  at once.

## Admin

**Marketing → Affiliates** — tabs:

- **Affiliates**: filter by status, search, approve in one click; sales,
  earned, balance, payout asked.
- **Payouts**: waiting (in hold / ready to pay, bank details to copy, what it
  pays now), paid, cancelled; Mark paid, Cancel (with a reason they see).
- **Settings**: programme on/off, customer discount, default commission,
  margin budget, payout hold, sign-up bonus.

**One affiliate** (`/admin/affiliates/[id]`): approve / pause / reject,
commission rate and team note, balance tiles, orders with their commission
(linked to the order), the ledger with **Adjust**, payouts.

## Abby

The `affiliates` domain (keywords affiliate, commission, komisen, referral,
ejen…), with its own playbook:

| Tool | |
|---|---|
| `list_affiliates` | everyone, with status, code, rate, sales, earned, balance, payout asked |
| `get_affiliate` | one in full; counts as evidence for the costing precondition |
| `affiliate_payouts` | the queue or history, with bank details and what it pays now |
| `set_affiliate` | approve / pause / reject / reactivate, change rate — needs a yes |
| `mark_affiliate_payout_paid` | after the transfer — needs a yes |

## API

Affiliate (`/api/v1/affiliate`, member token): `GET /programme` (public),
`GET /me`, `GET /code?code=` or `?name=`, `POST /join`, `PATCH /me` (the code,
while waiting for approval), `POST|DELETE /me/change`, `GET /products/order`,
`GET /orders`, `GET /entries`, `GET /payouts`, `POST /payouts`.

Admin (`/api/v1/admin/affiliates`): `GET /`, `GET /:id`, `PATCH /:id`,
`POST /:id/adjust`, `GET /payouts?status=`, `POST /payouts/:id/paid`,
`POST /payouts/:id/cancel`, `GET /changes?status=`, `POST /changes/:id`
(`{decision: approve}` or `{decision: reject, reason}`), `GET|PUT /settings`.

## Tests

```bash
cd backend
npm run test:affiliate        # 43 checks: the sum, budget, checkout, paid, hold, payout,
                              # refund after payout (negative), test-mark, paused payouts, stale Mark paid,
                              # aliases, sign-up bonus, Abby's write tools
npx tsx scripts/seed-affiliate-demo.ts   # LOCAL demo: AMIR5 (active, 4 orders) + SITI5 (to approve)
```

## Deploying it (when Fakhrul says)

1. `prisma migrate deploy` — `20261102120000_ascend_affiliate` and
   `20261103120000_affiliate_change_requests` are additive (new tables, three
   nullable/defaulted order columns, one member column).
2. Backend: tsup build, restart `ascend-api` (check no agent thread is
   running first).
3. DNS: `affiliate` A record → ascend-vps, proxied (Rikaidrawings Cloudflare
   account, zone ascendpeptides.my).
4. nginx: a server block for `affiliate.ascendpeptides.my` that is a copy of
   the store's — **including** the `/api/` and `/uploads/` locations (the
   frontend calls the API on its own origin in production) and the CSP. TLS
   the same way as the store (Cloudflare Full strict).
5. Frontend: `./deploy-frontend.sh`. A production build links the store's
   popup and the admin to `https://affiliate.ascendpeptides.my` by itself
   (`lib/affiliate-url.ts`; `NEXT_PUBLIC_AFFILIATE_URL` overrides).
6. Switch **Programme open** on (and the sign-up bonus if wanted).
