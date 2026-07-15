-- CreateTable
CREATE TABLE "product_add_ons" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "addOnId" TEXT NOT NULL,

    CONSTRAINT "product_add_ons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_add_ons_productId_addOnId_key" ON "product_add_ons"("productId", "addOnId");

-- AddForeignKey
ALTER TABLE "product_add_ons" ADD CONSTRAINT "product_add_ons_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_add_ons" ADD CONSTRAINT "product_add_ons_addOnId_fkey" FOREIGN KEY ("addOnId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
