-- The assistant's transcript moves onto one harness for every channel.
--
-- agent_conversations / agent_messages / agent_tool_calls /
-- agent_pending_actions become agent_threads / agent_messages /
-- agent_actions. History is carried over, not dropped: every WhatsApp
-- conversation becomes a thread of kind 'whatsapp', its text rows become
-- JSON transcript rows, its rolling summary becomes a compaction row, and
-- every audited tool call becomes an action classified by the registry as
-- it stood on 2026-09-18.

-- ── New tables ────────────────────────────────────────────────────────────

CREATE TABLE "agent_threads" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'chat',
    "title" TEXT NOT NULL DEFAULT 'New conversation',
    "chatKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "createdBy" TEXT,
    "model" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "turns" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "agent_threads_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "agent_threads_chatKey_key" ON "agent_threads"("chatKey");
CREATE INDEX "agent_threads_kind_lastMessageAt_idx" ON "agent_threads"("kind", "lastMessageAt");
CREATE INDEX "agent_threads_lastMessageAt_idx" ON "agent_threads"("lastMessageAt");

-- The old messages table keeps its name for the copy, then goes.
ALTER TABLE "agent_messages" RENAME TO "agent_messages_legacy";
ALTER INDEX IF EXISTS "agent_messages_pkey" RENAME TO "agent_messages_legacy_pkey";
ALTER INDEX IF EXISTS "agent_messages_conversationId_createdAt_idx" RENAME TO "agent_messages_legacy_conversationId_createdAt_idx";

CREATE TABLE "agent_messages" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "actorPhone" TEXT,
    "actorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_messages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "agent_messages_threadId_seq_key" ON "agent_messages"("threadId", "seq");
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "agent_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "agent_actions" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "callId" TEXT,
    "tool" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'done',
    "summary" TEXT,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "before" JSONB,
    "after" JSONB,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "actorPhone" TEXT,
    "actorName" TEXT,
    "expiresAt" TIMESTAMP(3),
    "undoneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_actions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "agent_actions_threadId_createdAt_idx" ON "agent_actions"("threadId", "createdAt");
CREATE INDEX "agent_actions_createdAt_idx" ON "agent_actions"("createdAt");
CREATE INDEX "agent_actions_tool_idx" ON "agent_actions"("tool");
CREATE INDEX "agent_actions_status_idx" ON "agent_actions"("status");
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "agent_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Carry the history over ────────────────────────────────────────────────

-- The legacy tables stored JSON as text, truncated on write. Parse what
-- parses; anything else is kept verbatim under "raw" rather than lost.
CREATE FUNCTION pg_temp.agent_try_jsonb(t TEXT) RETURNS JSONB AS $$
BEGIN
  RETURN t::jsonb;
EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('raw', t);
END;
$$ LANGUAGE plpgsql;

-- Conversations → threads. Same ids, so nothing else needs remapping.
INSERT INTO "agent_threads" ("id", "kind", "title", "chatKey", "status", "turns", "lastMessageAt", "createdAt", "updatedAt")
SELECT c."id", 'whatsapp', c."title", c."chatKey", 'idle', GREATEST(c."messageCount" / 2, 0), c."lastMessageAt", c."createdAt", c."updatedAt"
FROM "agent_conversations" c;

-- The rolling summary becomes a compaction row at seq 1 that stands in for
-- the first `summarizedCount` legacy rows (seq 2 .. summarizedCount + 1).
INSERT INTO "agent_messages" ("id", "threadId", "seq", "role", "content", "createdAt")
SELECT 'legacy_summary_' || c."id", c."id", 1, 'system',
       jsonb_build_object('summary', c."summary", 'replaces', jsonb_build_array(2, c."summarizedCount" + 1)),
       c."createdAt"
FROM "agent_conversations" c
WHERE c."summary" IS NOT NULL AND c."summary" <> '';

