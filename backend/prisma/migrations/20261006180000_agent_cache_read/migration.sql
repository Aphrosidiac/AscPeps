-- How much of a thread's input the provider served from its prefix cache, so
-- the hit rate can be read: SUM("cacheReadTokens") / SUM("inputTokens").
-- Counted from this migration on; older turns stay at 0.
ALTER TABLE "agent_threads" ADD COLUMN "cacheReadTokens" INTEGER NOT NULL DEFAULT 0;
