# Bookkeeping figures

What each number on `/admin/finance` and `/admin/analytics` means, and the four
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
hosted, no processor). Orders with no gateway — WhatsApp, manual transfer — never
reach the table and stay at zero, which is a real figure, not "unknown".

Override per gateway in **Settings**, as `gateway_fee_<gateway>_flat` (cents) and
`gateway_fee_<gateway>_bps`. A blank or malformed value falls back to the default
rather than to zero: silently charging nothing because someone typed "RM1" into a
cents field is exactly the quiet wrong number this exists to remove.

The figure is editable per order on the *Profit Sharing* tab.

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

Analytics reads the same order set through the same `costOrder`, so the two pages
cannot disagree about what a month took.

### Partner balances are untouched by all this

```
owed = earned + capitalFronted + advancesOutstanding − paidOut
```

Company spending **never** lands on a person as a charge. If someone paid for
something, that is money owed back to them, recorded either as capital on an
order's split or as funding. Contributions are capital never owed back and sit
outside the sum entirely — that is the whole difference between the two funding
types.

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
