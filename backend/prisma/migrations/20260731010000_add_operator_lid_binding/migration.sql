
-- AlterTable
ALTER TABLE "whatsapp_operators" ADD COLUMN     "lid" TEXT;

-- CreateTable
CREATE TABLE "whatsapp_unknown_senders" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "isLid" BOOLEAN NOT NULL DEFAULT false,
    "pushName" TEXT,
    "lastMessage" TEXT,
    "messageCount" INTEGER NOT NULL DEFAULT 1,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_unknown_senders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_unknown_senders_identifier_key" ON "whatsapp_unknown_senders"("identifier");

-- CreateIndex
CREATE INDEX "whatsapp_unknown_senders_lastSeenAt_idx" ON "whatsapp_unknown_senders"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_operators_lid_key" ON "whatsapp_operators"("lid");

