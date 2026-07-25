-- Transactional-email outbox (see EmailOutbox in schema.prisma): state
-- changes enqueue a row in the same transaction, a background worker drains
-- it via Resend. The (orderId, type) unique key makes double-fired payment
-- callbacks a no-op; the (status, nextAttemptAt) index serves the worker's
-- "due PENDING rows" poll.

-- CreateEnum
CREATE TYPE "EmailType" AS ENUM ('ORDER_CONFIRMATION', 'PAYMENT_RECEIPT');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "email_outbox" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "EmailType" NOT NULL,
    "toEmail" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "resendId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_outbox_status_nextAttemptAt_idx" ON "email_outbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "email_outbox_orderId_type_key" ON "email_outbox"("orderId", "type");

-- AddForeignKey
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
