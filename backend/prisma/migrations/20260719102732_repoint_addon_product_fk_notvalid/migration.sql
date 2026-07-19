-- product_add_ons.productId currently still holds OLD variant ids (the flat
-- pre-rework meaning: "which row's page shows this add-on") and its FK still
-- points at product_variants from the previous migration. Repoint the FK to
-- the new parent `products` table now, but as NOT VALID — the existing rows'
-- values are still old variant ids, not parent ids, so a normally-validated
-- FK would reject them immediately. The backfill script rewrites every
-- row's productId to its real new parent id; the later cleanup migration
-- then runs VALIDATE CONSTRAINT once that's confirmed correct.
ALTER TABLE "product_add_ons" DROP CONSTRAINT "product_add_ons_productId_fkey";
ALTER TABLE "product_add_ons" ADD CONSTRAINT "product_add_ons_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
