-- Backs the order detail page's Profit Sharing tab.
--
-- orders.costAmount is nullable on purpose: null means "no admin has entered a
-- cost yet", which the UI renders as unknown profit rather than as 100% margin.
-- A DEFAULT 0 would have made those two states indistinguishable on the ~23
-- existing orders.
ALTER TABLE "orders" ADD COLUMN "costAmount" INTEGER;

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

-- ON DELETE CASCADE: orders are only ever soft-deleted (orders.deletedAt), so
-- this fires only if a row is ever genuinely purged, and an orphaned split row
-- would be meaningless anyway.
ALTER TABLE "order_profit_shares"
    ADD CONSTRAINT "order_profit_shares_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
