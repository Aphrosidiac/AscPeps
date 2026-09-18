-- A WhatsApp line the moment an order is created, to the operators and groups
-- that switch it on. Off by default for both: it is a message per order.
ALTER TABLE "whatsapp_operators" ADD COLUMN "orderNotify" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "whatsapp_groups" ADD COLUMN "orderNotify" BOOLEAN NOT NULL DEFAULT false;
