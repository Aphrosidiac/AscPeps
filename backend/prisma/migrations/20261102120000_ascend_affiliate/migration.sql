-- Ascend Affiliate (docs/affiliate.md): affiliates, their commission ledger
-- and payouts; orders carry the affiliate, the rate at checkout and the net
-- commission; members carry their one-time sign-up bonus code. Additive only.
-- Prisma's diff also wants to drop the two pg_trgm order indexes: they are
-- real but not in the schema file, so they are left out, as in 20261031120000.

-- CreateEnum
CREATE TYPE "AffiliateStatus" AS ENUM ('APPLIED', 'ACTIVE', 'PAUSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AffiliateEntryKind" AS ENUM ('COMMISSION', 'REVERSAL', 'PAYOUT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "AffiliatePayoutStatus" AS ENUM ('REQUESTED', 'PAID', 'CANCELLED');



-- AlterTable
ALTER TABLE "members" ADD COLUMN     "signupBonusCodeId" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "affiliateCommission" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "affiliateId" TEXT,
ADD COLUMN     "affiliateRateBps" INTEGER;

-- CreateTable
CREATE TABLE "affiliates" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "status" "AffiliateStatus" NOT NULL DEFAULT 'APPLIED',
    "rateBps" INTEGER NOT NULL,
    "discountCodeId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "channel" TEXT,
    "bankName" TEXT,
    "bankAccountName" TEXT,
    "bankAccountNumber" TEXT,
    "adminNote" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_entries" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "kind" "AffiliateEntryKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "orderId" TEXT,
    "payoutId" TEXT,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliate_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_payouts" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "status" "AffiliatePayoutStatus" NOT NULL DEFAULT 'REQUESTED',
    "amount" INTEGER NOT NULL,
    "paidAmount" INTEGER,
    "availableAt" TIMESTAMP(3) NOT NULL,
    "bankName" TEXT NOT NULL,
    "bankAccountName" TEXT NOT NULL,
    "bankAccountNumber" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3),
    "paidBy" TEXT,
    "reference" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "affiliates_memberId_key" ON "affiliates"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "affiliates_discountCodeId_key" ON "affiliates"("discountCodeId");

-- CreateIndex
CREATE INDEX "affiliates_status_idx" ON "affiliates"("status");

-- CreateIndex
CREATE INDEX "affiliate_entries_affiliateId_createdAt_idx" ON "affiliate_entries"("affiliateId", "createdAt");

-- CreateIndex
CREATE INDEX "affiliate_entries_orderId_idx" ON "affiliate_entries"("orderId");

-- CreateIndex
CREATE INDEX "affiliate_payouts_affiliateId_status_idx" ON "affiliate_payouts"("affiliateId", "status");

-- CreateIndex
CREATE INDEX "affiliate_payouts_status_idx" ON "affiliate_payouts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "members_signupBonusCodeId_key" ON "members"("signupBonusCodeId");

-- CreateIndex
CREATE INDEX "orders_affiliateId_idx" ON "orders"("affiliateId");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "affiliates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_signupBonusCodeId_fkey" FOREIGN KEY ("signupBonusCodeId") REFERENCES "discount_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliates" ADD CONSTRAINT "affiliates_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliates" ADD CONSTRAINT "affiliates_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "discount_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_entries" ADD CONSTRAINT "affiliate_entries_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "affiliates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_entries" ADD CONSTRAINT "affiliate_entries_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_entries" ADD CONSTRAINT "affiliate_entries_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "affiliate_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_payouts" ADD CONSTRAINT "affiliate_payouts_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "affiliates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
