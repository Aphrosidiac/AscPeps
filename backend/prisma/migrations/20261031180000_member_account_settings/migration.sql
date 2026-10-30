-- Member account settings: change email (confirmed from the new inbox),
-- forgot / reset password, and signing other devices out after a password
-- change. Additive only.
--
-- Hand-written: Prisma's diff also wants to DROP the pg_trgm order-search
-- indexes, which are created outside the schema (see 20261031120000).

ALTER TABLE "members" ADD COLUMN "pendingEmail" TEXT;
ALTER TABLE "members" ADD COLUMN "emailChangeTokenHash" TEXT;
ALTER TABLE "members" ADD COLUMN "emailChangeExpiresAt" TIMESTAMP(3);
ALTER TABLE "members" ADD COLUMN "resetTokenHash" TEXT;
ALTER TABLE "members" ADD COLUMN "resetTokenExpiresAt" TIMESTAMP(3);
ALTER TABLE "members" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);

CREATE INDEX "members_emailChangeTokenHash_idx" ON "members"("emailChangeTokenHash");
CREATE INDEX "members_resetTokenHash_idx" ON "members"("resetTokenHash");
