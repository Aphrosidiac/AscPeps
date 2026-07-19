-- CreateTable
CREATE TABLE "insights" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "coverImageUrl" TEXT,
    "authorName" TEXT NOT NULL DEFAULT 'Asywa',
    "authorRole" TEXT NOT NULL DEFAULT 'Founder & CEO, ASCEND',
    "citationTitle" TEXT,
    "citationSource" TEXT,
    "citationUrl" TEXT,
    "readTimeMinutes" INTEGER NOT NULL DEFAULT 1,
    "relatedProductIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "published" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "insights_slug_key" ON "insights"("slug");

-- CreateIndex
CREATE INDEX "insights_published_idx" ON "insights"("published");

-- CreateIndex
CREATE INDEX "insights_category_idx" ON "insights"("category");
