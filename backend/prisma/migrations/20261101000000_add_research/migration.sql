-- Research summaries (/research): articles (a draft plus the published copy),
-- authors, a shared source library, per-article citations, photos placed
-- inside the article text, and the redirects of renamed or deleted URLs.
-- Purely additive: new tables only. Written by hand (Prisma's diff would also
-- try to drop the pg_trgm indexes).

CREATE TABLE "research_authors" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "credentials" TEXT,
    "bio" TEXT,
    "sameAs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_authors_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "research_authors_slug_key" ON "research_authors"("slug");

CREATE TABLE "research_articles" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dek" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "seoTitle" TEXT NOT NULL,
    "seoDescription" TEXT NOT NULL,
    "leadImageUrl" TEXT,
    "leadImageAlt" TEXT NOT NULL DEFAULT '',
    "leadImageWidth" INTEGER,
    "leadImageHeight" INTEGER,
    "authorId" TEXT,
    "reviewerId" TEXT,
    "datePublished" TIMESTAMP(3),
    "relatedProductIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "live" JSONB,
    "liveAt" TIMESTAMP(3),
    "slugLockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_articles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "research_articles_slug_key" ON "research_articles"("slug");
CREATE INDEX "research_articles_liveAt_idx" ON "research_articles"("liveAt");

-- SET NULL: deleting a person turns their articles back into organisation
-- bylines rather than deleting or orphaning them.
ALTER TABLE "research_articles"
    ADD CONSTRAINT "research_articles_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "research_authors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "research_articles"
    ADD CONSTRAINT "research_articles_reviewerId_fkey"
    FOREIGN KEY ("reviewerId") REFERENCES "research_authors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "research_sources" (
    "id" TEXT NOT NULL,
    "pmid" TEXT,
    "doi" TEXT,
    "url" TEXT,
    "journal" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_sources_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "research_sources_pmid_key" ON "research_sources"("pmid");
CREATE UNIQUE INDEX "research_sources_doi_key" ON "research_sources"("doi");

CREATE TABLE "research_citations" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "finding" TEXT NOT NULL,

    CONSTRAINT "research_citations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "research_citations_articleId_position_key" ON "research_citations"("articleId", "position");
CREATE UNIQUE INDEX "research_citations_articleId_sourceId_key" ON "research_citations"("articleId", "sourceId");
CREATE INDEX "research_citations_sourceId_idx" ON "research_citations"("sourceId");

-- CASCADE from the article (a citation means nothing without it); RESTRICT
-- from the source, so a study still cited somewhere can't vanish from a page.
ALTER TABLE "research_citations"
    ADD CONSTRAINT "research_citations_articleId_fkey"
    FOREIGN KEY ("articleId") REFERENCES "research_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_citations"
    ADD CONSTRAINT "research_citations_sourceId_fkey"
    FOREIGN KEY ("sourceId") REFERENCES "research_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "research_images" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "alt" TEXT NOT NULL DEFAULT '',
    "caption" TEXT,
    "credit" TEXT,
    "creditUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_images_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "research_images_articleId_idx" ON "research_images"("articleId");
ALTER TABLE "research_images"
    ADD CONSTRAINT "research_images_articleId_fkey"
    FOREIGN KEY ("articleId") REFERENCES "research_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "research_redirects" (
    "id" TEXT NOT NULL,
    "fromSlug" TEXT NOT NULL,
    "toPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_redirects_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "research_redirects_fromSlug_key" ON "research_redirects"("fromSlug");
