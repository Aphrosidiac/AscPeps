-- The document store: receipts, invoices, courier bills, bank slips, statements.
--
-- Replaces company_expenses."receiptUrl", which allowed exactly one file per
-- expense, was never wired to any UI (nothing has ever written it), and pointed
-- into the world-readable /uploads mount. Documents are stored outside that
-- directory and served only through an authenticated route.

CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL,
    -- The date printed on the document, not the upload time.
    "occurredAt" TIMESTAMP(3) NOT NULL,
    -- Cents. Nullable: not every document has an amount.
    "amount" INTEGER,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "documents_occurredAt_idx" ON "documents"("occurredAt");
CREATE INDEX "documents_kind_idx" ON "documents"("kind");

CREATE TABLE "document_links" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "orderId" TEXT,
    "expenseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_links_pkey" PRIMARY KEY ("id")
);

-- Exactly one target. Prisma's schema language cannot express this, so without
-- it a link row could point at nothing (invisible everywhere, undeletable from
-- the UI) or at both an order and an expense (counted twice in both places).
ALTER TABLE "document_links"
  ADD CONSTRAINT "document_links_one_target"
  CHECK (("orderId" IS NOT NULL)::int + ("expenseId" IS NOT NULL)::int = 1);

-- NULLs are distinct in Postgres, so each of these constrains only the rows
-- whose target is actually set — which is what stops the same document being
-- attached to the same order twice.
CREATE UNIQUE INDEX "document_links_documentId_orderId_key" ON "document_links"("documentId", "orderId");
CREATE UNIQUE INDEX "document_links_documentId_expenseId_key" ON "document_links"("documentId", "expenseId");
CREATE INDEX "document_links_orderId_idx" ON "document_links"("orderId");
CREATE INDEX "document_links_expenseId_idx" ON "document_links"("expenseId");

ALTER TABLE "document_links" ADD CONSTRAINT "document_links_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_expenseId_fkey"
  FOREIGN KEY ("expenseId") REFERENCES "company_expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Safe to drop unconditionally: verified empty on every environment, because no
-- code path has ever set it.
ALTER TABLE "company_expenses" DROP COLUMN "receiptUrl";
