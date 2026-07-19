-- Soft-delete only: "Delete" in the admin UI never removes the order row,
-- it just sets deletedAt so it's excluded from the normal views and shown
-- in a separate Deleted filter instead.
ALTER TABLE "orders" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "orders_deletedAt_idx" ON "orders"("deletedAt");
