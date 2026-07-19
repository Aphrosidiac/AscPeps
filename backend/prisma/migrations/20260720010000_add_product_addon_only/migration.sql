-- Separate "is this active at all" (also gates add-on eligibility) from
-- "does this have its own browsable storefront page" — a supply item can be
-- active (usable as a required add-on) while being hidden from the public
-- catalog and its own product page.
ALTER TABLE "products" ADD COLUMN "addOnOnly" BOOLEAN NOT NULL DEFAULT false;
