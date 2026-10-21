# Bookkeeping figures

What each number on `/admin/money` (Ascend Money, formerly Finance) and `/admin/analytics` means, and the four
ways they used to be wrong.

Everything is integer cents. Everything except recorded events (funding,
repayments, payouts) is **recomputed on read** — correcting an old order's costs
corrects every downstream balance for free. See `backend/src/utils/finance.ts`.

---

## The four corrections

### 1. Stock was counted twice

Vials bought ahead of demand were recorded as a company expense **and** charged
again per order through `OrderItem.unitCost` when they sold. RM5,000 of stock
took RM10,000 off net profit.

`CompanyExpense.kind` splits spending in two:

| | |
|---|---|
| `OPERATING` | Consumed on purchase — ads, software, packaging, fees. Reduces net profit today. |
| `INVENTORY` | Bought stock. **Not a cost yet.** Becomes one as COGS, when the goods sell. |

Only `OPERATING` reduces net profit. Every row created before the split defaults
to `OPERATING`, so nothing moved on its own — stock purchases are reclassified by
hand, by clicking the **Kind** chip on *Finance → Expenses*. That reclassify path
is why `PATCH /expenses/:id` exists: delete-and-recreate would destroy the funding
row linked to the expense and, with it, an advance the company still owes someone.

`stockOnHand = inventoryPurchased − cogs`. **Negative is meaningful, not an
error** — it means more stock has sold than this system has ever recorded buying,
because the purchases predate it.

### 2. Gateway fees were recorded nowhere

Every online order's profit was overstated by the processor's cut, and the cash
that actually reached the bank was always less than the reported total — quietly,
and by a bigger proportion the smaller the order.

`Order.gatewayFee` is stamped **on the order** at the PAID transition, not derived
at read time. A published rate is a schedule, not a promise: it changes, it varies
by channel, and a settlement can differ from either. What an order actually cost
to collect is a fact about that order and must not move when a rate is edited
months later — the same reasoning that puts `unitCost` on `OrderItem` rather than
on `ProductVariant`.

Rules live in `backend/src/utils/gateway-fee.ts` as `flat + bps`, so both shapes
are expressible. Defaults: ToyyibPay and Billplz RM1.00 flat, BTCPay zero (self-
hosted, no processor). Billplz is the live gateway (it is what checkout uses when
the `payment_gateway` setting names none), so its rule is the one that stamps
today's orders. Orders with no gateway — WhatsApp, manual transfer — never reach
the table and stay at zero, which is a real figure, not "unknown".

Override per gateway with the settings keys `gateway_fee_<gateway>_flat` (cents)
and `gateway_fee_<gateway>_bps`. The Settings page has no field for them; they
are plain rows in the settings table, written through the settings API. A blank
or malformed value falls back to the default rather than to zero: silently
charging nothing because someone typed "RM1" into a cents field is exactly the
quiet wrong number this exists to remove.

The stamp is made on the gateway path (`applyPaid`) and also when an admin marks
an order Paid by hand. The figure is then editable per order — the **Gateway Fee**
card on the order's *Profit Sharing* tab ("correct it here if the settlement
differed"), saved with the costs.

