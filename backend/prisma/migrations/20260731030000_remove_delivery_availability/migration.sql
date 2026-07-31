-- Removes the delivery availability layer (recurring windows + blackout dates).
--
-- It was modelled on Calendly, where declaring availability is the whole point
-- because strangers book against your calendar unsupervised. Asywa is the only
-- person booking these deliveries, so the layer only ever constrained her, had
-- to be maintained by her, and hard-blocked the common case: a customer asks
-- for a time outside the rules and it could not be entered at all.
--
-- Bookings are untouched — delivery_bookings holds the real schedule and does
-- not reference either table.
ALTER TABLE "delivery_windows" DROP CONSTRAINT IF EXISTS "delivery_windows_partnerId_fkey";
DROP TABLE IF EXISTS "delivery_blackouts";
DROP TABLE IF EXISTS "delivery_windows";
