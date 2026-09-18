-- A group can receive the morning brief too. Off by default: it reaches
-- everyone in the room, so it is switched on per group.
ALTER TABLE "whatsapp_groups" ADD COLUMN "morningBrief" BOOLEAN NOT NULL DEFAULT false;
