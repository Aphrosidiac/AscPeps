-- AlterTable
ALTER TABLE "product_add_ons" ADD COLUMN     "required" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "quantity" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "addOnReminder" TEXT;
