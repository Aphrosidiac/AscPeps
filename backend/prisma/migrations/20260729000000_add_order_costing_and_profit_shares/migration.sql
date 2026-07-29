-- Backs the order detail page's Profit Sharing tab.
--
-- Three pieces, all nullable/optional so the ~29 existing orders stay valid
-- with no backfill:
--   1. order_items.unitCost  — what each line actually cost us, per unit
--   2. order_extra_costs     — fuel, courier, packaging, one-off fees
--   3. order_profit_shares   — how the resulting profit is divided
--
-- unitCost is nullable on purpose: NULL means "nobody has priced this line
-- yet", which the UI reports as unknown profit rather than as 100% margin. A
-- DEFAULT 0 would have made those two states indistinguishable.
ALTER TABLE "order_items" ADD COLUMN "unitCost" INTEGER;

CREATE TABLE "order_extra_costs" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_extra_costs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "order_extra_costs_orderId_idx" ON "order_extra_costs"("orderId");

-- shareBps is basis points (5000 = 50%), so an even three-way split is exact.
CREATE TABLE "order_profit_shares" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shareBps" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_profit_shares_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "order_profit_shares_orderId_idx" ON "order_profit_shares"("orderId");

-- ON DELETE CASCADE on both: orders are only ever soft-deleted (orders.deletedAt),
-- so this fires only if a row is ever genuinely purged, and an orphaned cost or
-- split row would be meaningless anyway.
ALTER TABLE "order_extra_costs"
    ADD CONSTRAINT "order_extra_costs_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_profit_shares"
    ADD CONSTRAINT "order_profit_shares_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
