# Finance section — plan

Goal: one place that answers, for the life of the business rather than one
order — what has each person earned, what have they put back in, what has the
company spent, and what is each person actually owed right now.

Nothing here is built. This is the proposal.

---

## 1. What exists today

- **Profit is computed per order.** `costOrder()` in `backend/src/utils/profit.ts`:
  `order.total − item costs − order extra costs`, and only when every line is
  costed. That's the whole of it.
- **`OrderProfitShare` splits that one order** into `name` + `shareBps`,
  allocated by largest remainder so the parts sum exactly.
- **The analytics page already aggregates `profitByPerson`** across a date
  range — but only across that range, and only from orders.
- Production right now: one order with a 30/30/40 split between **Fakhrul**,
  **Asyraf** and **Investors**, and zero company expenses recorded anywhere.

Two facts from that shape everything below.

### Fact 1: people are free text

`OrderProfitShare.name` is a plain string. "Fakhrul" on one order and "fakhrul"
on another are two different people as far as the database is concerned, and
nothing stops a typo creating a fourth partner. **A lifetime balance per person
is impossible until a person is a real row.** This is the foundational change.

### Fact 2: order profit is not company profit

This is the crux of the whole section, so it's worth being blunt about it.

Today's number is *gross profit on goods sold*. It knows nothing about rent,
ads, a laptop, Shopify/Resend subscriptions, or a bulk vial order that isn't
attached to a customer order yet. Add company spending to the picture and the
existing per-person numbers become **overstatements**:

```
10 orders, gross order profit          RM2,000
   split 30/30/40   → Fakhrul RM600, Asyraf RM600, Investors RM800
company spent on ads + packaging       RM  800
                                       ────────
actually distributable                 RM1,200
```

The splits say RM2,000 was shared out. RM1,200 existed. If the finance page
just sums `OrderProfitShare` it will confidently tell three people they earned
money the business never had.

**So a company expense has to reduce someone's balance.** The design question is
whose, and by how much.

---

## 2. The core decision: how company spending lands on people

### Option A — Ownership percentage ✅ **CHOSEN**

Set a company-level ownership split once (defaulting to the same 30/30/40).
Every company expense is allocated across partners by that percentage, exactly
the way order profit is allocated by `shareBps`.

- Reuses `allocate()` — same largest-remainder maths, so shares still sum exact.
- No period/month-close concept needed.
- Handles the common real case directly (see "who paid" below).
- Trade-off: two percentage concepts exist — the per-order split, and ownership.
  They'll usually be identical, and the second only appears on expenses.

### Option B — Period close

Close a month: `total order profit − month's expenses = distributable`, split
that by ownership. Per-order splits become gross/advisory only.

- Accounting-correct, and how a real business does it.
- Much bigger: needs a period entity, a close/reopen flow, and it makes the
  per-order split we just shipped largely decorative.
- Worth revisiting if this ever needs to produce real accounts.

### Option C — Expenses tracked but never allocated

Just list company spending on a dashboard; per-person numbers stay gross.

- Cheapest, and honest *if the page says so loudly*.
- But it doesn't answer "what am I actually owed", which is the point.

**Chosen: A.** It answers the real question, reuses the allocation code, and
doesn't invalidate the per-order work.

### Per-expense override

Each expense should still be able to say how it's shared, because not everything
is a fair split:

| Allocation | Meaning |
|---|---|
| `OWNERSHIP` (default) | Split by ownership % |
| `SINGLE_PARTNER` | Charged wholly to one person |
| `UNALLOCATED` | Company absorbs it; reduces company profit, touches nobody's balance |

### Who *paid* is a separate question from who it's charged to

If Asyraf buys RM300 of packaging on his own card, that is two things at once:

1. a company cost of RM300, shared by ownership → −RM90 / −RM90 / −RM120
2. RM300 the company owes Asyraf

Netting out, Asyraf is up RM210 and the other two are down RM90 each. Modelling
`paidByPartnerId` separately from allocation is what makes this work, and this
case will come up constantly in a business this size.

---

## 3. Data model

Everything in **integer cents**, matching the rest of the schema.

