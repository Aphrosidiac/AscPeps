-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN "excludeOrderedWithinDays" INTEGER,
ADD COLUMN "excludeOpenOrders" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "excludeBoughtProductIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "excludeEmails" TEXT[] DEFAULT ARRAY[]::TEXT[];
