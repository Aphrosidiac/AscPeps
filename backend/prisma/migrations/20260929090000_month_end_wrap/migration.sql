-- The month-end wrap's recipients. Seeded from the morning brief's, since the
-- operators asked for it "like the morning brief"; the routine itself stays
-- off until switched on in the Routines panel.
ALTER TABLE "whatsapp_operators" ADD COLUMN "monthEnd" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "whatsapp_groups" ADD COLUMN "monthEnd" BOOLEAN NOT NULL DEFAULT false;
UPDATE "whatsapp_operators" SET "monthEnd" = "morningBrief";
UPDATE "whatsapp_groups" SET "monthEnd" = "morningBrief";
