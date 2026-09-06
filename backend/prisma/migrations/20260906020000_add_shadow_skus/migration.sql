-- Shadow SKUs: a neutral, deliberately less-specific name a real SKU can be
-- listed under on internal paperwork.
--
-- The storefront, cart, checkout, customer receipt and confirmation email are
-- untouched by this and keep the real product name. A shadow renames a line on
-- an internal summary and nothing else — no shadow carries its own price,
-- quantity or order number, so every document built from these reduces back to
-- its real order by orderNumber.

CREATE TABLE "shadow_skus" (
    "id" TEXT NOT NULL,
    -- The shadow's own SKU string, e.g. "LR-0042".
    "code" TEXT NOT NULL,
    -- What the line reads as. Keep the size in it ("Research peptide, 10mg
    -- vial") — a bare code forces the reader to decode it against a mapping
    -- they probably do not have.
    "name" TEXT NOT NULL,
    "description" TEXT,
    -- Retirement is deactivation, never deletion: a shadow named in any
    -- order_items snapshot below must stay resolvable forever.
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shadow_skus_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shadow_skus_code_key" ON "shadow_skus"("code");
CREATE INDEX "shadow_skus_active_idx" ON "shadow_skus"("active");

-- Many variants deliberately share one shadow (every 5mg vial can collapse to
-- a single generic line), so this is a plain FK and not a unique one. NULL
-- means unmapped, which is a real state: a renderer asked for the shadow name
-- of an unmapped SKU refuses rather than falling back to the real name.
ALTER TABLE "product_variants" ADD COLUMN "shadowSkuId" TEXT;

CREATE INDEX "product_variants_shadowSkuId_idx" ON "product_variants"("shadowSkuId");

-- ON DELETE SET NULL, not CASCADE: removing a shadow code must never take
-- sellable SKUs with it. Unlinking is exactly this.
ALTER TABLE "product_variants"
    ADD CONSTRAINT "product_variants_shadowSkuId_fkey"
    FOREIGN KEY ("shadowSkuId") REFERENCES "shadow_skus"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- The snapshot. Captured the first time a shadow-named document is produced
-- for the order, and frozen thereafter for the same reason order_items."unitCost"
-- is frozen: re-pointing a SKU's shadow next year must not retroactively change
-- the meaning of a sheet already printed.
ALTER TABLE "order_items" ADD COLUMN "shadowCode" TEXT;
ALTER TABLE "order_items" ADD COLUMN "shadowName" TEXT;

-- Both together or neither. A half-written snapshot would silently resolve one
-- field live and the other frozen, which is the worst of both.
ALTER TABLE "order_items"
    ADD CONSTRAINT "order_items_shadow_snapshot_complete"
    CHECK (("shadowCode" IS NULL) = ("shadowName" IS NULL));
