-- Rename the flat one-row-per-size products table to product_variants.
-- Every existing SKU row (id, code, price, stock, etc.) is preserved as-is —
-- OrderItem and ProductAddOn.addOnId foreign keys keep resolving to the same
-- ids with zero data migration. Columns that move up to the new parent
-- Product table below (name, slug, categoryId, description, benefits,
-- dosageInfo, coaUrl, featured, sortOrder, addOnReminder) are intentionally
-- left in place for now — the backfill script reads them to construct
-- parent rows — and are dropped in a later cleanup migration once that
-- backfill is verified.
ALTER TABLE "products" RENAME TO "product_variants";

ALTER TABLE "product_variants" RENAME CONSTRAINT "products_pkey" TO "product_variants_pkey";
ALTER TABLE "product_variants" RENAME CONSTRAINT "products_categoryId_fkey" TO "product_variants_categoryId_fkey";

ALTER INDEX "products_active_idx" RENAME TO "product_variants_active_idx";
ALTER INDEX "products_categoryId_idx" RENAME TO "product_variants_categoryId_idx";
ALTER INDEX "products_code_key" RENAME TO "product_variants_code_key";
-- Renamed out of the way (not dropped yet) so the new parent table below can
-- claim the "products_slug_key" name — this old one is dropped in the
-- cleanup migration once the backfill has moved slug to the parent.
ALTER INDEX "products_slug_key" RENAME TO "product_variants_slug_key_deprecated";

-- New parent product-line table — starts empty, populated by the backfill script.
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "description" TEXT,
    "benefits" TEXT,
    "dosageInfo" TEXT,
    "coaUrl" TEXT,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "addOnReminder" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");
CREATE INDEX "products_categoryId_idx" ON "products"("categoryId");
CREATE INDEX "products_active_idx" ON "products"("active");

ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Nullable for now — the backfill script populates this for every existing
-- variant row; a later cleanup migration makes it NOT NULL once verified.
ALTER TABLE "product_variants" ADD COLUMN "productId" TEXT;
CREATE INDEX "product_variants_productId_idx" ON "product_variants"("productId");
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
