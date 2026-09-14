-- ManualPayGate: hosted manual-payment checkout sessions + proof uploads.
-- (Prisma's diff also wanted to DROP the two pg_trgm search indexes on orders,
-- which live outside the schema; those statements were removed by hand.)

-- CreateTable
CREATE TABLE "mpg_checkout_sessions" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "lineItems" JSONB NOT NULL,
    "amounts" JSONB,
    "customer" JSONB,
    "successUrl" TEXT NOT NULL,
    "cancelUrl" TEXT,
    "paymentLinkUrl" TEXT,
    "metadata" JSONB,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mpg_checkout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mpg_payment_proofs" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rejectReason" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,

    CONSTRAINT "mpg_payment_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mpg_checkout_sessions_reference_idx" ON "mpg_checkout_sessions"("reference");

-- CreateIndex
CREATE INDEX "mpg_checkout_sessions_status_expiresAt_idx" ON "mpg_checkout_sessions"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "mpg_checkout_sessions_createdAt_idx" ON "mpg_checkout_sessions"("createdAt");

-- CreateIndex
CREATE INDEX "mpg_payment_proofs_sessionId_idx" ON "mpg_payment_proofs"("sessionId");

-- CreateIndex
CREATE INDEX "mpg_payment_proofs_status_idx" ON "mpg_payment_proofs"("status");

-- AddForeignKey
ALTER TABLE "mpg_payment_proofs" ADD CONSTRAINT "mpg_payment_proofs_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "mpg_checkout_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
