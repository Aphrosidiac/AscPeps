# Ascend's bank: profit sharing rework — plan

Status: **BUILT on branch `feat/ascend-bank`, not deployed.** Written 2026-10-21
from the code at `86d6b93`; decisions D1–D6 below are Fakhrul's. What the code
does is described in [bookkeeping.md](./bookkeeping.md#ascends-bank); this file
keeps the reasoning.

Built differently from the sketch below, on purpose:
- **The bank balance is derived**, not a ledger every record writes into.
  `bank_entries` holds only the opening balance and odd movements; sales,
  refunds, capital, expenses, payouts and repayments are read from their own
  tables (one record per event, nothing to drift).
- **Tabs are routes** (`/admin/money`, `/share`, `/bank`, `/partners`,
  `/expenses`), so every section is linkable.
- **"Profit Shared" became a status**, set by a share-out; the old checkbox is
  gone from the orders list (its badge reads *To share* / *Complete*).
- Orders whose split is missing a partner show as **Split needs fixing**
  instead of dropping out of the queue.

## What changes, in one paragraph

Ascend now has its own bank account. All capital sits there, so order costs
are paid by Ascend, never "fronted" by a partner — the per-order **Capital put
in** column goes. Ascend also becomes a **profit-share holder**: the default
split is **Fakhrul 35% · Asywa 45% · Ascend 20%**, and Ascend's 20% simply
stays in the bank. The system has to track that bank — balance, money in,
money out — and the whole flow moves to one new page that replaces Finance.

---

## How it works today (what the audit found)

| Piece | Where | Today |
|---|---|---|
| Split per order | `order_profit_shares` (`shareBps`, `capitalAmount`) | Typed per order on the order page's Profit Sharing tab |
| Default split | `DEFAULT_SHARES` in `OrderDetail.tsx:235` | **Hard-coded in the frontend**: Fakhrul 30 / Asyraf 70. Not on the backend at all, so storefront and Abby-created orders get no split until someone clicks "Add people" |
| Who paid the costs | `OrderProfitShare.capitalAmount` | Typed per person per order; owed back on top of their cut. Dev data: Asyraf fronted on 21 of 24 orders |
| Partners | `partners` | **Auto-created from whatever name is typed** on a split (`adminUpdateOrderProfitShares` upserts by name). Dev DB has 7 partners incl. `MmmmAsyraffFakhrul`, `Pohasyraf`, `Poh`, `Poha` — typos became people |
| Company money | `CompanyExpense.paidByPartnerId = null` | "Came from a company account" — the only place a company account exists, and it has no balance |
| Money in | `partner_funding` (CONTRIBUTION / ADVANCE) | Recorded against a person; where the cash went is not recorded |
| Payouts | `profit_payouts` | A free amount per person, **not linked to any order** |
| "Profit Shared" | `Order.profitShared` checkbox (orders list, `set_profit_shared`) | **Not linked to payouts.** Ticking pays nobody; paying ticks nothing. Already caused the ASC2610/0001 mis-tick |
| Owed | `utils/finance.ts` | `earned + capitalFronted + advancesOutstanding − paidOut` |
| Per-person analytics | `admin-dashboard.controller.ts:225` | Groups by the frozen `share.name` string, so a renamed partner splits in two |
| Finance page | `/admin/finance` | Lifetime only — no month view. Partners table needs 820px |

Asywa is stored as partner **`Asyraf`** (prod: Asyraf 70% / Fakhrul 30%). This
plan treats Asywa and Asyraf as the same person — see decision D1.

---

## The model

Two separate ideas, kept separate on purpose:

1. **Profit (accrual, per order)** — unchanged maths. `costOrder` decides an
   order's profit; `allocate` divides it by the split. Ascend is just one more
   name in the split.
2. **Cash (the bank, per movement)** — a new ledger of what actually moved in
   and out of Ascend's account. Its balance is what you should see on the bank
   statement.

Mixing them is how stock got counted twice before (see `bookkeeping.md` §1), so
**no per-order cost is posted to the bank**. The bank sees the supplier payment
when it happens, not each vial's unit cost when it sells.

### Schema (one migration, additive)

```prisma
enum PartnerKind { PERSON  COMPANY }

model Partner {
  // + kind PartnerKind @default(PERSON)
  // Exactly one COMPANY row: "Ascend". Seeded by the migration, cannot be
  // deleted, deactivated or paid out. Its "earned" is retained profit.
}

// The split, versioned. A change makes a new rule from a date; it never
// rewrites an order that already has a split (same reason splits are stored
// per order today).
model ProfitSplitRule {
  id            String   @id @default(cuid())
  effectiveFrom DateTime
  note          String?
  createdAt     DateTime @default(now())
  shares        ProfitSplitRuleShare[]
}
model ProfitSplitRuleShare {
  ruleId    String
  partnerId String
  shareBps  Int
  @@id([ruleId, partnerId])
}

enum BankEntryKind {
  OPENING        // balance on the day the account starts being tracked
  CAPITAL_IN     // a partner puts money in (links PartnerFunding)
  SALES_IN       // customer money landing (see D3)
  SUPPLIER_OUT   // paying a supplier for stock (links CompanyExpense, kind INVENTORY)
  EXPENSE_OUT    // ads, software, courier top-ups... (links CompanyExpense)
  PAYOUT_OUT     // profit share paid to a person (links ProfitPayout)
  REPAYMENT_OUT  // advance paid back (links PartnerRepayment)
  REFUND_OUT     // money back to a customer
  OTHER_IN
  OTHER_OUT      // bank charges, transfers, corrections
}

model BankEntry {
  id          String        @id @default(cuid())
  occurredAt  DateTime
  kind        BankEntryKind
  amount      Int           // cents, always positive; direction comes from kind
  description String
  // At most one source. Deleting the source deletes its bank row, in the
  // same transaction, so the ledger can never hold an orphan.
  expenseId   String? @unique
  fundingId   String? @unique
  payoutId    String? @unique
  repaymentId String? @unique
  orderId     String?        // SALES_IN / REFUND_OUT
  createdAt   DateTime @default(now())
  @@index([occurredAt])
  @@index([kind])
}

// "I looked at the statement and it said RM X." The book balance at that
// moment is stored with it, so a difference stays visible even after later
// entries are added.
model BankCheck {
  id               String   @id @default(cuid())
  checkedAt        DateTime
  statementBalance Int
  bookBalance      Int
  note             String?
}

// One "share out": the orders it covered and what each person got.
model PayoutRun {
  id         String   @id @default(cuid())
  occurredAt DateTime
  note       String?
  createdAt  DateTime @default(now())
  payouts    ProfitPayout[]   // ProfitPayout + runId String?
  orders     Order[]          // Order + payoutRunId String?
}
```

Kept, not dropped: `OrderProfitShare.capitalAmount` (history — old orders keep
what they say), `Order.profitShared` (now set by a run; legacy ticks stay),
`CompanyExpense.paidByPartnerId` (a partner can still pay something personally
and be owed it, it just stops being the normal case).

### Maths changes

- `finance.ts` → `computeFinance` returns, besides partners:
  - `ascend: { retained, retainedThisPeriod, capitalIn }` — the COMPANY row is
    pulled out of `partners`; it has no `owed`.
  - `bank: { balance, inThisPeriod, outThisPeriod, lastCheck, difference }`.
  - `readyToShare: { orders, perPerson[], ascend }` — paid, delivered, costed,
    not in a run.
  - **Period support** (`from`/`to`), so the page and month-end read one
    function instead of month-end re-deriving it (`month-end.ts:169-215` today
    duplicates the earned/capital loop).
- `owed` for a person is unchanged in shape. `capitalFronted` stays for old
  orders and reads 0 for everything after the cutover.
- `profit.ts` / the `profitSummary` mirror in `OrderDetail.tsx`: no change to
  the arithmetic. Take-home stops adding capital for orders after the cutover.
- Bank balance = Σ IN kinds − Σ OUT kinds. Never negative-clamped: a negative
  book balance means a movement is missing, and the page says so.

### When the split is applied

On the backend, not the form: when an order becomes PAID (`applyPaid` and the
admin/Abby mark-paid paths), if it has no split, copy the rule in effect at
`paidAt`. A one-off backfill applies it to paid orders since the cutover that
have none. Effect: the "Needs split" state disappears for new orders, and
storefront and Abby orders stop arriving without one.

---

## The new page: **Ascend Money** (`/admin/money`)

Replaces Finance in the sidebar (`/admin/finance/*` redirects). Built in the
admin's own house vocabulary (Card/CardHeader, 38px controls, SaveBar, Dialog —
the Suppliers page standard), not a new look. Five tabs; the period picker
(This month · Last month · Lifetime · custom) sits in the page header and
drives every figure.

