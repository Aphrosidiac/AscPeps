# Group Buy

Time-boxed batches with their own product list and wholesale prices. A batch
runs for the window the team sets; customers order at the batch's tier prices
(picked by **their own** quantity of each product), pay in full at checkout, and
everything ships together once the batch closes and the stock arrives. Every
control lives on the batch, so running the next one is a duplicate and an edit.

## Switch (off on the live site)

Group Buy ships switched off: **pre-orders are live, Group Buy is not**. Both apps
read one flag, off unless set to `true`:

| App | Flag | Off means |
|---|---|---|
| API (`backend/.env`) | `GROUP_BUY_ENABLED` | `/api/v1/group-buys` and `/api/v1/admin/group-buys` are not registered, the notice sweep doesn't run, checkout refuses a `groupBuyId` |
| Web (`frontend/.env`, read at build time) | `NEXT_PUBLIC_GROUP_BUY_ENABLED` | no header button, `/group-buy/*` and `/admin/group-buys` 404, no Admin menu entry, no banner/popup/home section, account screens don't mention Group Buy ("My orders" becomes "Track an order") |

To launch: set both to `true` (and in local dev to work on it), then deploy so the
frontend rebuilds. The tables exist either way (migration `20261031120000_preorder_group_buy`).

## Admin → Sales → Group Buys

| Tab | What it controls |
|---|---|
| Overview | paid revenue, orders, buyers, sign-ups; set-up checklist; **supplier sheet** (vials per size, paid / unpaid, store stock) |
| Setup | title, link, tagline, about (markdown), open/close, ship estimate, minimum order, most units per order, shipping (store / free / flat), WhatsApp orders, **people-joined counter** (off / real / real + n / fixed), hero image |
| Products & prices | sizes in the batch, sold by the **vial** or the **kit** (vials per kit), unit name, minimum / most / minimum spend per product, note, tier table with per-vial price and % under store |
| Promotion | **banner** (text, link text, colour, schedule), **popup** (title, text, image, button, delay, frequency, pages, schedule), **home section** (heading, text, image, button) |
| Sign-up reward | on/off, % or RM, where it works (this batch / store / both), minimum spend, valid days, members only, headline; welcome-email preview |
| Timeline | the customer timeline: steps, current step, notes to buyers, expected dates; moving on stamps the date and emails paid buyers once; resend to anyone who missed it; email log |
| Orders | the batch's orders (each opens the normal order page to pack and ship) |
| Sign-ups | everyone on the list (batch page, popup, home, checkout, added by team), member flag, reward code + used, orders, notes, CSV export |

Publish/Unpublish and Duplicate sit in the header. A draft is previewable by a
signed-in admin at its link.

## Customer side (`/group-buy`, FF Ops portal shell)

`app/group-buy/*` has its own chrome (`PortalShell` + `portal.css`, scoped `.gbp`):
blurred top bar, "/ SECTION" heads, pill buttons, thumb bar on phones, Ascend
palette (Ink, Signal Green = live/confirmed, Cobalt = navigation/selection).

- `/group-buy` — live batch with countdown, upcoming and recent batches, how it works.
- `/group-buy/[slug]` — product rows with tier pills (the reached tier highlighted),
  steppers that respect minimums, "+3 for RM X each" nudges, store-price comparison,
  ink summary with every rule checked, sign-up panel, batch timeline.
- `/group-buy/[slug]/checkout` — guests welcome, nudge to sign in; online payment,
  bank transfer when the store has it on, WhatsApp only when the batch allows.
- `/group-buy/orders` — a signed-in member's orders (matched by **confirmed**
  email, so guest orders with that email appear), each Group Buy order with its
  batch timeline; sign-ups and reward codes.
- `/track` shows the batch timeline for Group Buy orders too.

Storefront: the banner replaces the announcement bar while on; the popup replaces
the newsletter popup while on (never on checkout/cart/account/track/pay); the home
section sits under the hero strip.

## Data

`group_buys`, `group_buy_items`, `group_buy_tiers`, `group_buy_signups`,
`group_buy_notices` (migration `20261031120000_preorder_group_buy`).

- A Group Buy order is an ordinary `Order` with `groupBuyId`; lines are stored **per
  vial** (`quantity`, `unitPrice`) with `packSize` set on kit lines, so costing,
  supplier prices and Ascend Money work unchanged. Every unit is `preorderQty`:
  nothing comes out of store stock. Kit prices must split evenly into their vials
  (the admin refuses otherwise).
- Checkout: `createOrder` with `groupBuyId` → `resolveGroupBuyLines`
  (utils/group-buy.ts) checks window, items, minimums, maximums, order minimum and
  unit cap, and prices from tiers. Shipping = batch fee, or the store's rules.
  The store's 50-unit / 100-per-item caps do not apply; the store's East Malaysia
  minimum does (checkout warns before the API refuses).
- The admin refuses a product nobody could buy: a "most per order" below its
  minimum or first tier, or a minimum over the batch's unit limit (and the limit
  can't be lowered below an item's minimum). An order's kit line can only be
  edited by whole kits.
- The public page moves the phase on by the clock (`useLivePhase`), so a
  countdown reaching zero opens/closes the batch, banner and home section
  without a reload. The timeline step is still set by hand (Admin warns when it
  is past the first step while the batch is open).
- Sign-up reward: one `DiscountCode` per sign-up — single use, `boundEmail`,
  `scope` GROUP_BUY (+ `groupBuyId`) / STORE / null. The code is **emailed**; it is
  shown on screen only to a signed-in member with a confirmed email.
  `validateDiscountCode(..., { groupBuyId, email })` enforces scope and owner.
- Emails: `group_buy_notices` (SIGNUP, STAGE) drained with the order outbox every
  30 s; `dedupeKey` makes each one once. Order emails carry a boxed "GROUP BUY ·
  BATCH 03" note.
- Joined counter: REAL = sign-ups (every buyer is added as a CHECKOUT sign-up).

## Running a batch

1. New batch (or Duplicate the last one) → Products & prices → Setup → Promotion → Reward.
2. Publish. Banner/popup/home appear within a minute (60 s cache).
3. When it closes: Overview → supplier sheet (paid column) → order from the supplier.
4. Timeline: move to "Ordered from supplier", "On the way", "Arrived", "Packing" —
   buyers are emailed at each step. Ship each order from its order page as usual.
