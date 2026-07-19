-- Run only after scripts/migrate-products-to-variants.mjs --apply has been
-- run and verified (every product_variants row has a productId, every
-- product_add_ons row points at a real parent).

-- Confirm every product_add_ons.productId now resolves to a real parent —
-- this was left NOT VALID by the earlier FK-repoint migration specifically
-- so the backfill script could write real data before this check ran.
ALTER TABLE "product_add_ons" VALIDATE CONSTRAINT "product_add_ons_productId_fkey";

-- Every variant now has a parent — enforce it.
ALTER TABLE "product_variants" ALTER COLUMN "productId" SET NOT NULL;

-- categoryId moved to the parent Product table; drop its FK/index before the column.
ALTER TABLE "product_variants" DROP CONSTRAINT "product_variants_categoryId_fkey";
DROP INDEX "product_variants_categoryId_idx";

-- Drop every column that moved up to the parent Product table. Dropping
-- "slug" also drops its now-unused unique index (product_variants_slug_key_deprecated)
-- as a side effect — Postgres cascades index drops with their column.
ALTER TABLE "product_variants"
  DROP COLUMN "name",
  DROP COLUMN "slug",
  DROP COLUMN "categoryId",
  DROP COLUMN "description",
  DROP COLUMN "benefits",
  DROP COLUMN "dosageInfo",
  DROP COLUMN "coaUrl",
  DROP COLUMN "featured",
  DROP COLUMN "sortOrder",
  DROP COLUMN "addOnReminder";
