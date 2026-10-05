-- The content hash of a filed document, so the same receipt is never filed
-- (or booked as an expense) twice. Existing rows are hashed by
-- scripts/backfill-document-hashes.ts, which reads the files on disk.
ALTER TABLE "documents" ADD COLUMN "sha256" TEXT;
CREATE INDEX "documents_sha256_idx" ON "documents"("sha256");