-- Text rows → JSON rows. Numbered after the summary row when one exists.
INSERT INTO "agent_messages" ("id", "threadId", "seq", "role", "content", "actorPhone", "actorName", "createdAt")
SELECT m."id", m."conversationId",
       ROW_NUMBER() OVER (PARTITION BY m."conversationId" ORDER BY m."createdAt", m."id")
         + CASE WHEN c."summary" IS NOT NULL AND c."summary" <> '' THEN 1 ELSE 0 END,
       m."role",
       CASE WHEN m."role" = 'user' AND m."senderName" IS NOT NULL
            THEN jsonb_build_object('text', m."content", 'sender', m."senderName")
            ELSE jsonb_build_object('text', m."content") END,
       m."senderPhone", m."senderName", m."createdAt"
FROM "agent_messages_legacy" m
JOIN "agent_conversations" c ON c."id" = m."conversationId";

-- Tool calls → actions. The tier is what the registry said on the day of the
-- migration; the legacy row only knew "destructive or not". Inputs and
-- results were stored as truncated JSON text: parse what parses, wrap what
-- does not.
INSERT INTO "agent_actions" ("id", "threadId", "callId", "tool", "tier", "status", "input", "output", "ok", "error", "latencyMs", "actorPhone", "createdAt")
SELECT t."id", t."conversationId", NULL, t."toolName",
       CASE
         WHEN t."destructive" THEN 'destructive'
         WHEN t."toolName" IN ('bulk_price_change','create_order','resend_order_email','delete_order','delete_expense','record_payout','delete_finance_record','delete_discount_code','delete_insight','update_setting','retry_failed_emails','manage_operator','manage_group','cancel_delivery','file_document','delete_document') THEN 'destructive'
         WHEN t."toolName" IN ('update_product','update_variant','adjust_stock','set_sale','manage_product_addons','update_order','set_order_costs','set_order_profit_shares','restore_order','save_partners','record_expense','record_funding','record_repayment','create_discount_code','update_discount_code','create_insight','update_insight','memory_block_append','memory_block_replace','schedule_delivery','update_delivery','set_reminder','cancel_reminder','update_document','set_shadow_mapping') THEN 'write'
         ELSE 'read'
       END,
       CASE WHEN t."ok" THEN 'done' ELSE 'failed' END,
       pg_temp.agent_try_jsonb(t."input"),
       pg_temp.agent_try_jsonb(t."result"),
       t."ok",
       CASE WHEN t."ok" THEN NULL ELSE LEFT(t."result", 500) END,
       t."durationMs", t."actorPhone", t."createdAt"
FROM "agent_tool_calls" t
WHERE t."conversationId" IS NOT NULL AND EXISTS (SELECT 1 FROM "agent_threads" th WHERE th."id" = t."conversationId");

-- Parked confirmations still inside their five minutes carry over as
-- pending; the rest were never going to be answered.
INSERT INTO "agent_actions" ("id", "threadId", "tool", "tier", "status", "summary", "input", "actorPhone", "expiresAt", "createdAt")
SELECT p."id", p."conversationId", p."toolName", 'destructive',
       CASE WHEN p."expiresAt" > NOW() THEN 'pending' ELSE 'expired' END,
       p."summary",
       pg_temp.agent_try_jsonb(p."input"),
       p."actorPhone", p."expiresAt", p."createdAt"
FROM "agent_pending_actions" p
WHERE EXISTS (SELECT 1 FROM "agent_threads" th WHERE th."id" = p."conversationId");

-- Grounding events pointed at the conversation; the thread keeps its id.
ALTER TABLE "agent_grounding_events" RENAME COLUMN "conversationId" TO "threadId";

-- ── Drop the old shape ────────────────────────────────────────────────────
DROP TABLE "agent_pending_actions";
DROP TABLE "agent_tool_calls";
DROP TABLE "agent_messages_legacy";
DROP TABLE "agent_conversations";