### 1. Overview — "where are we"
- **Hero: Ascend's bank balance**, with "Checked against statement 20 Oct ·
  matches" or "off by RM 42.10 — find it" and a *Check balance* button.
- Four tiles: **Ready to share** (RM, N orders) · **Owed to partners** ·
  **Kept by Ascend** (20% retained, period + lifetime) · **Net profit**.
- **Needs you** list — each line a link that opens the fix, already filtered:
  N orders need costing · N orders ready to share · statement not checked in
  14 days · bank balance negative.
- Profit summary (revenue → costs → gross → operating spend → net) for the
  period — today's Finance cards, made period-aware.
- Recent bank activity (last 8, "See all").

### 2. Bank — the account
- Ledger: date · description · kind pill · in · out · running balance. Each
  linked row opens its source (order, expense, payout run, partner).
- Filters: kind pills, period. CSV export.
- **Record** pill → menu: *Money in* (partner capital — asks Contribution or
  Advance; customer transfer; other) · *Money out* (supplier payment — supplier
  picker, can link the orders it was for; expense; other) · *Check balance*.
- Statement checks list underneath, with the difference at each.

### 3. Profit sharing — the queue
- **Split rule** card: one bar Fakhrul 35 | Asywa 45 | Ascend 20, "applies to
  orders paid from 1 Nov 2026". *Change rule* → dialog with partner picker and
  a start date; old versions listed underneath. Validation: totals 100%,
  Ascend present (see D5).
