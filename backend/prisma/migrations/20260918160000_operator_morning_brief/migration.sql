-- Who gets the morning brief is chosen per operator, not "everyone on the
-- allowlist". Defaults on, which is what the brief did before.
ALTER TABLE "whatsapp_operators" ADD COLUMN "morningBrief" BOOLEAN NOT NULL DEFAULT true;
