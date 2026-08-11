-- Always-in-context memory blocks for the WhatsApp agent.
CREATE TABLE "memory_blocks" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "charLimit" INTEGER NOT NULL DEFAULT 1500,
    "updatedBy" TEXT NOT NULL DEFAULT 'seed',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "memory_blocks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "memory_blocks_key_key" ON "memory_blocks"("key");

-- The four blocks, created empty. Empty is the honest starting state: the agent
-- has learned nothing yet, and seeding them with guesses would put invented
-- "facts" into the system prompt on day one.
INSERT INTO "memory_blocks" ("id", "key", "label", "charLimit", "position", "updatedAt") VALUES
  ('memblk_business',  'business',  'How the business runs',                     1500, 1, CURRENT_TIMESTAMP),
  ('memblk_people',    'people',    'People — who does what, how they work',     1200, 2, CURRENT_TIMESTAMP),
  ('memblk_suppliers', 'suppliers', 'Suppliers, sourcing and stock',             1200, 3, CURRENT_TIMESTAMP),
  ('memblk_decisions', 'decisions', 'Decisions taken and why (most recent first)', 1500, 4, CURRENT_TIMESTAMP);