- **Ready to share**: orders paid + delivered + costed, not yet shared. Columns:
  order · profit · Fakhrul · Asywa · Ascend. All selected by default; the
  footer totals per person.
- *Share out RM X* → confirm dialog: "Pay Fakhrul RM a and Asywa RM b from
  Ascend's bank. Ascend keeps RM c." + date + note. One click creates the run,
  one payout per person, their bank OUT rows, and ticks every order. Warns
  (does not block) when the bank would go negative.
- **Waiting**: orders that will join the queue once costed / delivered — counts
  linking to the orders list filtered.
- **Past share-outs**: date · orders · amounts. Open → its orders. *Undo* deletes
  the run, its payouts and bank rows, and unticks the orders.

### 4. Partners
- Card per person: **owed now** large, then earned, paid out, advances
  outstanding, (legacy) capital fronted. Opens today's ledger page, which gets
  an "Earnings by order" filter by run.
- Ascend's card is different: retained profit, capital put in by partners,
  bank balance — no "owed".
- Add/rename/retire partners here only. Renaming changes the label everywhere
  live; splits on old orders keep the name they were saved with.

### 5. Expenses
- Today's expenses page moved in. **Paid from** defaults to *Ascend's bank*;
  "A partner paid personally" is a toggle that reveals the partner and
  Advance/Contribution (today it is always visible and reads like the normal
  case).
- Kind *Stock* = a supplier payment: supplier picker, optional linked orders.

---

## Everything else the change touches

### Order page — Profit Sharing tab (`OrderDetail.tsx`)
- **Split card goes read-only by default**: "Default split · 35 / 45 / 20" with
  each person's take and Ascend's 20%. *Change for this order* opens the editor.
- Editor: **partner picker, not free text** (active partners + Ascend). No
  capital column. Shares still in % to 2 dp, must total 100.
- Old orders that carry capital show it read-only: "Asyraf fronted RM 60 —
  before Ascend's bank".
- New line: share-out status — "Ready to share" (link to queue) or "Shared out
  3 Nov" (link to the run).
- `DEFAULT_SHARES` and the "Add people" empty state are deleted.
- Complete tab: take-home = profit share; "Ascend keeps RM c".

### Orders list (`admin/orders/page.tsx`)
- The **Profit Shared checkbox becomes a status pill**: *Ready* / *Shared 3 Nov*
  / blank. Click goes to the queue or the run. No more ticking without paying.
