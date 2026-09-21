-- Supplier price list: who the business buys from and what each of them
-- charges per unit of each SKU, so the unit cost on an order's costing sheet
-- is picked from a dropdown rather than typed from memory.
--
-- A price list, not purchasing. An order line records which supplier's price
-- it took and copies the figure onto its own unitCost at that moment; changing
-- a price here never rewrites an order already costed.

CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    -- Short, the way the partners say it: "Chris", "YL,C", "Zuwa".
    "name" TEXT NOT NULL,
    -- Retirement is deactivation, never deletion, once an order line names
    -- the supplier.
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "suppliers_name_key" ON "suppliers"("name");
CREATE INDEX "suppliers_active_idx" ON "suppliers"("active");

-- One supplier's per-unit price for one SKU, in cents. No row means "this
-- supplier does not sell this" — distinct from a price of zero.
CREATE TABLE "supplier_costs" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "cost" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_costs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supplier_costs_supplierId_variantId_key" ON "supplier_costs"("supplierId", "variantId");
CREATE INDEX "supplier_costs_variantId_idx" ON "supplier_costs"("variantId");

-- A price is nothing without its supplier or its SKU, and neither can be
-- deleted while an order line references it.
ALTER TABLE "supplier_costs" ADD CONSTRAINT "supplier_costs_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_costs" ADD CONSTRAINT "supplier_costs_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Whose price a costed order line took. Nullable, no backfill: every existing
-- line was keyed in by hand.
ALTER TABLE "order_items" ADD COLUMN "supplierId" TEXT;

CREATE INDEX "order_items_supplierId_idx" ON "order_items"("supplierId");

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
