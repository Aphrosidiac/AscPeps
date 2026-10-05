-- Files that passed through the assistant, in either direction. See the
-- AgentMedia model for why the extracted text is stored alongside.
CREATE TABLE "agent_media" (
    "id" TEXT NOT NULL,
    "threadId" TEXT,
    "direction" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storedName" TEXT,
    "text" TEXT,
    "textMethod" TEXT,
    "pages" INTEGER,
    "error" TEXT,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "source" TEXT,
    "purgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_media_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_media_threadId_createdAt_idx" ON "agent_media"("threadId", "createdAt");
CREATE INDEX "agent_media_direction_createdAt_idx" ON "agent_media"("direction", "createdAt");

ALTER TABLE "agent_media" ADD CONSTRAINT "agent_media_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "agent_threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
