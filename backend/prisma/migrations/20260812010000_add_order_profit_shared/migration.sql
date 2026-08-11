-- Manual "the profit for this order has been paid out" tick on the orders list.
-- Defaults false; every existing order starts unticked, which is the honest
-- state since nothing has been recorded as paid out before now.
ALTER TABLE "orders" ADD COLUMN "profitShared" BOOLEAN NOT NULL DEFAULT false;
