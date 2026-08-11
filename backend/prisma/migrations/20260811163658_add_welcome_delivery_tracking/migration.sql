-- AlterTable
ALTER TABLE "subscribers" ADD COLUMN     "welcomeResendId" TEXT,
ADD COLUMN     "welcomeStatus" "EmailStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "welcomeStatusAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "subscribers_welcomeResendId_idx" ON "subscribers"("welcomeResendId");
