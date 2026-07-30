-- Closes a long-standing migration drift: `orders.trackingNumber` has existed
-- in production since before the migration history was squashed into
-- 0_baseline, but no tracked migration ever created it. Every `prisma migrate
-- dev` since has re-detected it as an unexplained difference and demanded a
-- database reset, which meant hand-stripping it out of each generated
-- migration. IF NOT EXISTS makes this a no-op on dev and production (where the
-- column is already there) while giving a fresh database the column the schema
-- expects — after this, history and reality finally agree.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "trackingNumber" TEXT;


-- CreateTable
CREATE TABLE "whatsapp_operators" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "canWrite" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_operators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_groups" (
    "id" TEXT NOT NULL,
    "groupJid" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "requireMention" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_conversations" (
    "id" TEXT NOT NULL,
    "chatKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "senderPhone" TEXT,
    "senderName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_tool_calls" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT,
    "actorPhone" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "result" TEXT NOT NULL,
    "destructive" BOOLEAN NOT NULL DEFAULT false,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_tool_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_pending_actions" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "actorPhone" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_pending_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_operators_phone_key" ON "whatsapp_operators"("phone");

-- CreateIndex
CREATE INDEX "whatsapp_operators_active_idx" ON "whatsapp_operators"("active");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_groups_groupJid_key" ON "whatsapp_groups"("groupJid");

-- CreateIndex
CREATE INDEX "whatsapp_groups_active_idx" ON "whatsapp_groups"("active");

-- CreateIndex
CREATE UNIQUE INDEX "agent_conversations_chatKey_key" ON "agent_conversations"("chatKey");

-- CreateIndex
CREATE INDEX "agent_conversations_lastMessageAt_idx" ON "agent_conversations"("lastMessageAt");

-- CreateIndex
CREATE INDEX "agent_messages_conversationId_createdAt_idx" ON "agent_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_tool_calls_createdAt_idx" ON "agent_tool_calls"("createdAt");

-- CreateIndex
CREATE INDEX "agent_tool_calls_toolName_idx" ON "agent_tool_calls"("toolName");

-- CreateIndex
CREATE INDEX "agent_tool_calls_actorPhone_idx" ON "agent_tool_calls"("actorPhone");

-- CreateIndex
CREATE INDEX "agent_pending_actions_conversationId_idx" ON "agent_pending_actions"("conversationId");

-- CreateIndex
CREATE INDEX "agent_pending_actions_expiresAt_idx" ON "agent_pending_actions"("expiresAt");

-- AddForeignKey
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "agent_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_pending_actions" ADD CONSTRAINT "agent_pending_actions_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "agent_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

