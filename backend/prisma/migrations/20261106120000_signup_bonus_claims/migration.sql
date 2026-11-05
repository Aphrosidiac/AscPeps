-- One sign-up bonus to an inbox, kept apart from the member.
CREATE TABLE "signup_bonus_claims" (
    "inbox" TEXT NOT NULL,
    "memberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signup_bonus_claims_pkey" PRIMARY KEY ("inbox")
);
