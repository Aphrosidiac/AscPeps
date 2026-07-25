-- Adds the delivery-tracking statuses the Resend webhook
-- (modules/webhooks/resend-webhook.controller.ts) writes onto EmailOutbox
-- rows once a SENT message reaches a terminal delivery event
-- (email.delivered / email.bounced / email.complained).

-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EmailStatus" ADD VALUE 'DELIVERED';
ALTER TYPE "EmailStatus" ADD VALUE 'BOUNCED';
ALTER TYPE "EmailStatus" ADD VALUE 'COMPLAINED';
