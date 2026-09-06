-- Drop the shadow snapshot on order lines.
--
-- The previous migration froze each line's shadow wording the first time a
-- sheet was produced, on the reasoning that a document already handed to
-- someone must stay reproducible. That reasoning does not apply here: the
-- internal summary never leaves the business and is regenerable on demand, so
-- the only thing freezing achieved was an old sheet quietly disagreeing with
-- the mapping an admin is looking at.
--
-- Resolution is now always live against product_variants."shadowSkuId".

ALTER TABLE "order_items" DROP CONSTRAINT IF EXISTS "order_items_shadow_snapshot_complete";
ALTER TABLE "order_items" DROP COLUMN IF EXISTS "shadowCode";
ALTER TABLE "order_items" DROP COLUMN IF EXISTS "shadowName";
