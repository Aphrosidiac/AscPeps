-- ManualPayGate: which link method a per-order payment link belongs to.
-- (Prisma's diff again wanted to DROP the two pg_trgm order-search indexes,
-- which live outside the schema; removed by hand.)

-- AlterTable
ALTER TABLE "mpg_checkout_sessions" ADD COLUMN     "paymentLinkProvider" TEXT;
