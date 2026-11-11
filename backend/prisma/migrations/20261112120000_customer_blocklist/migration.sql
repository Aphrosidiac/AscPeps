-- Blocked customers: a person plus every identifier they've been seen with.
CREATE TYPE "BlockKind" AS ENUM ('EMAIL', 'PHONE', 'ADDRESS', 'NETWORK');

CREATE TABLE "blocked_customers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reason" TEXT,
    "createdBy" TEXT,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "lastHitAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "blocked_customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "block_entries" (
    "id" TEXT NOT NULL,
    "blockedCustomerId" TEXT NOT NULL,
    "kind" "BlockKind" NOT NULL,
    "value" TEXT NOT NULL,
    "display" TEXT NOT NULL,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "block_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "block_attempts" (
    "id" TEXT NOT NULL,
    "blockedCustomerId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ip" TEXT,
    "matched" TEXT[],
    "learnt" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "block_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "block_entries_blockedCustomerId_idx" ON "block_entries"("blockedCustomerId");
CREATE UNIQUE INDEX "block_entries_kind_value_key" ON "block_entries"("kind", "value");
CREATE INDEX "block_attempts_blockedCustomerId_createdAt_idx" ON "block_attempts"("blockedCustomerId", "createdAt");

ALTER TABLE "block_entries" ADD CONSTRAINT "block_entries_blockedCustomerId_fkey" FOREIGN KEY ("blockedCustomerId") REFERENCES "blocked_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "block_attempts" ADD CONSTRAINT "block_attempts_blockedCustomerId_fkey" FOREIGN KEY ("blockedCustomerId") REFERENCES "blocked_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
