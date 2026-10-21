-- CreateEnum
CREATE TYPE "PartnerKind" AS ENUM ('PERSON', 'COMPANY');

-- CreateEnum
CREATE TYPE "BankEntryKind" AS ENUM ('OPENING', 'MONEY_IN', 'MONEY_OUT');

-- AlterTable
ALTER TABLE "order_profit_shares" ADD COLUMN     "capitalFundingId" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "payoutRunId" TEXT;

-- AlterTable
ALTER TABLE "partner_funding" ADD COLUMN     "throughBank" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "partners" ADD COLUMN     "kind" "PartnerKind" NOT NULL DEFAULT 'PERSON';

-- AlterTable
ALTER TABLE "profit_payouts" ADD COLUMN     "runId" TEXT;

-- CreateTable
CREATE TABLE "payout_runs" (
    "id" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "legacy" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profit_split_rules" (
    "id" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profit_split_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profit_split_rule_shares" (
    "ruleId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "shareBps" INTEGER NOT NULL,

    CONSTRAINT "profit_split_rule_shares_pkey" PRIMARY KEY ("ruleId","partnerId")
);

-- CreateTable
CREATE TABLE "bank_entries" (
    "id" TEXT NOT NULL,
    "kind" "BankEntryKind" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "amount" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_checks" (
    "id" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "statementBalance" INTEGER NOT NULL,
    "bookBalance" INTEGER NOT NULL,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payout_runs_occurredAt_idx" ON "payout_runs"("occurredAt");

-- CreateIndex
CREATE INDEX "profit_split_rules_effectiveFrom_idx" ON "profit_split_rules"("effectiveFrom");

-- CreateIndex
CREATE INDEX "bank_entries_occurredAt_idx" ON "bank_entries"("occurredAt");

-- CreateIndex
CREATE INDEX "bank_checks_checkedAt_idx" ON "bank_checks"("checkedAt");

-- CreateIndex
CREATE INDEX "orders_payoutRunId_idx" ON "orders"("payoutRunId");

-- CreateIndex
CREATE INDEX "profit_payouts_runId_idx" ON "profit_payouts"("runId");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_payoutRunId_fkey" FOREIGN KEY ("payoutRunId") REFERENCES "payout_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_profit_shares" ADD CONSTRAINT "order_profit_shares_capitalFundingId_fkey" FOREIGN KEY ("capitalFundingId") REFERENCES "partner_funding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profit_payouts" ADD CONSTRAINT "profit_payouts_runId_fkey" FOREIGN KEY ("runId") REFERENCES "payout_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profit_split_rule_shares" ADD CONSTRAINT "profit_split_rule_shares_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "profit_split_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profit_split_rule_shares" ADD CONSTRAINT "profit_split_rule_shares_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ------------------------------------------------------------------ data
-- Ascend's bank (docs/ascend-bank-plan.md). Decisions by Fakhrul, 2026-10-21.

-- Ascend itself takes a share of every split from 1 Nov 2026. One COMPANY row.
INSERT INTO "partners" ("id", "name", "kind", "active", "notes", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'Ascend', 'COMPANY', true,
       'Ascend''s bank. Its share stays in the bank as retained profit.', now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "partners" WHERE "kind" = 'COMPANY');

-- Asywa is the partner stored as "Asyraf". Splits on old orders keep the name
-- they were saved with (order_profit_shares.name); the label follows the row.
UPDATE "partners" SET "name" = 'Asywa', "updatedAt" = now()
WHERE "name" = 'Asyraf' AND NOT EXISTS (SELECT 1 FROM "partners" WHERE "name" = 'Asywa');

-- Rule 1: the split everyone used before the bank — Asywa 70, Fakhrul 30.
-- Applies to any paid order up to 31 Oct that still has no split.
INSERT INTO "profit_split_rules" ("id", "effectiveFrom", "note", "createdBy", "createdAt")
SELECT 'split-rule-before-bank', '1970-01-01T00:00:00Z', 'Before Ascend''s bank', 'migration', now()
WHERE EXISTS (SELECT 1 FROM "partners" WHERE "name" = 'Asywa')
  AND EXISTS (SELECT 1 FROM "partners" WHERE "name" = 'Fakhrul');
INSERT INTO "profit_split_rule_shares" ("ruleId", "partnerId", "shareBps")
SELECT 'split-rule-before-bank', p."id", CASE p."name" WHEN 'Asywa' THEN 7000 ELSE 3000 END
FROM "partners" p
WHERE p."name" IN ('Asywa', 'Fakhrul')
  AND EXISTS (SELECT 1 FROM "profit_split_rules" WHERE "id" = 'split-rule-before-bank');

-- Rule 2: from 1 Nov 2026 00:00 MYT — Fakhrul 35, Asywa 45, Ascend 20.
INSERT INTO "profit_split_rules" ("id", "effectiveFrom", "note", "createdBy", "createdAt")
SELECT 'split-rule-ascend-bank', '2026-10-31T16:00:00Z', 'Ascend''s bank takes 20%', 'migration', now()
WHERE EXISTS (SELECT 1 FROM "partners" WHERE "name" = 'Asywa')
  AND EXISTS (SELECT 1 FROM "partners" WHERE "name" = 'Fakhrul');
INSERT INTO "profit_split_rule_shares" ("ruleId", "partnerId", "shareBps")
SELECT 'split-rule-ascend-bank', p."id",
       CASE WHEN p."kind" = 'COMPANY' THEN 2000 WHEN p."name" = 'Asywa' THEN 4500 ELSE 3500 END
FROM "partners" p
WHERE (p."name" IN ('Asywa', 'Fakhrul') OR p."kind" = 'COMPANY')
  AND EXISTS (SELECT 1 FROM "profit_split_rules" WHERE "id" = 'split-rule-ascend-bank');
