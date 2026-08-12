-- Records WHY an online order ended up FAILED, so a customer who tried to pay
-- and was refused is distinguishable from one who never chose a payment method.
-- Nullable with no default: existing rows are genuinely unknown until the
-- backfill script re-queries the gateway for them, and "unknown" must not be
-- silently rendered as "never attempted".
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "paymentFailureReason" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "paymentFailureChannel" TEXT;
