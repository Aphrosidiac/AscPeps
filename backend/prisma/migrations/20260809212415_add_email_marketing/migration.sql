-- CreateEnum
CREATE TYPE "SubscriberStatus" AS ENUM ('SUBSCRIBED', 'UNSUBSCRIBED');

-- CreateEnum
CREATE TYPE "SubscriberSource" AS ENUM ('FOOTER', 'CHECKOUT', 'ADMIN');

-- CreateEnum
CREATE TYPE "CampaignAudience" AS ENUM ('ALL', 'BUYERS', 'NON_BUYERS');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SENDING', 'SENT');

-- AlterEnum
-- Safe inside Prisma's per-migration transaction on PostgreSQL 12+: adding an
-- enum value is transactional there, and the restriction that remains (the new
-- value cannot be *used* in the same transaction that added it) does not apply
-- here — nothing below writes an ABANDONED_CHECKOUT row.
ALTER TYPE "EmailType" ADD VALUE 'ABANDONED_CHECKOUT';

-- CreateTable
CREATE TABLE "subscribers" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "SubscriberStatus" NOT NULL DEFAULT 'SUBSCRIBED',
    "source" "SubscriberSource" NOT NULL,
    "unsubscribeToken" TEXT NOT NULL,
    "unsubscribedAt" TIMESTAMP(3),
    "unsubscribeReason" TEXT,
    "welcomeSentAt" TIMESTAMP(3),
    "welcomeAttempts" INTEGER NOT NULL DEFAULT 0,
    "welcomeError" TEXT,
    "welcomeDiscountCodeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "preheader" TEXT,
    "body" TEXT NOT NULL,
    "ctaLabel" TEXT,
    "ctaUrl" TEXT,
    "audience" "CampaignAudience" NOT NULL DEFAULT 'ALL',
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_recipients" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "resendId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscribers_email_key" ON "subscribers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "subscribers_unsubscribeToken_key" ON "subscribers"("unsubscribeToken");

-- CreateIndex
CREATE UNIQUE INDEX "subscribers_welcomeDiscountCodeId_key" ON "subscribers"("welcomeDiscountCodeId");

-- CreateIndex
CREATE INDEX "subscribers_status_idx" ON "subscribers"("status");

-- CreateIndex
CREATE INDEX "subscribers_welcomeSentAt_idx" ON "subscribers"("welcomeSentAt");

-- CreateIndex
CREATE INDEX "campaigns_status_idx" ON "campaigns"("status");

-- CreateIndex
CREATE INDEX "campaign_recipients_status_nextAttemptAt_idx" ON "campaign_recipients"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "campaign_recipients_resendId_idx" ON "campaign_recipients"("resendId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_recipients_campaignId_subscriberId_key" ON "campaign_recipients"("campaignId", "subscriberId");

-- AddForeignKey
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_welcomeDiscountCodeId_fkey" FOREIGN KEY ("welcomeDiscountCodeId") REFERENCES "discount_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "subscribers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
