-- Brand rename: "ASCEND" -> "Ascend MY" (long form "Ascend Peptides" where the
-- fuller name was already spelled out). No schema shape changes -- one column
-- default plus the stored brand strings.
--
-- Deliberately NOT touched: agent_messages.content and agent_tool_calls.result.
-- Those are historical WhatsApp agent transcripts; rewriting them would falsify
-- a log of what was actually said.

-- Default for new Insight rows (mirrors schema.prisma).
ALTER TABLE "insights" ALTER COLUMN "authorRole" SET DEFAULT 'Founder & CEO, Ascend MY';

-- Existing insight bylines.
UPDATE "insights"
SET "authorRole" = REPLACE(REPLACE("authorRole", 'ASCEND Peptides', 'Ascend Peptides'), 'ASCEND', 'Ascend MY')
WHERE "authorRole" LIKE '%ASCEND%';

-- Business name -- feeds the receipt PDF and the email header/footer.
UPDATE "settings"
SET "value" = 'Ascend MY'
WHERE "key" = 'business_name' AND "value" IN ('ASCEND', 'ASCEND MY');

-- Product copy. 40 rows name the brand, in four phrasings ("supplied by ASCEND
-- in Malaysia ...", "ASCEND supplies it ...", "Each ASCEND vial ...", "Supplied
-- by ASCEND as ..."), so this replaces the token rather than one sentence.
UPDATE "products"
SET "description" = REPLACE(REPLACE("description", 'ASCEND Peptides', 'Ascend Peptides'), 'ASCEND', 'Ascend MY')
WHERE "description" LIKE '%ASCEND%';
