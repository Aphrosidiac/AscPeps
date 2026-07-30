-- Finance section: lifetime per-person totals, company spending, and the
-- money partners put in. See docs/finance-section-plan.md.
--
-- Additive plus one nullable column on order_profit_shares. The backfill at the
-- bottom turns today's free-text split names into real Partner rows, which is
-- what makes a lifetime balance per person possible at all.

CREATE TYPE "ExpenseAllocation" AS ENUM ('OWNERSHIP', 'SINGLE_PARTNER', 'UNALLOCATED');
CREATE TYPE "FundingType" AS ENUM ('CONTRIBUTION', 'ADVANCE');

CREATE TABLE "partners" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "ownershipBps" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "partners_name_key" ON "partners"("name");
CREATE INDEX "partners_active_idx" ON "partners"("active");

CREATE TABLE "company_expenses" (
    "id" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "allocation" "ExpenseAllocation" NOT NULL DEFAULT 'OWNERSHIP',
    "chargedToPartnerId" TEXT,
    "paidByPartnerId" TEXT,
    "receiptUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_expenses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "company_expenses_occurredAt_idx" ON "company_expenses"("occurredAt");
CREATE INDEX "company_expenses_category_idx" ON "company_expenses"("category");

CREATE TABLE "partner_funding" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "type" "FundingType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "expenseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_funding_pkey" PRIMARY KEY ("id")
);

-- One expense can only ever be funded once.
CREATE UNIQUE INDEX "partner_funding_expenseId_key" ON "partner_funding"("expenseId");
CREATE INDEX "partner_funding_partnerId_idx" ON "partner_funding"("partnerId");

CREATE TABLE "partner_repayments" (
    "id" TEXT NOT NULL,
    "fundingId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_repayments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "partner_repayments_fundingId_idx" ON "partner_repayments"("fundingId");

CREATE TABLE "profit_payouts" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profit_payouts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "profit_payouts_partnerId_idx" ON "profit_payouts"("partnerId");

ALTER TABLE "order_profit_shares" ADD COLUMN "partnerId" TEXT;
CREATE INDEX "order_profit_shares_partnerId_idx" ON "order_profit_shares"("partnerId");

-- Foreign keys. No cascade from partners: a partner with history must not be
-- deletable out from under an order's recorded split — they get deactivated.
ALTER TABLE "order_profit_shares" ADD CONSTRAINT "order_profit_shares_partnerId_fkey"
    FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "company_expenses" ADD CONSTRAINT "company_expenses_chargedToPartnerId_fkey"
    FOREIGN KEY ("chargedToPartnerId") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "company_expenses" ADD CONSTRAINT "company_expenses_paidByPartnerId_fkey"
    FOREIGN KEY ("paidByPartnerId") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "partner_funding" ADD CONSTRAINT "partner_funding_partnerId_fkey"
    FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Deleting the expense deletes the funding record that represents paying for it.
ALTER TABLE "partner_funding" ADD CONSTRAINT "partner_funding_expenseId_fkey"
    FOREIGN KEY ("expenseId") REFERENCES "company_expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "partner_repayments" ADD CONSTRAINT "partner_repayments_fundingId_fkey"
    FOREIGN KEY ("fundingId") REFERENCES "partner_funding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "profit_payouts" ADD CONSTRAINT "profit_payouts_partnerId_fkey"
    FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: one Partner per distinct split name already recorded, then point
-- the existing shares at them. Ownership is seeded from each partner's most
-- common share so the very first expense allocates sensibly instead of 0%;
-- it is editable afterwards and only has to total 100%.
INSERT INTO "partners" ("id", "name", "active", "ownershipBps", "createdAt", "updatedAt")
SELECT
    md5(random()::text || clock_timestamp()::text)::uuid::text,
    s.name,
    true,
    COALESCE((
        SELECT s2."shareBps"
        FROM "order_profit_shares" s2
        WHERE s2.name = s.name
        GROUP BY s2."shareBps"
        ORDER BY count(*) DESC, s2."shareBps" DESC
        LIMIT 1
    ), 0),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (SELECT DISTINCT name FROM "order_profit_shares") s;

UPDATE "order_profit_shares" s
SET "partnerId" = p.id
FROM "partners" p
WHERE p.name = s.name;
