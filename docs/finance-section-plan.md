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

### Option A — Ownership percentage *(recommended)*

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

**Recommendation: A.** It answers the real question, reuses the allocation code,
and doesn't invalidate the per-order work.

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

  ledgerEntries PartnerLedgerEntry[]
  expensesPaid  CompanyExpense[]
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
  receiptUrl  String?  // reuses the existing image upload endpoint
}

enum ExpenseAllocation { OWNERSHIP SINGLE_PARTNER UNALLOCATED }

// The one money trail per person. Balance = sum(amount).
model PartnerLedgerEntry {
  id         String   @id @default(cuid())
  partnerId  String
  type       LedgerEntryType
  amount     Int      // signed: + owed to them, − owed by them
  occurredAt DateTime
  note       String?
  // Provenance, so any derived row can be traced back and recomputed.
  orderId    String?
  expenseId  String?
}

enum LedgerEntryType {
  PROFIT_SHARE      // + their cut of an order's profit
  EXPENSE_SHARE     // − their share of a company expense
  EXPENSE_PAID      // + they fronted a company expense
  REINVESTMENT      // + cash they put into the business
  PROFIT_RETAINED   // reclassifies earned profit as capital left in (see below)
  WITHDRAWAL        // − cash they took out
  ADJUSTMENT        // manual correction, always with a note
}
```

**Why a ledger rather than running totals on `Partner`:** a stored total can't
be audited or explained. "You're owed RM1,240" is useless without the list
behind it, and a ledger gives that for free.

### Reinvestment is two different things

Worth separating at the model level, because they mean different things:

- **`REINVESTMENT`** — new cash in from a partner's own pocket. Company cash
  goes up.
- **`PROFIT_RETAINED`** — they simply don't take their share; it stays in the
  business. No cash moves. Their *balance owed* goes down, their *capital in*
  goes up.

Collapsing these into one type makes it impossible to answer "how much actual
cash has gone into this business", which is exactly what someone asks when they
want their money out.

### Withdrawals — not asked for, but the section is wrong without them

You didn't mention them, so flagging rather than assuming. Without a
`WITHDRAWAL` type every balance only ever grows: the page would say Fakhrul is
owed RM4,000 forever, including the RM3,000 he already took. One entry type
fixes it, and there is no coherent "what is each person owed" without it.

---

## 4. Derived vs recorded — the thing that decides how this behaves

`PROFIT_SHARE` and `EXPENSE_SHARE` entries are **derived** from orders and
expenses. Two ways to handle that:

**Recompute on read (recommended to start).** Don't store them; compute the
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

**Suggestion:** start with recompute-on-read; add a `lockedAt` on the split when
real payouts start happening. Cheap now, and the ledger shape already supports
the stricter version later.

---

## 5. The screens

**`/admin/finance` — Overview**

```
Company position
┌────────────────┐ ┌────────────────┐ ┌────────────────┐ ┌────────────────┐
│ GROSS PROFIT   │ │ COMPANY SPEND  │ │ NET PROFIT     │ │ CASH IN        │
│ from orders    │ │ all expenses   │ │ gross − spend  │ │ reinvestments  │
└────────────────┘ └────────────────┘ └────────────────┘ └────────────────┘

Partners                                          [ Record payment ▾ ]
┌──────────────────────────────────────────────────────────────────────┐
│ Name      Earned     Expense share   Reinvested   Withdrawn   Owed    │
│ Fakhrul   RM1,200    −RM240          RM0          −RM500      RM460   │
│ Asyraf    RM1,200    −RM240          RM1,000      RM0         RM1,960 │
│ Investors RM1,600    −RM320          RM0          RM0         RM1,280 │
└──────────────────────────────────────────────────────────────────────┘
```

The columns are the story: what they earned, what the company's costs took off
them, what they put in, what they took out, what's left.

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

**"Investors" is a bucket, not a person.** It works fine as a single pseudo-
partner if that's how you think about it, but if there are real individual
investors who each expect a number, that has to be decided before the backfill
— splitting it afterwards means reconstructing history by hand.

---

## 7. What I need from you before building

1. **Option A (ownership-based allocation)?** Or is company spending something
   you'd rather just see listed, not pushed onto people?
2. **Is "Investors" one bucket or several real people?**
3. **Withdrawals — do you want them?** I think the section is incoherent without
   them, but it's your call.
4. **Recompute-on-read, or freeze splits once agreed?** Depends whether real
   payouts have happened yet.
5. **Expense categories** — fixed list or free text? Free text is friendlier;
   a fixed list makes the breakdown chart actually useful.

---

## 8. Order of work

| Step | Work |
|---|---|
| 1 | `Partner` model + migration + backfill from existing split names |
| 2 | `CompanyExpense` + `PartnerLedgerEntry` models |
| 3 | Balance computation (reuses `allocate()` from `utils/profit.ts`) |
| 4 | Expenses CRUD screen |
| 5 | Finance overview + partner ledger screens |
| 6 | Record reinvestment / withdrawal / retained flow |
| 7 | Links from analytics and the order Profit Sharing tab |

Steps 1–3 are the substance; everything after is UI over a settled model.
