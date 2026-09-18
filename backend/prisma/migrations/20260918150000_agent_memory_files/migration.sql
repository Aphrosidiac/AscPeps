-- Memory becomes a directory of files. The four blocks seed core/: they were
-- the always-in-context memory before and stay that way, as files the
-- assistant can now edit surgically and the reflection can consolidate.

CREATE TABLE "agent_memory_files" (
    "path" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL DEFAULT 'seed',
    "updatedBy" TEXT NOT NULL DEFAULT 'seed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "agent_memory_files_pkey" PRIMARY KEY ("path")
);

INSERT INTO "agent_memory_files" ("path", "content", "createdBy", "updatedBy", "createdAt", "updatedAt")
SELECT 'core/' || b."key" || '.md',
       '# ' || b."label" || E'\n\n' || b."content",
       b."updatedBy", b."updatedBy", b."createdAt", b."updatedAt"
FROM "memory_blocks" b
WHERE btrim(b."content") <> ''
ORDER BY b."position";

DROP TABLE "memory_blocks";
