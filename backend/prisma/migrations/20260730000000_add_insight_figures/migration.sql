-- Labelled figures for Insights articles: image + caption + attribution,
-- rendered as a numbered grid below the article body.
--
-- Purely additive — a new table only, no change to `insights` itself, so
-- existing articles are untouched and keep rendering exactly as before.
CREATE TABLE "insight_figures" (
    "id" TEXT NOT NULL,
    "insightId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "altText" TEXT NOT NULL DEFAULT '',
    "credit" TEXT,
    "creditUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insight_figures_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "insight_figures_insightId_idx" ON "insight_figures"("insightId");

-- Two figures in one article must not claim the same printed number.
CREATE UNIQUE INDEX "insight_figures_insightId_order_key" ON "insight_figures"("insightId", "order");

-- ON DELETE CASCADE: a figure is meaningless without its article, and insights
-- are hard-deleted (unlike orders, which only ever soft-delete).
ALTER TABLE "insight_figures"
    ADD CONSTRAINT "insight_figures_insightId_fkey"
    FOREIGN KEY ("insightId") REFERENCES "insights"("id") ON DELETE CASCADE ON UPDATE CASCADE;