- Legacy: in the queue, pre-cutover orders get "Mark shared — paid outside the
  system" (creates a run with no payouts), so old manual ticks have a home.

### `lib/order-progress.ts`
- `split` check is satisfied by the auto-applied rule. Add a fifth check,
  **shared**, so *Complete* means the money actually went out. Badge and the
  Complete tab follow automatically (they share this file).

### Backend API (`admin-finance.*`, `admin-orders.*`)
- `PUT /orders/:id/profit-shares`: takes `partnerId`s, **stops auto-creating
  partners**, refuses non-zero `capitalAmount` on orders paid after the cutover,
  empty list = reset to the rule.
- New: `GET /money/overview?from&to`, `GET/POST/DELETE /money/bank`,
  `POST /money/bank/check`, `GET/POST /money/split-rules`,
  `GET /money/ready-to-share`, `POST/DELETE /money/runs`.
- Existing funding / repayment / payout / expense writes create and delete their
  bank row in the same transaction.
- `PUT /partners`: the Ascend row can't be removed, retired or renamed to
  nothing.

### Analytics (`admin-dashboard.controller.ts`, `analytics/page.tsx`)
- Profit by person grouped by `partnerId`, labelled from the live partner;
  Ascend shown as its own (muted) slice.

### Abby — the assistant
- `set_order_profit_shares`: drop `capitalRm`; names must resolve to an
  existing partner (Ascend accepted as "Ascend"/"company"/"bank"); describe the
  rule as the default.
- `set_profit_shared` → replaced by **`share_out_profit`** (preview with
  per-person amounts → approval card → run). Keep the old tool only for
  "paid outside the system" on pre-cutover orders.
- New reads (CORE money reads, next to `finance_overview`): `bank_overview`
  (balance, last check, recent movements), `ready_to_share`.
- New writes: `record_bank_movement` (capital in, supplier payment, other),
  `check_bank_balance`, `set_split_rule` (destructive — Fakhrul only, see D6).
- `record_expense`: default payer is Ascend's bank; `paidByPartner` only when
  someone says they paid personally. `record_funding` = money into the bank.
  `record_payout` pays from the bank and warns below zero.
