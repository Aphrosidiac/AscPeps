/**
 * Import Teliti Peptides' research summaries (AscComp catalogue posts, kind
 * "research", English) into /research, so the section has real content to
 * check against. LOCAL USE ONLY: Teliti DECISIONS #19 forbids copied copy or
 * photos between the two brands, so these articles must be rewritten (and the
 * lead images replaced) before any of them goes live on Ascend.
 *
 * Safe to re-run: articles upsert by slug, sources by PMID/DOI.
 *
 *   set -a && . ./.env && set +a && npx tsx scripts/import-teliti-research.ts [path/to/AscComp]
 */
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { publicContent, type LiveArticle } from '../src/modules/research/research.rules.js';

const root = process.argv[2] ?? path.join(os.homedir(), 'Desktop/dev/AscComp');
const catalogue = path.join(root, 'apps/storefront/catalogue');
const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });

type Ref = { pmid: string | null; doi: string | null; url?: string; journal: string; year: number; title: string; finding: string };
type Post = {
  kind: string; locale: string; slug: string; h1: string; dek: string; body: string; products: string[];
  references: Ref[]; datePublished: string; dateModified: string; seo: { title: string; description: string };
  leadImage: { file: string; alt: string };
};

// Teliti product id → slug, then the Ascend product with that slug (if any).
const telitiSlug = new Map<string, string>();
for (const f of await readdir(path.join(catalogue, 'products'))) {
  const p = JSON.parse(await readFile(path.join(catalogue, 'products', f), 'utf8'));
  telitiSlug.set(f.replace(/\.json$/, ''), p.slug);
}
const ascend = new Map((await prisma.product.findMany({ where: { active: true }, select: { id: true, slug: true } })).map((p) => [p.slug, p.id]));

// Links into sections Ascend doesn't have keep their words and lose the link.
function relink(body: string) {
  return body.replace(/\[([^\]]+)\]\((\/[^)\s]*)\)/g, (whole, text: string, href: string) => {
    const product = /^\/products\/([a-z0-9-]+)$/.exec(href);
    if (product) return ascend.has(product[1]) ? whole : text;
    if (/^\/research\/[a-z0-9-]+$/.test(href)) return whole;
    return text;
  });
}

const uploads = path.join(process.cwd(), 'uploads', 'products');
await mkdir(uploads, { recursive: true });

const posts: Post[] = [];
for (const f of (await readdir(path.join(catalogue, 'posts'))).sort()) {
  const p = JSON.parse(await readFile(path.join(catalogue, 'posts', f), 'utf8')) as Post;
  if (p.kind === 'research' && p.locale === 'en') posts.push(p);
}

for (const p of posts) {
  const sourceIds: string[] = [];
  for (const r of p.references) {
    const key = r.pmid ? { pmid: r.pmid } : r.doi ? { doi: r.doi } : null;
    const data = { pmid: r.pmid, doi: r.doi, url: r.url ?? null, journal: r.journal, year: r.year, title: r.title };
    const existing = key ? await prisma.researchSource.findUnique({ where: key as { pmid: string } }) : null;
    const source = existing
      ? await prisma.researchSource.update({ where: { id: existing.id }, data })
      : await prisma.researchSource.create({ data });
    sourceIds.push(source.id);
  }

  const previous = await prisma.researchArticle.findUnique({ where: { slug: p.slug } });
  let lead = previous?.leadImageUrl ? { url: previous.leadImageUrl, width: previous.leadImageWidth, height: previous.leadImageHeight } : null;
  if (!lead) {
    const filename = `${randomUUID()}.webp`;
    const info = await sharp(path.join(catalogue, 'images', p.leadImage.file))
      .resize({ width: 1600, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(path.join(uploads, filename));
    lead = { url: `/uploads/products/${filename}`, width: info.width, height: info.height };
  }

  const data = {
    title: p.h1,
    dek: p.dek,
    body: relink(p.body),
    seoTitle: p.seo.title,
    seoDescription: p.seo.description,
    leadImageUrl: lead.url,
    leadImageWidth: lead.width,
    leadImageHeight: lead.height,
    leadImageAlt: p.leadImage.alt,
    datePublished: new Date(p.datePublished),
    relatedProductIds: p.products.map((id) => ascend.get(telitiSlug.get(id) ?? '')).filter((x): x is string => !!x),
  };
  const article = await prisma.$transaction(async (tx) => {
    const a = previous
      ? await tx.researchArticle.update({ where: { id: previous.id }, data })
      : await tx.researchArticle.create({ data: { ...data, slug: p.slug } });
    await tx.researchCitation.deleteMany({ where: { articleId: a.id } });
    await tx.researchCitation.createMany({
      data: p.references.map((r, i) => ({ articleId: a.id, sourceId: sourceIds[i], position: i + 1, finding: r.finding })),
    });
    // Published as Teliti has it: the live copy carries Teliti's own dates.
    const full = await tx.researchArticle.findUniqueOrThrow({
      where: { id: a.id },
      include: { author: true, reviewer: true, images: true, citations: { orderBy: { position: 'asc' }, include: { source: true } } },
    });
    const now = new Date();
    const live: LiveArticle = {
      ...publicContent(full),
      datePublished: new Date(p.datePublished).toISOString(),
      dateModified: new Date(p.dateModified).toISOString(),
      updatedAt: now.toISOString(),
    };
    await tx.researchArticle.update({ where: { id: a.id }, data: { live, liveAt: now, slugLockedAt: a.slugLockedAt ?? now } });
    return a;
  });
  console.log(`${previous ? 'updated' : 'created'} /research/${article.slug} (${p.references.length} studies, ${data.relatedProductIds.length} products)`);
}
await prisma.$disconnect();