**Historical orders carry zero.** The stamp only happens at a PAID transition, so
every order confirmed before this shipped has no fee recorded and its profit still
reads high. See [Backfill](#backfill).

### 3. A refund deleted the order instead of reversing it

Reporting filtered to `paymentStatus: PAID`, so marking an order REFUNDED did not
just remove the sale — it removed the courier, the packaging and the gateway fee
already paid on it. **A refund made the books look better than reality.** Partial
refunds could not be expressed at all.

`Order.refundedAmount` reverses revenue by an exact figure. Both PAID and REFUNDED
orders are counted, and:

```
revenue    = total − refundedAmount
itemCost   = 0 when (refundedAmount > 0 AND stockRestored)   ← goods came back
extraCost  = unchanged   ← courier and packaging are never recovered
gatewayFee = unchanged   ← the processor does not refund its cut
```

The goods reversal is gated on a refund having happened, **not** on
`stockRestored` alone: that flag is also set when a still-paid order is cancelled,
and zeroing the goods cost against full revenue would invent profit out of
nothing. It is all-or-nothing because `restoreOrderInventory` is all-or-nothing.

A fully refunded order is therefore a real loss of exactly the courier and the
fee — which is the truth, and used to be reported as nothing at all.

**Refunds are recorded here, never sent.** Neither Billplz nor ToyyibPay has a
refund API (the Billplz call the system once made does not exist and failed,
which blocked marking an order refunded at all). Moving an order to REFUNDED
restores its stock and discount usage and records `refundedAmount`; the money
itself goes back by hand, from the gateway dashboard or a bank transfer. The
amount is asked for on the order page (prefilled with the full total, less for a
partial refund) and cannot exceed the total; a REFUNDED move with no amount
means the whole total. Moving the order off REFUNDED clears `refundedAmount`.

The payment lock was narrowed to permit **PAID → REFUNDED and nothing else**.
Blocking every transition left online orders — nearly all of them — with no way to
record a refund, so reporting had nothing to reverse and kept counting the sale.
Unpaid and Failed stay blocked, because those restock goods that were paid for.

### 4. Revenue waited for costing

Revenue and profit moved together, so an order whose lines nobody had priced yet
contributed **nothing** — takings read low purely because of unfinished data
entry.

Now revenue is counted whenever the money arrived; only profit waits for costing:

- `revenue` — every order the money arrived on, net of refunds
- `costedRevenue` — the part whose costs are known
- `uncostedRevenue` — the rest. Real money in, profit unknowable until priced

An order counts as costed when every line has a `unitCost` **or is free**
(`unitPrice` 0). A free line — the syringe or swab that came included with a
vial — costs nothing to the customer and does not hold the order's profit
hostage; one the customer paid for still needs its cost. (`costOrder` in
`backend/src/utils/profit.ts`, mirrored by `profitSummary` on the order page.)

---

## How the figures relate

```
grossOrderProfit = costedRevenue − cogs − extraCosts − gatewayFees
netProfit        = grossOrderProfit − operatingSpend
stockOnHand      = inventoryPurchased − cogs
```

The first identity holds **exactly**, and that is deliberate: every cost figure is
measured over the same costed orders as `costedRevenue`. Mixing in figures from
uncosted orders would break it and leave a summary that does not add up.
`grossOrderProfit` is derived from its own components rather than accumulated
separately, so the summary can never report a bottom line its own cost lines
disagree with.

`companySpend` is every expense row regardless of kind — cash out. It is
`operatingSpend` alone that reduces net profit.

### A discount is not a cost

`discountAmount` is money the customer was **not charged**; it is already out
of `total` (and so out of `costedRevenue`) and appears nowhere in the cost
lines. It used to be enterable only through a discount code at checkout, so a
discount given by hand — "RM10 off for the bulk order" — was being recorded as
an Extra Cost called "discount". Profit came out right by accident; the
customer's total, the receipt and the revenue figure were all wrong, and the
discount was invisible to reporting.

Since 2026-09-22 the order page has a Discount card (ringgit or a percentage
of the goods, plus a reason stored in `discountNote`), the assistant has
`set_order_discount` and `create_order` takes `discountRm`/`discountPercent`.
Every path writes the same three fields — `discountAmount`, `discountNote` and
a recomputed `total` — through `utils/manual-discount.ts`, and refuses to touch
an order the gateway already charged.

### A wrong quantity is not a cost either

The other number that used to get bent to make the books balance was the unit
cost: with no way to change an order's lines after it was placed, a quantity
keyed in wrong was "fixed" by typing a cost that made the line total right.
Since 2026-09-22 the Items card on the order page has an **Edit items** mode
(quantity, remove, add a size) and the assistant has `set_order_items`. Both go
through `adminSetOrderItems`: stock moves by the difference, existing lines keep
their sold price and their entered cost, a new line takes today's price with no
cost yet, the discount follows its own rule (`carryDiscount` in
`utils/manual-discount.ts` — percentages follow the new goods, fixed sums stay)
and `subtotal`/`total` are recomputed. Refused where a discount is refused, plus
on a cancelled order whose stock has already gone back.

The edit acts on the products on the order. What came included with a product
(`OrderItem.parentItemId` — a syringe, swab or vial size under the line it was
configured on) follows it: scaled to the new quantity, gone when the product
goes, and a product added here brings its required included items. Orders placed
before bundles existed (2026-10-20) carry those supplies as loose RM0 lines;
they are left as they are.

Analytics reads the same order set through the same `costOrder`, so the two pages
cannot disagree about what a month took. Its top-products list counts the
products customers chose, not what came included with them (`isIncludedItem` in
`utils/order-lines.ts`: a child line, or a free line of an add-on-only product),
and the month-end WhatsApp wrap (`utils/month-end.ts`) uses the same per-line
test to count supplies apart from units sold, on the same `costOrder`/`allocate`.

### A unit cost comes off the supplier price list

The remaining way a cost went wrong was the plainest one: it was typed from
memory, and the same vial was costed at four different figures across a month.
Since 2026-09-22 there is a **Suppliers** page — who the business buys from and
what each of them charges per unit of each SKU (`suppliers`, `supplier_costs`)
— and the Unit Cost box on the costing sheet sits next to a dropdown of every
supplier with a price for that line, cheapest first: pick "YL,C · RM65.00" and
the box fills in. The line records whose price it took (`order_items.supplierId`)
and copies the figure onto `unitCost` at that moment; a price changed on the
list later never rewrites an order already costed, for the same reason
`unitCost` lives on the line at all. Typing a different figure over a picked
price drops the line back to "by hand" — a supplier on a line means exactly
"this figure is their price". The assistant's `set_order_costs` takes a
supplier's name on a line the same way.

### Partner balances

```
owed = toShare + capitalOwed + advancesOutstanding − payouts on account
```

- `toShare` — their cut of every costed, paid order **not shared out yet**.
- `capitalOwed` — capital they fronted on an order not shared out yet and not yet
  moved into an advance. Zero after the bank cutover (below).
- `advancesOutstanding` — loans to Ascend not repaid yet.
- payouts on account — a payout recorded on its own, outside a share-out.

Owed is built from what is still **open**, not from lifetime earnings less
lifetime payouts. Before the bank, profit was settled by ticking "Profit Shared"
with the money moving outside the system and almost never a payout recorded, so
`earned − paidOut` read as months of profit still owed. A shared order is
settled — its profit and any capital on it. `earned`, `capitalFronted` and
`paidOut` are still reported, as history.

Company spending **never** lands on a person as a charge. Contributions are
capital never owed back and sit outside the sum entirely.

---

## Ascend's bank

From 21 Oct 2026 Ascend has its own account. Design and decisions:
[ascend-bank-plan.md](./ascend-bank-plan.md). Code: `utils/bank.ts`,
`utils/split-rules.ts`, `modules/admin/admin-money.controller.ts`.

**The balance is derived**, like everything else here. Nearly every movement is
already a row somewhere:

| In | Out |
|---|---|
| `OPENING` and `MONEY_IN` bank entries | `MONEY_OUT` bank entries |
| a paid order: `total − gatewayFee`, at `paidAt` | a refund: `refundedAmount` |
| partner funding with `throughBank` | an expense with no `paidByPartnerId` |
| | a payout (share-out or on account), a repayment |

Only what is dated on or after the `OPENING` entry counts. Crypto (BTCPay) is
left out — it settles to a wallet; it comes in as `MONEY_IN` when cashed. An
expense a partner paid personally never touched the bank. **No per-order cost is
posted to the bank**: the bank sees the supplier payment when it is made
(category Stock, kind INVENTORY), not each vial's unit cost when it sells —
posting both is the stock double-count from §1 all over again.

A **statement check** (`bank_checks`) stores what the bank app said and the book
balance at that moment; the difference stays visible after later movements.

**Ascend is a partner** (`Partner.kind = COMPANY`, exactly one). Its share of a
split is retained profit: reported as `ascend.retained`, never paid out, never
"owed".

**The default split** is a versioned rule (`profit_split_rules`). A paid order
with no split gets the version in effect at `paidAt`, copied onto the order —
at the PAID transition and in a sweep before every money read. A later rule
never rewrites an order. Rules: before the bank Asywa 70 / Fakhrul 30; from
1 Nov 2026 00:00 MYT Fakhrul 35 / Asywa 45 / Ascend 20.

**A share-out** (`payout_runs`) pays each person their part of a set of
ready orders (paid, delivered, costed, split complete) in one transaction and
marks them `profitShared` + `payoutRunId`. Undo deletes the run, its payouts,
and unshares the orders. A `legacy` run pays nobody: orders settled by hand.

### The cutover (`scripts/cutover-ascend-bank.ts`)

Dry-run by default, `--apply` to write; safe to re-run.

1. Every order ticked "Profit Shared" by hand goes into one legacy run, with
   the payouts recorded before the bank attached to it.
2. Capital fronted on orders not shared yet becomes one ADVANCE per person
   (`throughBank: false`), and each share points at it (`capitalFundingId`) —
   Fakhrul's decision D2: a debt Ascend repays in parts. On the prod copy of
   21 Oct this was Asywa RM 5,689.00 over 24 orders and Fakhrul RM 1.00.

---

## Backfill

Orders confirmed paid before the gateway-fee column existed carry zero, so their
profit still reads high. The script reports and then, only with `--apply`, writes:

```bash
cd backend
npx tsx scripts/backfill-gateway-fees.ts            # report only
npx tsx scripts/backfill-gateway-fees.ts --apply    # write
```

Deliberately opt-in and dry-run by default: it rewrites what people were told they
earned, which is not something a migration should do quietly. Orders that already
carry a non-zero fee are never touched, so re-running is safe and a hand-corrected
figure is never overwritten. All writes happen in one transaction — a
half-applied backfill would leave the books in a state that is neither before nor
after, with no way to tell which orders were done.

---

## Verifying

`backend/src/utils/profit.ts` (`costOrder`, `allocate`) is mirrored by
`profitSummary`/`allocate` in
`frontend/src/app/admin/orders/[id]/OrderDetail.tsx`. There is no shared package
between the two apps, so **these must be changed together** — two callers
disagreeing about the bottom line is the kind of bug nobody notices until someone
is paid the wrong amount.

Related: [Document store](./documents.md) — the receipts and invoices behind these
numbers. The original design discussion is in
[finance-section-plan.md](./finance-section-plan.md).
