-- Reminders set through the WhatsApp agent.
--
-- Scheduled as rows plus a sweep (utils/reminder-sweep.ts) rather than an OS
-- cron entry per reminder: a row can be listed, cancelled and recovered, and
-- survives a redeploy. Same reasoning as the transactional email outbox.
CREATE TYPE "ReminderStatus" AS ENUM ('PENDING', 'SENT', 'CANCELLED', 'FAILED');

CREATE TABLE "agent_reminders" (
    "id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "topic" TEXT,
    "orderId" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    -- Same "dm:<phone>" / "group:<jid>" form as agent_conversations.chatKey, so
    -- "send it back to this conversation" is a straight copy of the key.
    "targetChatKey" TEXT NOT NULL,
    "targetLabel" TEXT NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdByPhone" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdInChatKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_reminders_pkey" PRIMARY KEY ("id")
);

-- The sweep's only query: due, still pending, ready to retry.
CREATE INDEX "agent_reminders_status_nextAttemptAt_idx" ON "agent_reminders"("status", "nextAttemptAt");
CREATE INDEX "agent_reminders_createdByPhone_status_idx" ON "agent_reminders"("createdByPhone", "status");
CREATE INDEX "agent_reminders_orderId_idx" ON "agent_reminders"("orderId");

-- SET NULL, not CASCADE: deleting an order must not silently delete a reminder
-- someone is relying on. The reminder survives with its message intact and
-- simply stops pointing at an order.
ALTER TABLE "agent_reminders"
  ADD CONSTRAINT "agent_reminders_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
