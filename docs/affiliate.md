# Ascend Affiliate

People share their own code. Whoever uses it gets a discount at the store;
the affiliate earns a commission once the order is paid, and asks for a
payout to their bank. It has its own site, **affiliate.ascendpeptides.my**,
signed in with the same account as the store.

Branch `feat/ascend-affiliate`, built 2026-11-02 → 03. **Not deployed**:
[Deploying it](#deploying-it-when-fakhrul-says) is the list, and nothing
runs until **Programme open** is switched on.

**Contents** — [Why](#why-and-what-it-has-to-do) ·
[At a glance](#at-a-glance) · [Settings](#settings-every-switch-and-number) ·
[Affiliates and codes](#who-is-an-affiliate) · [The money](#the-money) ·
[Payouts](#payouts) · [Changing details](#changing-their-details) ·
[The affiliate site](#the-affiliate-site) · [Emails and notices](#emails-and-notices) ·
[Promoting it on the store](#promoting-it-on-the-store) ·
[Sign-up bonus](#sign-up-bonus) · [Admin](#admin) · [Abby](#abby) ·
[API](#api) · [Data](#data) · [Where the code is](#where-the-code-is) ·
[Tests and demo](#tests-and-the-local-demo) ·
[Decisions](#decisions-and-why) · [Deploying](#deploying-it-when-fakhrul-says)

---

## Why, and what it has to do

Customers who like Ascend are the cheapest way to find more customers. The
programme gives them a reason to say so: their friends get a discount, they
earn a share of every paid order, and Ascend gives up a fixed, known slice of
margin for each sale it would otherwise not have made.

Fakhrul's brief, and how each line was built:

| The brief | Built as |
|---|---|
| Margin to give up: 10% | `affiliate_margin_budget_pct` = 10. Discount + commission may never go over it — refused for the default rate, for any affiliate's own rate, and for the settings themselves |
| Commission 3–5% | `affiliate_default_rate_bps` = 500 (5%) for new affiliates; each affiliate can have their own (Admin or Abby) |
| Discount for the code: 5% | `affiliate_customer_discount_pct` = 5, on every affiliate code at once |
| Possible one-time sign-up bonus: 10% | `signup_bonus_enabled` (off by default) + `signup_bonus_pct` = 10 |
| Popups: sign-up, affiliate | Two store popups that take turns with the newsletter one, one per visit |
| Payout: 3 days minimum after asking, so refunds land; a refund after that makes the account negative | `affiliate_payout_hold_days` = 3; balances are a ledger and may go below zero |
| Its own simple site | `frontend/src/app/affiliate`, served at affiliate.ascendpeptides.my |

What it must never do: pay out money that a refund took back, let an
affiliate earn on their own orders, move a payout to a bank account the team
hasn't seen, or show an affiliate who their customers are.

## At a glance

```
 CUSTOMER                         AFFILIATE                          THE TEAM
 ────────                         ─────────                          ────────
                                  signs up on the affiliate site
                                  (store account, email confirmed)
                                  joins: name, WhatsApp, code, bank ─► WhatsApp notice
                                  ◄── "application received" email     Admin → Affiliates
                                                                        Approve ──► code goes live
                                  ◄── "you're approved" email
                                  shares code / ?ref= link
 opens the link (code kept
 30 days), checkout offers it
 5% off, order placed ──────────► order stamped with the affiliate
 pays ──────────────────────────► COMMISSION booked (5% of the goods)
 (refund? ──────────────────────► REVERSAL booked, may go negative)
                                  Ask for a payout ──────────────────► WhatsApp notice
                                  ◄── "payout requested" email          3-day hold, then
                                                                        transfer + Mark paid
                                  ◄── "paid" email
```

## Settings: every switch and number

All plain `settings` rows, edited in **Admin → Marketing → Affiliates →
Settings** (programme) and **Admin → Marketing → Popups** (popups). Saving
revalidates the store, so every placement follows at once.

| Key | Default | Meaning |
|---|---|---|
| `affiliate_enabled` | off | The master switch. Off: codes stop working at checkout, and every popup, band, card, footer link and receipt line disappears |
| `affiliate_customer_discount_pct` | 5 | What every affiliate code takes off, in whole percent |
| `affiliate_default_rate_bps` | 500 | Commission for new affiliates, in basis points (500 = 5%) |
| `affiliate_margin_budget_pct` | 10 | Discount + any affiliate's rate must fit inside it |
| `affiliate_payout_hold_days` | 3 | Days between asking and being payable |
| `signup_bonus_enabled` / `signup_bonus_pct` | off / 10 | The one-time first-order code for a new confirmed account |
| `popup_<kind>_desktop_delay` · `_mobile_delay` · `_mobile_scroll` · `_hide_days` | the old fixed behaviour | When each popup (`newsletter`, `signup`, `affiliate`) may open; the API bounds them (`utils/popup-settings.ts`) |
| `popup_<kind>_enabled` · `_heading` · `_body` · `_cta` · `_note` | defaults in `frontend/src/lib/popup-settings.ts` | The sign-up and affiliate popups' switch and words; `{discount}`, `{commission}`, `{bonus}` fill in the live numbers |
| `popup_affiliate_card` | on | The earnings graphic inside the affiliate popup |

Env: `AFFILIATE_URL` (backend, optional — links in emails; defaults to the
subdomain, or `FRONTEND_URL/affiliate` locally) and `NEXT_PUBLIC_AFFILIATE_URL`
(frontend, optional — links from the store; defaults to the subdomain in a
production build, `/affiliate` in development).

## Who is an affiliate

A store account (`members`) that applied. One `affiliates` row each:

| Status | Meaning | Their code |
|---|---|---|
| `APPLIED` | waiting for the team | reserved, does nothing; they may still change it |
| `ACTIVE` | approved | works at checkout |
| `PAUSED` | stopped by the team | does nothing; balance kept, payouts wait (Mark paid is refused until they are active again, or the request is cancelled) |
| `REJECTED` | not approved | never goes live |

**Joining** needs a **confirmed email** (a payout goes to a real person), a
Malaysian mobile number and a code. Bank details given while joining go in
with the application (all three or none), so the team approves them with it
— the Approve dialog shows them. Skipped, they're added later in Settings as
a change request.

**The code** is 4–16 letters or numbers. The one suggested is their
**initials and four random digits** — Amir Hakim → AH4827 — so nobody's name
is on every post, while still being easy to type; they can type their own
instead. It is an ordinary `discount_codes` row — `PERCENTAGE`, the customer
discount, `scope = STORE` (Group Buy prices are already cut to the bone) —
kept `isActive` exactly while the affiliate is `ACTIVE`. A live code can only
be changed by the team, from Affiliates: every link and post already shared
uses it. The Discounts page refuses to edit or delete an affiliate's code.
Moving anyone to `ACTIVE` re-checks their rate against today's margin budget.

## The money

All in `backend/src/utils/affiliate.ts`.

**At checkout** (`validateDiscountCode` → `checkAffiliateCode`) an
affiliate's code is refused when the programme is off, the affiliate is not
active, or the buyer is the affiliate — same inbox **or** same phone. The
inbox ignores case, `+tags` and Gmail's dots (`a.mir+x@gmail.com` is
`amir@gmail.com`); the phone ignores `+60`, a leading 0, spaces and dashes.
Someone with a second inbox and a second SIM still gets through; that is the
limit of what checkout can know. The order is stamped with `affiliateId` and
`affiliateRateBps` (the rate *then*: a later rate change never moves an order
already placed). One code per order, so the sign-up bonus and an affiliate
code never stack.

**What an order earns** is a pure function, `commissionTarget(order)`:

```
goods      = total − shipping            (the goods after every discount)
kept share = (total − refundedAmount) / total
commission = round(goods × kept share × rate)
```

Zero until the order is `PAID`; zero if it is cancelled, deleted or marked
as a test. A refund of a tenth of the order takes back a tenth of the
commission. Worked example: RM 200 of goods, 5% off → the customer pays
RM 190 for the goods → the affiliate earns 5% of RM 190 = RM 9.50.

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
order page's Profit tab and Analytics show it.

**The balance** is never stored: the sum of the affiliate's entries.
A payout is a negative entry. A refund after a payout leaves the sum below
zero; new commission pays it back first. The team can add an `ADJUSTMENT`
(either sign, with a reason).

## Payouts

1. The affiliate presses **Ask for a payout** — everything available
   (balance less any open request). Needs bank details. One open request at
   a time. `availableAt = now + hold days`. The team gets a WhatsApp notice;
   the affiliate gets a receipt email.
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
**Cancel** (with a reason the affiliate sees) puts the money back in their
balance.

## Changing their details

Fakhrul, 2026-11-03: an affiliate can't just change their bank account, name,
WhatsApp or where they share — that would let a payout go somewhere nobody
checked. Settings shows them greyed out; **Edit** opens one section, and
saving is **Request change** (`modules/affiliates/affiliate-changes.ts`).

- Nothing moves until the team approves. Even the first bank details go
  through it.
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
  Either way the affiliate gets an email.
- Bank details can be changed, never removed, and come as all three (bank,
  account holder, number) or none. The code is not part of this: a live code
  only changes through the team.
- The team can still edit an affiliate directly on their admin page.

## The affiliate site

`frontend/src/app/affiliate`, served at **affiliate.ascendpeptides.my**
(`src/proxy.ts` rewrites `/x` to `/affiliate/x` on that host and sends
`/affiliate/x` back to the short form) and at `/affiliate` on the store host.
Locally: `http://affiliate.localhost:3399`.

### Pages

| Page | What it shows |
|---|---|
| Signed out | A six-slide showcase beside Sign in / Create account, fitted to one screen on any 16:9 window (below). Three true facts under the form |
| Join (onboarding) | A step-by-step wizard (`Onboarding.tsx`) straight after sign-in: confirm email (only if needed; "I've confirmed it" re-checks) → about you → code (suggested, shuffle, live availability) → payouts (bank, or skip for now) → review + agree to the terms. A dark panel beside it previews what each step makes, live; the reason Continue is off shows beside it |
| Waiting | In the queue: sent → reviewed → live → sharing; their code (changeable until approved), WhatsApp and bank; the Guide is open to read meanwhile |
| First visit after approval | A spotlight tour (`Tour.tsx`) over Overview: balance, code, each tab, the Guide — once per affiliate per browser (`ascend-aff-tour:<id>`); **Take the tour** in the account menu (`/?tour=1`) replays it |
| Overview | Balance and **Ask for a payout**; earned / waiting for payment / paid; their code and share link (copy buttons, with a hint on how to use them); latest orders; **Back to Store** |
| Products | Every size the code works on (the store's own list and sale prices), best sellers first: price, what the customer pays with the code, what one sale earns and what N sales earn (1, 5, 10, 25, 50 or any number), search, and a copy link to each product's page with the code |
| Orders | Order number, date, status, goods, commission — **never who bought** |
| Payouts | Ready to pay out, their payouts, every change to the balance |
| Settings | Bank details, name, WhatsApp, where they share — locked; **Edit** a section and saving sends a change request |
| Guide (`/guide`) | The whole programme in eight sections — How it works, Code & link, Earning, Payouts, Refunds, Your details, Rules, Questions — each linkable (`/guide#payouts`). Numbers are the affiliate's own (code, rate, discount, hold days). Graphics: the journey, an earnings slider, the payout timeline, a refund ledger crossing zero, and replicas of the real screens. **Every rule it states is one the system enforces — change the rule, change the guide** |

Reached from **Guide** on Overview, the account menu and each page's "How …
works". Any other path on the subdomain (`/checkout`, `/products/…`) shows
"That page is on the store" with a link to it there (`[...rest]`).

### The sign-in showcase

`AuthShowcase.tsx`: a dark Ascend panel of six slides — earn on every order
(a rising curve), they save / you earn (a receipt with a real product), every
product earns (real store products), one link does the work (link + checkout
phone), paid straight to your bank (payout + hold timeline), free to join.
Live discount, rate and hold; real prices; the sample code and balance are
pictures of screens, not promises. A blur-dissolve every 5.2 s with staggered
text, progress bars to jump between slides, pause on hover/focus or from a
button, still for reduced motion. `FitBox` scales each slide's graphic down
only as far as the window needs, from 1024 px up; on a phone the slides share
one grid cell and show full size.

### Look

Ascend MY's own brand on the ASC staff UI's shapes. **Colours** are the kit's
(`AscPeps/brand/tokens.css`) or a mix of one: Ink and Paper dominate, a
Mist-tinted grey canvas so the white panels stand off it, Graphite copy,
**Signal Green** for money earned, amber for money still waiting, **Cobalt**
for focus and selection. **Shapes** stay round (28 px panels, pill controls,
a travelling ink tab), the logo is the **pill mark** — both Fakhrul's call.
Outfit for display, Inter for text, whole-pixel sizes (he reads on a 1x
screen). A sun/moon switch (saved per browser as `ascend-aff-theme`, set
before paint). Tokens live in `affiliate.css` under `.aff`; the store never
sees them. Motion is feedback only.

Two traps in that CSS: `.aff` component classes (`btn`, `pill`, `input`,
`tint`, `st-fig`) outrank Tailwind utilities, so `hidden` on one of them does
nothing — wrap it, or use `!hidden`.

### On a phone

Everything on desktop is there: tables become card lists carrying every
column (commission, goods, prices, earnings, balance, Approve/Open) rather
than scrolling sideways; tabs fit at 375 px; tap targets are 32 px and up;
amounts never wrap. The tour centres its card and lights tall targets from
the top so the card never covers them.

### Store chrome on the subdomain

The store's header, footer and popups must not appear there, but the pathname
reads `/` — so `SiteChrome` drops them after hydration by hostname, keeping
`<main>` in place, and the portal's layout hides them with CSS for the first
paint. Members sign in separately on the subdomain (the session is per-origin
localStorage, like the store's).

## Emails and notices

**The team** hears on WhatsApp (`utils/affiliate-notify.ts`: the same people
and switch as the order notices, Routines → Order notice): a new application,
a payout asked for, a change of details asked for. Account numbers masked.

**The affiliate** hears by email, at their account email. Templates are
`backend/src/emails/affiliate.ts`, sent by `utils/affiliate-mail.ts` straight
away (no outbox: there is no order), behind the same switch as every other
mail (`emails_enabled` + a Resend key). While it is off they are only logged
(`Email disabled — affiliate email not sent`). A failed send is logged and
never undoes what it reports. The copy promises nothing the programme doesn't
do (no review times, no transfer times).

| When | Email |
|---|---|
| They apply | Application received: code saved; a nudge to add bank details if they skipped them |
| The team sets them Active the first time | Approved: the code, the share link, the dashboard |
| Rejected while still an application | Not approved (no reason given) |
| Active → Paused / Paused → Active | Code paused (balance kept, payout waits) / live again |
| They ask for a payout | Request receipt: amount, bank ····last4, payable from (Malaysian time) |
| Marked paid (admin or Abby) | Paid: amount, bank ····last4, date, reference; says so when refunds made it less than asked |
| Cancelled by the team, or by refunds at Mark paid | Cancelled, with the reason |
| A change of details approved / rejected | Updated (and that payouts go to the new account) / not made, with the reason |

**Customers** see one quiet line under the payment receipt while the
programme is open (`affiliateLine` in `emails/payment-receipt.ts`): "Share
Ascend. Give friends 5% off with your own code and earn 5% of every paid
order they make, paid to your bank. Become an affiliate".

`scripts/preview-emails.ts` renders one of each next to the order mails and
fails on dark-mode blockers.

## Promoting it on the store

Every placement reads one live offer — `affiliateOffer(settings)` in
`frontend/src/lib/affiliate-offer.ts`, shared by `AffiliateOfferProvider` in
the root layout — so they all show the same numbers and all disappear when
the programme is off. Copy says only what the programme does: the code's
discount, the commission, payouts to their bank, free to join.

| Where | What | Code |
|---|---|---|
| **Share link** `ascendpeptides.my/?ref=CODE` | `RefCapture` keeps the code 30 days; checkout and the cart offer it — "Code AH87123 from your link. Apply it" — and never apply it unasked. A refused code is forgotten | `lib/ref-code.ts` |
| **Affiliate popup** | The invitation with the earnings graphic; takes turns with the newsletter and sign-up popups (below) | `components/popups` |
| **Homepage band** | After Featured Products (the page sells first): "Share Ascend. Earn 5% of every order.", the pitch, **Become an affiliate** + **How it works** (the Guide), the earnings graphic | `AffiliateBand` |
| **Order success page** | "Liked your order? Share Ascend." with the graphic — only once a payment is confirmed, not for Group Buy or a bank transfer still being checked | `AffiliateOrderCard` |
| **Account page** | Under their details (store account only): an invitation, or for an existing affiliate their code and **Open Ascend Affiliate** | `AffiliateAccountCard` |
| **Footer** | "Affiliate programme" under Shop | `Footer` |
| **Payment receipt email** | One line under the receipt | `emails/payment-receipt.ts` |

Not on the announcement bar (it carries shipping and trust), the navbar, the
product page or checkout — those are for buying.

The **earnings graphic** (`AffiliateEarnings`) is worked from the live
settings the same way the API books it: what one RM 200 order earns, and what
10 and 50 add up to. It never promises more than the programme pays.

### Store popups

`components/popups`: sign-up bonus ("10% off your first order", hidden for
signed-in members), affiliate invitation, and the newsletter. They take
turns, one per visit (`popup-turn.ts`), passing over one that couldn't show
now; a live Group Buy popup outranks all. Never on checkout, cart, account,
tracking, receipts, payment pages, the affiliate site or Group Buy;
exit-intent on desktop after a set wait, a set time or scroll point on a
phone; a dismissal holds a set number of days. **Admin → Marketing → Popups**
sets all of it (see [Settings](#settings-every-switch-and-number)).

## Sign-up bonus

Minted when the account's email is **confirmed** (a made-up address never
gets one), once per inbox (an alias of an address that already had one gets
none), single use, bound to that email, shown on the account card until
used. Off by default.

## Admin

**Marketing → Affiliates**, tabs:

- **Affiliates**: filter by status, search, approve in one click; sales,
  earned, balance, payout asked.
- **Payouts**: waiting (in hold / ready to pay, bank details to copy, what it
  pays now), paid, cancelled; Mark paid, Cancel (with a reason they see).
- **Changes**: details change requests, before → after; Approve or Reject
  with a reason.
- **Settings**: programme on/off, customer discount, default commission,
  margin budget, payout hold, sign-up bonus.

**One affiliate** (`/admin/affiliates/[id]`): approve / pause / reject,
commission rate and team note, a waiting change request, balance tiles,
orders with their commission (linked to the order), the ledger with
**Adjust**, payouts.

**Marketing → Popups**: the three store popups, as above.

## Abby

The `affiliates` domain (keywords affiliate, commission, komisen, referral,
ejen…), with its own playbook:

| Tool | |
|---|---|
| `list_affiliates` | everyone, with status, code, rate, sales, earned, balance, payout asked |
| `get_affiliate` | one in full; counts as evidence for the costing precondition |
| `affiliate_payouts` | the queue or history, with bank details and what it pays now |
| `set_affiliate` | approve / pause / reject / reactivate, change rate — needs a yes; sends the same emails as the admin |
| `mark_affiliate_payout_paid` | after the transfer — needs a yes; sends the paid email |

## API

Affiliate (`/api/v1/affiliate`, member token): `GET /programme` (public),
`GET /me`, `GET /code?code=` or `?name=`, `POST /join`, `PATCH /me` (the code,
while waiting for approval), `POST|DELETE /me/change`, `GET /products/order`
(sizes ranked by units on paid orders — the order only, never the counts),
`GET /orders`, `GET /entries`, `GET /payouts`, `POST /payouts`.

Admin (`/api/v1/admin/affiliates`): `GET /`, `GET /:id`, `PATCH /:id`,
`POST /:id/adjust`, `GET /payouts?status=`, `POST /payouts/:id/paid`,
`POST /payouts/:id/cancel`, `GET /changes?status=`, `POST /changes/:id`
(`{decision: approve}` or `{decision: reject, reason}`), `GET|PUT /settings`.

## Data

| Table | Holds |
|---|---|
| `affiliates` | one per member: status, rate, their code (`discount_codes`), name, WhatsApp, where they share, bank, team note, approved at/by |
| `affiliate_entries` | the ledger: `COMMISSION`, `REVERSAL`, `PAYOUT`, `ADJUSTMENT`, with the order or payout and a reason; the balance is their sum |
| `affiliate_payouts` | asked amount, paid amount, available at, the bank details as they were, paid at/by, reference, cancel reason |
| `affiliate_change_requests` | `PENDING` / `APPROVED` / `REJECTED` / `WITHDRAWN`, the changed fields and what they were, the decision |
| `orders` | `affiliateId`, `affiliateRateBps` (the rate when placed), `affiliateCommission` (what is booked) |
| `members` | `signupBonusCodeId` |

Migrations `20261102120000_ascend_affiliate` and
`20261103120000_affiliate_change_requests`, both additive.

## Where the code is

| | |
|---|---|
| Money rules | `backend/src/utils/affiliate.ts` |
| Affiliate + admin endpoints | `backend/src/modules/affiliates/` (`affiliates.controller.ts`, `affiliate-changes.ts`, routes) |
| Emails | `backend/src/emails/affiliate.ts`, `utils/affiliate-mail.ts`, `utils/affiliate-url.ts`; receipt line in `emails/payment-receipt.ts` |
| Team notices | `backend/src/utils/affiliate-notify.ts` |
| Popup settings | `backend/src/utils/popup-settings.ts`, `frontend/src/lib/popup-settings.ts` |
| Abby | `backend/src/modules/ai-agent/tools/affiliates.tools.ts` |
| Affiliate site | `frontend/src/app/affiliate/` (`AffShell`, `aff-ui`, `AuthShowcase`, `Onboarding`, `Tour`, `guide/`, `products/`, `banks.ts`, `affiliate.css`) |
| Store placements | `frontend/src/components/affiliate-promo/AffiliatePromo.tsx`, `lib/affiliate-offer.ts`, `components/popups/`, `lib/ref-code.ts` |
| Admin | `frontend/src/app/admin/affiliates/`, `app/admin/popups/` |
| Subdomain routing | `frontend/src/proxy.ts`, `lib/affiliate-url.ts` |

## Tests and the local demo

```bash
cd backend
npm run test:affiliate        # 62 checks, against a LOCAL database only:
                              # the sum, budget, own-code (inbox and phone), checkout, paid,
                              # hold, payout, refund after payout (negative), test-mark,
                              # paused payouts, stale Mark paid, half bank details, code shape,
                              # change requests, sign-up bonus, Abby's write tools, every
                              # affiliate email (rendered, and sent at the right step), the
                              # receipt line on/off, order mails still queued on a code order
npx tsx scripts/seed-affiliate-demo.ts   # LOCAL demo: AH87123 Amir (active, 4 orders),
                                         # SA52904 Siti (to approve), demo-newcomer
                                         # (signed up, not joined: walks the onboarding)
npx tsx scripts/preview-emails.ts        # every email as HTML, affiliate ones included
```

Nothing is sent by the tests: email is off locally (no Resend key), the
order-email check switches it on for a moment with a key that cannot send,
and the outbox worker is not running.

## Decisions, and why

Fakhrul's calls during the build, so nobody undoes them as a "cleanup":

| Decision | Why |
|---|---|
| Ascend kit colours, not ASC's lavender; grey canvas under white panels | It is Ascend's programme; the first pass blended into the page |
| Keep the **pill mark** and the **round** shapes | His call over the Rising lockup and a boxier look |
| Codes are initials + 4 digits | Affiliates don't want their name on every post; still easy to type |
| Details change only by request, one at a time, latest wins | A payout must never go to an account the team hasn't seen |
| Products page sorted best-sellers first | Affiliates should push what already sells |
| Bank details in the join wizard | Fewer approved affiliates stuck unable to get paid |
| Affiliate promos after the products, never on product page or checkout | The store sells first; the programme is for people who already bought |
| Emails promise nothing the system doesn't do | No review times, transfer times or "reply to this email" |

## Deploying it (when Fakhrul says)

1. `prisma migrate deploy` — the two migrations are additive (new tables,
   three nullable/defaulted order columns, one member column).
2. Backend: optionally `AFFILIATE_URL=https://affiliate.ascendpeptides.my`
   in the API's env (already the default off localhost). tsup build, restart
   `ascend-api` (check no agent thread is running first).
3. DNS: `affiliate` A record → ascend-vps, proxied (Rikaidrawings Cloudflare
   account, zone ascendpeptides.my).
4. nginx: a server block for `affiliate.ascendpeptides.my` that is a copy of
   the store's — **including** the `/api/` and `/uploads/` locations (the
   frontend calls the API on its own origin in production) and the CSP. TLS
   the same way as the store (Cloudflare Full strict).
5. Frontend: `./deploy-frontend.sh`. A production build links the store to
   `https://affiliate.ascendpeptides.my` by itself (`lib/affiliate-url.ts`;
   `NEXT_PUBLIC_AFFILIATE_URL` overrides).
6. Turn email on if it isn't (`emails_enabled` + the Resend key), so
   affiliates get their emails.
7. Switch **Programme open** on (and the sign-up bonus if wanted), then check
   the store as a customer: popup, homepage band, footer link, a code at
   checkout.

This branch also changes the store's cart and checkout — see
[cart-and-checkout.md](cart-and-checkout.md); they ship together.
