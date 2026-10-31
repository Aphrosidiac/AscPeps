-- Pre-order (sold-out sizes can still be bought, shipped on restock) and
-- Group Buy (time-boxed batches with their own wholesale tiers). See
-- docs/preorder.md and docs/group-buy.md.
--
-- Hand-checked: Prisma's diff wants to DROP the two pg_trgm order-search
-- indexes (they live outside the schema, see 20260817024500); those lines are
-- left out on purpose. Every statement is additive.

-- AlterTable
ALTER TABLE "discount_codes" ADD COLUMN "boundEmail" TEXT,
ADD COLUMN "groupBuyId" TEXT,
ADD COLUMN "scope" TEXT;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN "packSize" INTEGER,
ADD COLUMN "preorderQty" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "groupBuyId" TEXT,
ADD COLUMN     "isPreorder" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "preorder" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "group_buys" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "tagline" TEXT,
    "description" TEXT,
    "heroImageUrl" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "shipEstimate" TEXT,
    "minOrderAmount" INTEGER,
    "maxUnitsPerOrder" INTEGER NOT NULL DEFAULT 500,
    "shippingFee" INTEGER,
    "allowWhatsapp" BOOLEAN NOT NULL DEFAULT false,
    "joinedMode" TEXT NOT NULL DEFAULT 'OFF',
    "joinedBoost" INTEGER NOT NULL DEFAULT 0,
    "joinedFixed" INTEGER NOT NULL DEFAULT 0,
    "joinedLabel" TEXT NOT NULL DEFAULT 'people have joined this batch',
    "bannerEnabled" BOOLEAN NOT NULL DEFAULT false,
    "bannerText" TEXT,
    "bannerCta" TEXT,
    "bannerStartsAt" TIMESTAMP(3),
    "bannerEndsAt" TIMESTAMP(3),
    "bannerTone" TEXT NOT NULL DEFAULT 'INK',
    "popupEnabled" BOOLEAN NOT NULL DEFAULT false,
    "popupTitle" TEXT,
    "popupBody" TEXT,
    "popupImageUrl" TEXT,
    "popupCta" TEXT,
    "popupStartsAt" TIMESTAMP(3),
    "popupEndsAt" TIMESTAMP(3),
    "popupDelaySec" INTEGER NOT NULL DEFAULT 4,
    "popupFrequency" TEXT NOT NULL DEFAULT 'DAILY',
    "popupPages" TEXT NOT NULL DEFAULT 'ALL',
    "homeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "homeTitle" TEXT,
    "homeBody" TEXT,
    "homeImageUrl" TEXT,
    "homeCta" TEXT,
    "rewardEnabled" BOOLEAN NOT NULL DEFAULT false,
    "rewardType" TEXT NOT NULL DEFAULT 'PERCENTAGE',
    "rewardValue" INTEGER NOT NULL DEFAULT 0,
    "rewardScope" TEXT NOT NULL DEFAULT 'GROUP_BUY',
    "rewardMinOrder" INTEGER,
    "rewardValidDays" INTEGER,
    "rewardMembersOnly" BOOLEAN NOT NULL DEFAULT false,
    "rewardHeadline" TEXT,
    "stages" JSONB NOT NULL,
    "stageKey" TEXT NOT NULL DEFAULT 'open',
    "notifyStageEmails" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_buys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_buy_items" (
    "id" TEXT NOT NULL,
    "groupBuyId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "sellUnit" TEXT NOT NULL DEFAULT 'VIAL',
    "packSize" INTEGER NOT NULL DEFAULT 10,
    "unitLabel" TEXT,
    "minQty" INTEGER,
    "maxQty" INTEGER,
    "minAmount" INTEGER,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "group_buy_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_buy_tiers" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "minQty" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,

    CONSTRAINT "group_buy_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_buy_signups" (
    "id" TEXT NOT NULL,
    "groupBuyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "memberId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'PAGE',
    "discountCodeId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_buy_signups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_buy_notices" (
    "id" TEXT NOT NULL,
    "groupBuyId" TEXT NOT NULL,
    "orderId" TEXT,
    "signupId" TEXT,
    "kind" TEXT NOT NULL,
    "stageKey" TEXT,
    "toEmail" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_buy_notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "group_buys_number_key" ON "group_buys"("number");

-- CreateIndex
CREATE UNIQUE INDEX "group_buys_slug_key" ON "group_buys"("slug");

-- CreateIndex
CREATE INDEX "group_buys_published_opensAt_closesAt_idx" ON "group_buys"("published", "opensAt", "closesAt");

-- CreateIndex
CREATE INDEX "group_buy_items_groupBuyId_idx" ON "group_buy_items"("groupBuyId");

-- CreateIndex
CREATE UNIQUE INDEX "group_buy_items_groupBuyId_variantId_key" ON "group_buy_items"("groupBuyId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "group_buy_tiers_itemId_minQty_key" ON "group_buy_tiers"("itemId", "minQty");

-- CreateIndex
CREATE UNIQUE INDEX "group_buy_signups_discountCodeId_key" ON "group_buy_signups"("discountCodeId");

-- CreateIndex
CREATE INDEX "group_buy_signups_memberId_idx" ON "group_buy_signups"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "group_buy_signups_groupBuyId_email_key" ON "group_buy_signups"("groupBuyId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "group_buy_notices_dedupeKey_key" ON "group_buy_notices"("dedupeKey");

-- CreateIndex
CREATE INDEX "group_buy_notices_status_nextAttemptAt_idx" ON "group_buy_notices"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "group_buy_notices_groupBuyId_idx" ON "group_buy_notices"("groupBuyId");

-- CreateIndex
CREATE INDEX "orders_groupBuyId_idx" ON "orders"("groupBuyId");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_groupBuyId_fkey" FOREIGN KEY ("groupBuyId") REFERENCES "group_buys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_groupBuyId_fkey" FOREIGN KEY ("groupBuyId") REFERENCES "group_buys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_buy_items" ADD CONSTRAINT "group_buy_items_groupBuyId_fkey" FOREIGN KEY ("groupBuyId") REFERENCES "group_buys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_buy_items" ADD CONSTRAINT "group_buy_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_buy_tiers" ADD CONSTRAINT "group_buy_tiers_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "group_buy_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_buy_signups" ADD CONSTRAINT "group_buy_signups_groupBuyId_fkey" FOREIGN KEY ("groupBuyId") REFERENCES "group_buys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_buy_signups" ADD CONSTRAINT "group_buy_signups_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_buy_signups" ADD CONSTRAINT "group_buy_signups_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "discount_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_buy_notices" ADD CONSTRAINT "group_buy_notices_groupBuyId_fkey" FOREIGN KEY ("groupBuyId") REFERENCES "group_buys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_buy_notices" ADD CONSTRAINT "group_buy_notices_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
