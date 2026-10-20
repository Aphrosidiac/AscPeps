-- AlterTable
ALTER TABLE "order_items" ADD COLUMN "parentItemId" TEXT;

-- CreateIndex
CREATE INDEX "order_items_parentItemId_idx" ON "order_items"("parentItemId");

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_parentItemId_fkey" FOREIGN KEY ("parentItemId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
