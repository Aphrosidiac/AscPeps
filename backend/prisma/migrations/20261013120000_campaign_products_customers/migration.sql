-- AlterEnum
ALTER TYPE "SubscriberSource" ADD VALUE 'ORDER';

-- AlterEnum
ALTER TYPE "CampaignAudience" ADD VALUE 'CUSTOMERS';

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN "headline" TEXT,
ADD COLUMN "subhead" TEXT,
ADD COLUMN "badge" TEXT,
ADD COLUMN "productIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
