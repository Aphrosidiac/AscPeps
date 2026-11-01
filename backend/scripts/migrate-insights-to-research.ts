/**
 * Move every Insights article into Research (Insights is retired: /insights
 * and /insights/<slug> 308 to /research and /research/<slug>, same slug).
 *
 * - The plain-text body becomes markdown: a numbered line ("1. Introduction",
 *   "4.2 Phase 2 Obesity Trial") or "Abstract" becomes a ## / ### heading, a
 *   block of short lines becomes a list, a "↓" chain becomes one line of "→".
 * - The article's one citation becomes a study in the library (by DOI), cited
 *   with no finding: the editor adds findings in Admin → Research.
 * - Figures become photos placed at the end of the text, as Insights showed them.
 * - The author becomes a Writers & reviewers record.
 * - A published article is published here with its Insights dates; a draft
 *   stays a draft. The pre-check is not run: what was live stays live as it was,
 *   and Admin → Research lists what to fix before the next publish.
 *
 * Safe to re-run: articles upsert by slug and are rebuilt from the Insights row.
 *
 *   set -a && . ./.env && set +a && npx tsx scripts/migrate-insights-to-research.ts
 */
import path from 'node:path';
import sharp from 'sharp';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { publicContent, type LiveArticle } from '../src/modules/research/research.rules.js';

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });

const HEADING = /^(?:(\d+)\.|(\d+\.\d+))\s+\S.{0,80}$/;

function toMarkdown(text: string): string {
  const out: string[] = [];
  for (const block of text.replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const rest: string[] = [];
    const flush = () => {
      if (rest.length === 1) out.push(rest[0]);
      else if (rest.length > 1 && rest.some((l) => l === '↓')) out.push(rest.filter((l) => l !== '↓').join(' → '));
      else if (rest.length > 1) out.push(rest.map((l) => `- ${l}`).join('\n'));
      rest.length = 0;
    };
    for (const line of lines) {
      const m = HEADING.exec(line);
      if (line === 'Abstract' || (m && !/[.:;?!]$/.test(line))) {
        flush();
        out.push(`${m?.[2] ? '###' : '##'} ${line}`);
      } else rest.push(line);
    }
    flush();
  }
  return out.join('\n\n');
}

const uploads = path.join(process.cwd(), 'uploads');
async function size(url: string) {
  const meta = await sharp(path.join(uploads, url.replace(/^\/uploads\//, ''))).metadata();
  return { width: meta.width ?? null, height: meta.height ?? null };
}

const insights = await prisma.insight.findMany({ include: { figures: { orderBy: { order: 'asc' } } }, orderBy: { createdAt: 'asc' } });

for (const i of insights) {
  const published = insights.find((x) => x.published && x.authorName === i.authorName) ?? i;
  const author = i.authorName
    ? await prisma.researchAuthor.upsert({
        where: { slug: i.authorName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') },
        // One record per person; the role the live article printed wins.
        update: {},
        create: {
          slug: i.authorName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
          name: i.authorName,
          role: published.authorRole,
        },
      })
    : null;

  const doi = i.citationUrl?.match(/10\.\d{4,9}\/[^\s?#/]+/)?.[0] ?? null;
  const source = i.citationTitle
    ? (doi && (await prisma.researchSource.findUnique({ where: { doi } }))) ||
      (await prisma.researchSource.create({
        data: {
          doi,
          url: doi ? null : i.citationUrl,
          journal: (i.citationSource ?? '').replace(/,\s*\d{4}$/, '').trim() || 'Unknown journal',
          year: Number(i.citationSource?.match(/\d{4}/)?.[0] ?? i.citationUrl?.match(/\b(19|20)\d{2}\b/)?.[0] ?? new Date(i.createdAt).getFullYear()),
          title: i.citationTitle,
        },
      }))
    : null;

  const lead = i.coverImageUrl ? await size(i.coverImageUrl) : null;
  const data = {
    title: i.title,
    dek: i.excerpt,
    body: toMarkdown(i.content),
    seoTitle: i.title,
    seoDescription: i.excerpt,
    leadImageUrl: i.coverImageUrl,
    leadImageAlt: '',
    leadImageWidth: lead?.width ?? null,
    leadImageHeight: lead?.height ?? null,
    authorId: author?.id ?? null,
    datePublished: i.publishedAt,
    relatedProductIds: i.relatedProductIds,
  };

  const article = await prisma.$transaction(async (tx) => {
    const previous = await tx.researchArticle.findUnique({ where: { slug: i.slug } });
    const a = previous
      ? await tx.researchArticle.update({ where: { id: previous.id }, data })
      : await tx.researchArticle.create({ data: { ...data, slug: i.slug } });
    await tx.researchCitation.deleteMany({ where: { articleId: a.id } });
    if (source) await tx.researchCitation.create({ data: { articleId: a.id, sourceId: source.id, position: 1, finding: '' } });
    await tx.researchImage.deleteMany({ where: { articleId: a.id } });
    const tokens: string[] = [];
    for (const f of i.figures) {
      const s = await size(f.imageUrl);
      const im = await tx.researchImage.create({
        data: { articleId: a.id, url: f.imageUrl, width: s.width ?? 1200, height: s.height ?? 800, alt: f.altText, caption: f.caption, credit: f.credit },
      });
      tokens.push(`{{image:${im.id}}}`);
    }
    if (tokens.length) await tx.researchArticle.update({ where: { id: a.id }, data: { body: `${data.body}\n\n${tokens.join('\n\n')}` } });

    if (!i.published || !i.publishedAt) {
      await tx.researchArticle.update({ where: { id: a.id }, data: { live: Prisma.DbNull, liveAt: null } });
      return a;
    }
    const full = await tx.researchArticle.findUniqueOrThrow({
      where: { id: a.id },
      include: { author: true, reviewer: true, images: true, citations: { orderBy: { position: 'asc' }, include: { source: true } } },
    });
    const now = new Date();
    const live: LiveArticle = {
      ...publicContent(full),
      datePublished: i.publishedAt.toISOString(),
      dateModified: i.updatedAt.toISOString(),
      updatedAt: now.toISOString(),
    };
    await tx.researchArticle.update({ where: { id: a.id }, data: { live, liveAt: now, slugLockedAt: a.slugLockedAt ?? now } });
    return a;
  });
  console.log(`${i.published ? 'published' : 'draft    '} /research/${article.slug} (${source ? 1 : 0} study, ${i.figures.length} photos)`);
}

await prisma.$disconnect();