- `finance_overview` / `month_end_report`: bank + Ascend's 20% + ready to share.
- `domains.ts` finance/orders text (line 227 already wrong: "a flat share of the
  running costs"), keywords: bank, akaun, baki, duit Ascend, share out, bagi
  profit, kongsi untung.
- `reports.tools.ts` SCHEMA_NOTES: new tables; `capitalAmount` marked legacy.
- `grounding.ts`: a bank-balance or "owed" claim needs a money read this turn.
- Morning brief (`digest.ts`): add "orders ready to share" and "bank not checked
  in 14 days".
- **Prod agent memory**: `core/business.md` (70/30 split, who pays costs) and
  `core/people.md` (Asywa = partner Asyraf) rewritten; old split rules removed so
  Abby does not quote 70/30.

### Month-end wrap (`utils/month-end.ts`, Routines panel copy)
- Reads `computeFinance` for the month instead of its own loop.
- Partner lines: earned, "Ascend kept RM c", owed to date. "Fronted RM x" line
  only for months before the cutover.
- New *Bank* block: opening · in · out · closing · last statement check.

### Docs and tests
- `docs/bookkeeping.md` (owed formula, capital section, new bank section),
  `docs/finance-section-plan.md` (pointer to this file), `docs/assistant.md`,
  README.
- `scripts/test-finance-split.ts` (rule application, Ascend share, legacy
  capital, bank balance, run create/undo), `scripts/test-agent-writes.ts` (new
  tools), real-model check in EN + BM ("share out October", "berapa duit dalam
  bank Ascend").

---

## Cutover (the part that can go wrong with real money)

Phase 0 is a **read-only** prod snapshot before any code ships:
each partner's owed today (earned, capital fronted, advances, paid out), paid
orders not ticked, stray partner rows, and whether any order after the cutover
date already has a split.

Then, in one migration + one opt-in script (dry run by default, like
`backfill-gateway-fees.ts`):

1. Seed partner **Ascend** (COMPANY).
2. Rename partner Asyraf → Asywa. Rule v1 from 2026-11-01 +08:00:
   Fakhrul 3500 · Asywa 4500 · Ascend 2000.
3. `OPENING` bank entry dated 2026-10-21 = the balance on the account today
   (Fakhrul types it), then `SALES_IN` / `REFUND_OUT` backfilled for orders paid
   or refunded since.
4. Settle the old world per D2 and D4.
5. Merge stray partner rows into the real ones (shares re-pointed, names kept).

Nothing pre-cutover is rewritten: old orders keep 70/30 and their capital.

---

## Build order

1. Phase 0 prod snapshot → answers to the decisions below.
2. Schema + migration + seed, `finance.ts` (period, bank, Ascend, ready to
   share), split auto-apply on PAID, API. Unit tests.
3. Ascend Money page: Overview, Bank, Profit sharing (queue + runs + rule).
4. Order page Profit tab, orders list pill, order-progress, analytics.
5. Partners + Expenses tabs moved in; `/admin/finance` redirects.
6. Abby tools, prompts, grounding, brief, month-end; tests + real-model eval.
7. Docs.
8. Local verification end to end (desktop + phone width), then deploy on
   Fakhrul's go: `deploy.sh` (migration) → cutover script → prod memory edit →
   Abby posts a short update to the Ascend MY group.

---

## Decisions (Fakhrul, 2026-10-21)

- **D1 — Asywa is partner "Asyraf". Decided: rename** the partner row to Asywa.
  Labels everywhere follow; splits saved on old orders keep "Asyraf" as typed.
  Abby's `core/people.md` drops the two-names note.
- **D2 — Capital Asywa already fronted on old orders. OPEN** — see the options
  below.
- **D3 — All customer money lands in Ascend's bank, starting now
  (2026-10-21). Decided.** The bank ledger starts today, not on 1 Nov: an
  `OPENING` entry dated 2026-10-21 with the balance on the account today.
  From then, an order turning PAID posts `SALES_IN` = total − gateway fee at
  `paidAt`; a refund posts `REFUND_OUT` = `refundedAmount`; moving an order off
  PAID/REFUNDED removes its row. Online and WhatsApp/manual alike. BTCPay crypto
  stays out (a wallet, not the bank) until it is cashed in as `OTHER_IN`.
  The code ships after today, so the cutover script backfills `SALES_IN` /
  `REFUND_OUT` for every order paid or refunded since the opening entry —
  nothing has to be recorded by hand in the meantime. Supplier payments and
  expenses paid from the account in that gap do have to be entered once the page
  is live (the bank check against the statement will show if one is missing).
- **D4 — Split change 1 Nov 2026 (MYT). Decided.** Rule v1 is effective from
  2026-11-01 00:00 +08:00. Orders paid before it keep 70/30 and are shared the
  old way. Their money still lands in the bank (D3), and since the bank pays
  for goods from today, the *Capital put in* column on those orders is left
  blank unless someone genuinely paid out of their own pocket.
- **D5 — Ascend's 20% is the fixed default. Decided.** Every order gets it from
  the rule; one order can still be edited on its Profit Sharing tab (including
  dropping or changing Ascend's share). The edit is shown on the order as
  "Changed from the default split".
- **D6 — Anyone can change the split rule. Decided.** Any admin on the page, and
  Abby on any operator's word (`set_split_rule` stays an approval-card write so
  it is never changed by accident). Every rule version records who made it.

### D2 — what the options mean

Under today's system, when Asywa paid a supplier for an order out of pocket,
that amount went into the order's *Capital put in*, and Ascend owes it back:
`owed = earned + capital fronted + advances − paid out`. On dev that is about
RM 2,625; the prod figure comes from the Phase 0 snapshot. Profit is not
affected by any option — only who holds the cash.

| Option | Bank on 1 Nov | Asywa | Ascend owes Asywa afterwards |
|---|---|---|---|
| **A. Repay now** | − the full amount (payout from the bank) | gets the cash | nothing |
| **B. Becomes Asywa's investment** | unchanged | never gets it back as cash | nothing (recorded as a contribution) |
| **C. Keep it as a debt** | unchanged on day one | gets it back later, in parts, whenever the bank can | the amount, shown on Asywa's card until repaid |

Recommended: **C**. It's what the old system already says is true, no cash has
to move on day one, and each repayment is a normal bank movement.
