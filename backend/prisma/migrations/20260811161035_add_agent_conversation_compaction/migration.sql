-- AlterTable
ALTER TABLE "agent_conversations" ADD COLUMN     "summarizedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "summary" TEXT;
