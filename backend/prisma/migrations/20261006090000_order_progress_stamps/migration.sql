-- When an order reached each step of the customer's tracking pipeline.
-- Stamped by a trigger so that every writer of status / paymentStatus is
-- covered, including ones added later. Times are UTC wall-clock to match
-- Prisma's TIMESTAMP(3) columns, whatever the session time zone is.
ALTER TABLE "orders"
  ADD COLUMN "paidAt" TIMESTAMP(3),
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "shippedAt" TIMESTAMP(3),
  ADD COLUMN "deliveredAt" TIMESTAMP(3),
  ADD COLUMN "cancelledAt" TIMESTAMP(3);

CREATE OR REPLACE FUNCTION orders_stamp_progress() RETURNS trigger AS $$
DECLARE
  ts TIMESTAMP(3) := (now() AT TIME ZONE 'UTC');
BEGIN
  IF NEW."paymentStatus" IS DISTINCT FROM OLD."paymentStatus" THEN
    IF NEW."paymentStatus" = 'PAID' THEN
      NEW."paidAt" := COALESCE(NEW."paidAt", ts);
    ELSIF NEW."paymentStatus" IN ('UNPAID', 'FAILED') THEN
      NEW."paidAt" := NULL;
    END IF;
    -- REFUNDED keeps paidAt: the payment did happen.
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF NEW."status" = 'CANCELLED' THEN
      NEW."cancelledAt" := ts;
    ELSE
      NEW."cancelledAt" := NULL;
      -- Entering a step stamps it (keeping an earlier stamp if the order is
      -- only coming back to it); everything after the new step is cleared, so
      -- a mis-click to Shipped that is undone leaves no false "shipped" time.
      IF NEW."status" = 'PENDING' THEN
        NEW."confirmedAt" := NULL; NEW."shippedAt" := NULL; NEW."deliveredAt" := NULL;
      ELSIF NEW."status" = 'CONFIRMED' THEN
        NEW."confirmedAt" := COALESCE(NEW."confirmedAt", ts);
        NEW."shippedAt" := NULL; NEW."deliveredAt" := NULL;
      ELSIF NEW."status" = 'SHIPPED' THEN
        NEW."shippedAt" := COALESCE(NEW."shippedAt", ts);
        NEW."deliveredAt" := NULL;
      ELSIF NEW."status" = 'DELIVERED' THEN
        NEW."deliveredAt" := COALESCE(NEW."deliveredAt", ts);
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_stamp_progress
  BEFORE UPDATE OF "status", "paymentStatus" ON "orders"
  FOR EACH ROW EXECUTE FUNCTION orders_stamp_progress();

-- Backfill only what is actually known; everything else stays NULL and the
-- tracking page shows the step without a time.
--
-- Paid: the hosted page records when it was approved, and the receipt email is
-- enqueued in the same transaction as the PAID update on every other path.
UPDATE "orders" o SET "paidAt" = COALESCE(
  (SELECT s."paidAt" FROM "mpg_checkout_sessions" s
    WHERE s."reference" = o."orderNumber" AND s."paidAt" IS NOT NULL
    ORDER BY s."paidAt" LIMIT 1),
  (SELECT e."createdAt" FROM "email_outbox" e
    WHERE e."orderId" = o."id" AND e."type" = 'PAYMENT_RECEIPT')
)
WHERE o."paymentStatus" IN ('PAID', 'REFUNDED');

-- Online payments confirm the order in the same update that marks it paid.
UPDATE "orders" SET "confirmedAt" = "paidAt"
WHERE "paymentMethod" IN ('BILLPLZ', 'CRYPTO') AND "paidAt" IS NOT NULL
  AND "status" IN ('CONFIRMED', 'SHIPPED', 'DELIVERED');

-- Hand deliveries record when the run finished.
UPDATE "orders" o SET "deliveredAt" = b."completedAt"
FROM "delivery_bookings" b
WHERE b."orderId" = o."id" AND b."status" = 'COMPLETED' AND b."completedAt" IS NOT NULL
  AND o."status" = 'DELIVERED';
