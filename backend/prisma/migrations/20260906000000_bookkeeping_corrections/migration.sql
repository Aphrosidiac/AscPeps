-- Bookkeeping corrections: the four ways the reported numbers were wrong.
--
--  1. Stock bought ahead of demand was expensed on purchase AND charged again
--     per order as OrderItem.unitCost, so it came off net profit twice.
--     company_expenses.kind separates the two: INVENTORY spending is not an
--     operating cost, it becomes COGS when the goods sell.
--  2. Payment gateway fees were recorded nowhere, so every online order's
--     profit was overstated by the processor's cut. orders."gatewayFee".
--  3. A refund dropped the order out of reporting entirely, deleting the costs
--     we had already paid along with the revenue, and a PARTIAL refund could
--     not be expressed at all. orders."refundedAmount" reverses revenue by an
--     exact figure instead.
--  4. (No column.) Revenue is now counted whether or not an order is costed —
--     a fix in utils/finance.ts, not in the schema.
--
-- Every column is additive with a DEFAULT, so existing rows keep exactly the
-- behaviour they were entered under and no backfill is required.

ALTER TABLE "orders" ADD COLUMN "gatewayFee" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN "refundedAmount" INTEGER NOT NULL DEFAULT 0;

CREATE TYPE "ExpenseKind" AS ENUM ('OPERATING', 'INVENTORY');

ALTER TABLE "company_expenses"
  ADD COLUMN "kind" "ExpenseKind" NOT NULL DEFAULT 'OPERATING';

-- Reporting groups spending by kind on every finance read.
CREATE INDEX "company_expenses_kind_idx" ON "company_expenses"("kind");