```prisma
model Partner {
  id       String  @id @default(cuid())
  name     String  @unique
  // A partner who has left still has history, so they're deactivated rather
  // than deleted — and inactive partners drop out of new pickers.
  active   Boolean @default(true)
  // Share of company-level expenses, basis points. Not the same field as
  // OrderProfitShare.shareBps: that one is per order and can differ.
  ownershipBps Int @default(0)
  notes    String?

  funding      PartnerFunding[]
  payouts      ProfitPayout[]
  expensesPaid CompanyExpense[]
}

// Spending on the business itself, not attached to any customer order.
// (Order-specific costs stay where they are, on OrderExtraCost.)
model CompanyExpense {
  id          String   @id @default(cuid())
  occurredAt  DateTime
  category    String   // Marketing, Stock, Software, Equipment, Shipping supplies…
  description String
  amount      Int
  allocation  ExpenseAllocation @default(OWNERSHIP)
  // Only set when allocation = SINGLE_PARTNER
  chargedToPartnerId String?
  // Who actually fronted the cash. Null = paid from a company account.
  paidByPartnerId    String?
  // Only meaningful when paidByPartnerId is set: does that partner want the
  // money back (ADVANCE) or is it pure investment (CONTRIBUTION)? Saving the
  // expense creates the matching PartnerFunding row.
  paidByFundingType  FundingType?
  receiptUrl  String?  // reuses the existing image upload endpoint
}

enum ExpenseAllocation { OWNERSHIP SINGLE_PARTNER UNALLOCATED }

// Money a partner puts INTO the business — either as cash, or by paying a
// company expense directly out of their own pocket.
model PartnerFunding {
  id          String  @id @default(cuid())
  partnerId   String
  type        FundingType
  amount      Int
  occurredAt  DateTime
  description String
  // Set when this was a partner paying a company expense rather than
  // transferring cash in — links the two records together.
  expenseId   String?

  repayments PartnerRepayment[]
}

enum FundingType {
  // Pure investment. The partner does not want it back; it becomes capital
  // and creates no debt. Never appears in "owed".
  CONTRIBUTION
  // The company owes this back. Outstanding until repaid, in full or in parts.
  ADVANCE
}

// A repayment against one specific ADVANCE. Kept as its own rows rather than a
// `repaid` boolean so a partly-repaid advance is representable — paying back
// RM300 of a RM1,000 advance is the normal case, not the exception.
model PartnerRepayment {
  id         String   @id @default(cuid())
  fundingId  String
  amount     Int
  occurredAt DateTime
  note       String?
}

// Paying out profit someone has earned. Separate from repaying an advance:
// one settles a debt, the other distributes earnings, and conflating them
// makes "how much has this business actually returned to people" unanswerable.
model ProfitPayout {
  id         String   @id @default(cuid())
  partnerId  String
  amount     Int
  occurredAt DateTime
  note       String?
}
```

**Why rows rather than running totals on `Partner`:** a stored total can't be
audited or explained. "You're owed RM1,240" is useless without the list behind
it. Deriving it also matches the recompute-on-read choice below.

### Money in has two flavours, and the difference is the whole point

This is the part that changes what the section is for. When a partner puts money
in — whether by transferring cash or by buying something for the company on
their own card — there is exactly one question that matters:

| | **CONTRIBUTION** | **ADVANCE** |
|---|---|---|
| Intent | Pure investment, wants nothing back | Wants it back |
| Creates a debt? | No | Yes |
| Shows in "owed to them" | Never | Until repaid |
| Tracked status | — | Outstanding / Partly repaid / Repaid |

So every expense a partner pays for asks one extra question at entry time —
*"is Asyraf getting this back?"* — and that single answer decides whether it
quietly becomes capital or sits on the books as a debt until settled.

Outstanding is derived, never stored:

```
outstanding(advance) = advance.amount − sum(its repayments)
status = outstanding == 0        → Repaid
         outstanding < amount    → Partly repaid
         else                    → Outstanding
```

### On "not exactly withdrawals"

Taken as: the interesting thing to track is **repayment of advances**, not a
generic money-out bucket. That's `PartnerRepayment` above.

`ProfitPayout` is kept as a separate, deliberately thin model for the "yea sure"
part — without *something* recording that earned profit has been handed over,
the earned column only ever grows and "owed" stays wrong forever. It's one
amount and a date; it doesn't need to be more than that yet.

---

## 4. Derived vs recorded — the thing that decides how this behaves

`PROFIT_SHARE` and `EXPENSE_SHARE` entries are **derived** from orders and
expenses. Two ways to handle that:

**Recompute on read ✅ CHOSEN.** Don't store them; compute the
profit rows from `OrderProfitShare` and the expense rows from `CompanyExpense`
whenever the finance page loads. Only genuinely-manual entries
(`REINVESTMENT`, `WITHDRAWAL`, `PROFIT_RETAINED`, `ADJUSTMENT`) are stored rows.

- No sync problem, no double bookkeeping, no stale totals.
- Correcting an old order's cost automatically corrects everyone's balance.
- **But that cuts both ways:** editing a three-month-old order silently changes
  what people were told they earned. With three partners who talk to each other,
  that's probably fine and even desirable. It stops being fine the moment a
  payout has been made against a number.

