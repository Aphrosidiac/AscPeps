-- CreateTable
CREATE TABLE "agent_grounding_events" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT,
    "actorPhone" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "violations" TEXT NOT NULL,
    "repaired" BOOLEAN NOT NULL DEFAULT false,
    "suppressed" BOOLEAN NOT NULL DEFAULT false,
    "reply" TEXT NOT NULL,
    "toolsRan" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_grounding_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_grounding_events_createdAt_idx" ON "agent_grounding_events"("createdAt");

-- CreateIndex
CREATE INDEX "agent_grounding_events_actorPhone_idx" ON "agent_grounding_events"("actorPhone");
