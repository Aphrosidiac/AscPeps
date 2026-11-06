-- Whether the team has heard about this version of a details change.
ALTER TABLE "affiliate_change_requests" ADD COLUMN "notified" BOOLEAN NOT NULL DEFAULT false;