**Materialise and freeze.** Write the entries when an order is costed, and never
change them retroactively.

- Payout-safe, auditable.
- Needs a "this order's split is final" action and a way to correct mistakes
  (a reversing `ADJUSTMENT`, not an edit).

**Decided: recompute on read.** Correct for now — three partners who talk to
each other, and no payouts made yet. The moment a real payout happens against a
stated number, revisit: add `lockedAt` to the split and stop recomputing past
it. The model above already supports that without a rewrite.

Note this does **not** apply to funding, repayments or payouts — those are real
recorded events and are always stored rows. Only the profit and expense-share
figures are derived.

---

## 5. The screens

**`/admin/finance` — Overview**

```
Company position
┌────────────────┐ ┌────────────────┐ ┌────────────────┐ ┌────────────────┐
│ GROSS PROFIT   │ │ COMPANY SPEND  │ │ NET PROFIT     │ │ CASH IN        │
│ from orders    │ │ all expenses   │ │ gross − spend  │ │ reinvestments  │
└────────────────┘ └────────────────┘ └────────────────┘ └────────────────┘

Partners                                            [ Record money ▾ ]
┌────────────────────────────────────────────────────────────────────────────┐
│ Name       Earned    Expense share  Contributed  Advances o/s  Paid  Owed   │
│ Fakhrul    RM1,200   −RM240         RM0          RM0           RM500 RM460  │
│ Asyraf     RM1,200   −RM240         RM1,000      RM300         RM0   RM1,260│
│ Investors  RM1,600   −RM320         RM0          RM0           RM0   RM1,280│
└────────────────────────────────────────────────────────────────────────────┘
```

The columns are the story, and the two money-in ones are deliberately apart:
**Contributed** is capital they never want back and never inflates what they're
owed; **Advances o/s** is money the company still has to return. Only the
second feeds "Owed".

```
Owed = Earned − Expense share + Advances outstanding − Profit paid out
```

`Contributed` appears nowhere in that formula on purpose — it's the whole
difference between the two funding types.

**`/admin/finance/partners/[id]`** — that person's full ledger, newest first,
every row linking back to its order or expense. This is the "show me why"
screen, and it's what makes the balance trustworthy.

**`/admin/finance/expenses`** — list + add. Category, description, amount, date,
who paid, how it's allocated, optional receipt image (the upload endpoint
already exists and now caps at 1600px). Filter by category and date.

**Recording money movements** — a single "Record payment" action covering
reinvestment, withdrawal and retained profit, since they're the same shape:
partner, type, amount, date, note.

**Existing pages** get small hooks rather than duplication: the analytics
Profit Share card links through to Finance, and an order's Profit Sharing tab
links each name to that partner's ledger.

---

## 6. Migration from what's there now

1. Create a `Partner` row per distinct `OrderProfitShare.name` — currently
   exactly **Fakhrul, Asyraf, Investors**.
2. Add `OrderProfitShare.partnerId`, backfill by exact name match, keep `name`
   as a frozen historical label.
3. Seed `ownershipBps` from the current split (3000/3000/4000) — it's the
   obvious starting point and you can change it.

**"Investors" stays one bucket** — confirmed. It becomes a single `Partner`
row like any other. If it ever needs splitting into named individuals that is a
manual reconstruction job, so the decision is worth revisiting before the volume
of history grows rather than after.

---

## 7. Decisions taken

| # | Question | Decision |
|---|---|---|
| 1 | How company spending lands on people | **Ownership-based allocation** (Option A) |
| 2 | Is "Investors" one bucket or several people | **One bucket** — a single Partner row |
| 3 | Money out | **Not generic withdrawals.** Money in is either a CONTRIBUTION (never repaid) or an ADVANCE (repayable, tracked Outstanding / Partly repaid / Repaid). `ProfitPayout` kept thin, separately |
| 4 | Derived rows | **Recompute on read** |
| 5 | Expense categories | **Free text** |

Free-text categories mean the breakdown groups on exact string match, so
"Marketing" and "marketing" would be two rows. The add-expense field will
suggest categories already used — that keeps them consistent without imposing a
fixed list.

## 8. Order of work

| Step | Work |
|---|---|
| 1 | `Partner` model + migration + backfill from existing split names |
| 2 | `CompanyExpense`, `PartnerFunding`, `PartnerRepayment`, `ProfitPayout` models |
| 3 | Balance computation (reuses `allocate()` from `utils/profit.ts`) |
| 4 | Expenses CRUD screen |
| 5 | Finance overview + partner ledger screens |
| 6 | Record contribution / advance / repayment / payout flow |
| 7 | Links from analytics and the order Profit Sharing tab |

Steps 1–3 are the substance; everything after is UI over a settled model.
