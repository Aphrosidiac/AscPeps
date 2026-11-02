-- Ascend Affiliate: affiliates ask to change their details; the team approves.
-- Additive only: one enum, one table.

-- CreateEnum
CREATE TYPE "AffiliateChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "affiliate_change_requests" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "status" "AffiliateChangeStatus" NOT NULL DEFAULT 'PENDING',
    "changes" JSONB NOT NULL,
    "previous" JSONB NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "affiliate_change_requests_affiliateId_status_idx" ON "affiliate_change_requests"("affiliateId", "status");

-- CreateIndex
CREATE INDEX "affiliate_change_requests_status_idx" ON "affiliate_change_requests"("status");

-- AddForeignKey
ALTER TABLE "affiliate_change_requests" ADD CONSTRAINT "affiliate_change_requests_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "affiliates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
