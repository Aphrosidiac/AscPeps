-- A manual discount's reason. Nullable, no backfill: code discounts carry
-- their reason on discount_codes, and every other existing order had none.
ALTER TABLE "orders" ADD COLUMN "discountNote" TEXT;
