import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPaginationParams, paginatedResponse } from '../../utils/pagination.js';
import { notifyRevalidate } from '../../utils/revalidate.js';
import { Prisma } from '@prisma/client';
import { canonical, publicContent, publishIssues, publishState, slugRule, sourceSchema, imageTokenIds, type LiveArticle } from '../research/research.rules.js';

// Admin for /research: articles (drafts may be incomplete; publishing runs the
// checks in research.rules.ts), the shared source library, the people who
// write and review, and the photos placed inside an article's text.

const articleInclude = {
  author: true,
  reviewer: true,
  citations: { orderBy: { position: 'asc' as const }, include: { source: true } },
  images: { orderBy: { createdAt: 'asc' as const } },
};

const dateField = z.preprocess(
  (v) => (v === '' || v === undefined ? null : v),
  z.coerce.date().nullable()
);

// Saving writes the draft only, so a draft may be incomplete: the limits
// that matter are checked at publish (research.rules.ts). These only keep
// garbage out. `.optional()` everywhere: a PATCH is partial.
const draftSchema = z.object({
  title: z.string().max(200),
  slug: z.string().trim().max(120),
  dek: z.string().max(1000),
  body: z.string().max(200_000),
  seoTitle: z.string().max(200),
  seoDescription: z.string().max(500),
  leadImageUrl: z.string().trim().nullable(),
  leadImageAlt: z.string().max(400),
  leadImageWidth: z.number().int().positive().nullable(),
  leadImageHeight: z.number().int().positive().nullable(),
  authorId: z.string().nullable(),
  reviewerId: z.string().nullable(),
  datePublished: dateField,
  relatedProductIds: z.array(z.string()).max(12),
  // The complete, ordered list: array position is the printed number.
  citations: z.array(z.object({ sourceId: z.string().min(1), finding: z.string().max(600) })).max(60),
}).partial();

function slugify(text: string) {
  return text.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80).replace(/-$/, '');
}

type Loaded = NonNullable<Awaited<ReturnType<typeof load>>>;
const load = (fastify: FastifyInstance, id: string) => fastify.prisma.researchArticle.findUnique({ where: { id }, include: articleInclude });

/** The admin's view of an article: the draft, its publish state and what still blocks publishing. */
function view(a: Loaded) {
  const live = a.live as LiveArticle | null;
  return {
    ...a,
    live: undefined,
    path: `/research/${a.slug}`,
    publishState: publishState(a),
    livePath: live ? `/research/${live.slug}` : null,
    issues: publishIssues(a),
  };
}

export async function adminListResearch(fastify: FastifyInstance) {
  const rows = await fastify.prisma.researchArticle.findMany({ orderBy: [{ updatedAt: 'desc' }], include: articleInclude });
  return {
    data: rows.map((a) => ({
      id: a.id,
      slug: a.slug,
      title: a.title,
      path: `/research/${a.slug}`,
      publishState: publishState(a),
      issues: publishIssues(a).length,
      updatedAt: a.updatedAt,
      liveAt: a.liveAt,
    })),
  };
}

export async function adminGetResearch(fastify: FastifyInstance, id: string) {
  const a = await load(fastify, id);
  if (!a) throw { statusCode: 404, message: 'Research article not found' };
  return view(a);
}

/** A new article is a draft from its first save. Photos need an article to belong to, so the editor
 *  creates it the first time it saves (or the first time a photo is added). */
export async function adminCreateResearch(fastify: FastifyInstance, body: unknown) {
  const data = draftSchema.parse(body);
  const base = data.slug || slugify(data.title ?? '') || 'untitled';
  let slug = base;
  for (let n = 2; await fastify.prisma.researchArticle.findUnique({ where: { slug }, select: { id: true } }); n++) slug = `${base}-${n}`;
  const { citations, ...fields } = data;
  const created = await fastify.prisma.researchArticle.create({
    data: {
      title: '', dek: '', body: '', seoTitle: '', seoDescription: '',
      ...fields,
      slug,
      ...(citations?.length ? { citations: { create: citations.map((c, i) => ({ sourceId: c.sourceId, finding: c.finding, position: i + 1 })) } } : {}),
    },
  });
  return view((await load(fastify, created.id))!);
}

export async function adminUpdateResearch(fastify: FastifyInstance, id: string, body: unknown) {
  const { citations, ...data } = draftSchema.parse(body);
  const existing = await load(fastify, id);
  if (!existing) throw { statusCode: 404, message: 'Research article not found' };
  if (data.slug !== undefined && data.slug !== existing.slug) {
    if (existing.slugLockedAt) throw { statusCode: 409, message: 'The URL is locked since the first publish. Use Rename, which records a 301.' };
    const parsed = slugRule.safeParse(data.slug);
    if (!parsed.success) throw { statusCode: 400, message: 'Not a valid slug', details: [{ path: 'slug', message: 'Lowercase letters, digits and single hyphens.' }] };
    const taken = await fastify.prisma.researchArticle.findUnique({ where: { slug: data.slug }, select: { id: true } });
    if (taken) throw { statusCode: 409, message: 'Another article already uses this URL', details: [{ path: 'slug', message: 'Already in use.' }] };
  }
  if (citations && new Set(citations.map((c) => c.sourceId)).size !== citations.length) {
    throw { statusCode: 400, message: 'A study is cited twice', details: [{ path: 'citations', message: 'Each study once per article.' }] };
  }
  await fastify.prisma.$transaction(async (tx) => {
    if (citations !== undefined) {
      await tx.researchCitation.deleteMany({ where: { articleId: id } });
      if (citations.length) {
        await tx.researchCitation.createMany({ data: citations.map((c, i) => ({ articleId: id, sourceId: c.sourceId, finding: c.finding, position: i + 1 })) });
      }
    }
    await tx.researchArticle.update({ where: { id }, data });
  });
  return view((await load(fastify, id))!);
}

/** Copies the draft to the site. The first publish locks the URL and stamps the date; a later one
 *  moves "Updated" only when the article itself changed. */
export async function adminPublishResearch(fastify: FastifyInstance, id: string) {
  const a = await load(fastify, id);
  if (!a) throw { statusCode: 404, message: 'Research article not found' };
  const issues = publishIssues(a);
  if (issues.length) throw { statusCode: 400, message: `${issues.length} to fix before publishing`, details: issues };
  const now = new Date();
  const prev = a.live as LiveArticle | null;
  const content = publicContent(a);
  const datePublished = a.datePublished ?? now;
  const { datePublished: _p, dateModified: _m, updatedAt: _u, ...prevContent } = prev ?? ({} as LiveArticle);
  const sameText = prev && canonical({ ...prevContent, slug: content.slug }) === canonical(content);
  const live: LiveArticle = {
    ...content,
    datePublished: datePublished.toISOString(),
    dateModified: prev ? (sameText ? prev.dateModified : now.toISOString()) : datePublished.toISOString(),
    updatedAt: now.toISOString(),
  };
  await fastify.prisma.$transaction([
    fastify.prisma.researchArticle.update({
      where: { id },
      data: { live: live as unknown as Prisma.InputJsonValue, liveAt: now, datePublished, slugLockedAt: a.slugLockedAt ?? now },
    }),
    // A live article answers its own URL: no redirect may shadow it.
    fastify.prisma.researchRedirect.deleteMany({ where: { fromSlug: a.slug } }),
  ]);
  notifyRevalidate(['research']);
  return view((await load(fastify, id))!);
}

/** Takes the article off the site. The URL stays locked; publishing again brings it back. */
export async function adminUnpublishResearch(fastify: FastifyInstance, id: string) {
  const a = await fastify.prisma.researchArticle.findUnique({ where: { id }, select: { id: true } });
  if (!a) throw { statusCode: 404, message: 'Research article not found' };
  await fastify.prisma.researchArticle.update({ where: { id }, data: { live: Prisma.DbNull, liveAt: null } });
  notifyRevalidate(['research']);
  return view((await load(fastify, id))!);
}

/** Renames a locked URL: the old one 301s to the new one from now on (and any redirect that pointed
 *  at the old one is repointed, so a visitor never takes two hops). */
export async function adminRenameResearch(fastify: FastifyInstance, id: string, body: unknown) {
  const { slug } = z.object({ slug: slugRule }).parse(body);
  const a = await load(fastify, id);
  if (!a) throw { statusCode: 404, message: 'Research article not found' };
  if (slug === a.slug) throw { statusCode: 400, message: 'Same as now' };
  if (await fastify.prisma.researchArticle.findUnique({ where: { slug }, select: { id: true } })) {
    throw { statusCode: 409, message: 'Another article already uses this URL', details: [{ path: 'slug', message: 'Already in use.' }] };
  }
  const to = `/research/${slug}`;
  const live = a.live as LiveArticle | null;
  await fastify.prisma.$transaction([
    fastify.prisma.researchRedirect.updateMany({ where: { toPath: `/research/${a.slug}` }, data: { toPath: to } }),
    fastify.prisma.researchRedirect.deleteMany({ where: { fromSlug: slug } }),
    fastify.prisma.researchRedirect.upsert({ where: { fromSlug: a.slug }, create: { fromSlug: a.slug, toPath: to }, update: { toPath: to } }),
    fastify.prisma.researchArticle.update({
      where: { id },
      data: { slug, ...(live ? { live: { ...live, slug } as unknown as Prisma.InputJsonValue } : {}) },
    }),
  ]);
  notifyRevalidate(['research']);
  return view((await load(fastify, id))!);
}

const deleteSchema = z.union([
  z.object({ redirectTo: z.string().regex(/^\/[^/\s][^\s]*$|^\/$/, 'A path on this site') }),
  z.object({ gone: z.literal(true) }),
]);

/** A draft that never went live is simply removed. A published URL is Google's: it either 301s to
 *  another live page or is marked gone. There is no third option. */
export async function adminDeleteResearch(fastify: FastifyInstance, id: string, body: unknown) {
  const a = await fastify.prisma.researchArticle.findUnique({ where: { id }, select: { id: true, slug: true, slugLockedAt: true } });
  if (!a) throw { statusCode: 404, message: 'Research article not found' };
  const ops = [];
  if (a.slugLockedAt) {
    const d = deleteSchema.safeParse(body ?? {});
    if (!d.success) throw { statusCode: 400, message: 'This URL has been live: choose a redirect or mark it gone.' };
    const toPath = 'redirectTo' in d.data ? d.data.redirectTo : null;
    if (toPath === '/') throw { statusCode: 400, message: 'Never redirect to the homepage: pick the closest live replacement.' };
    if (toPath === `/research/${a.slug}`) throw { statusCode: 400, message: 'A page cannot redirect to itself.' };
    ops.push(
      fastify.prisma.researchRedirect.updateMany({ where: { toPath: `/research/${a.slug}` }, data: { toPath } }),
      fastify.prisma.researchRedirect.upsert({ where: { fromSlug: a.slug }, create: { fromSlug: a.slug, toPath }, update: { toPath } })
    );
  }
  await fastify.prisma.$transaction([...ops, fastify.prisma.researchArticle.delete({ where: { id } })]);
  notifyRevalidate(['research']);
  return { success: true };
}

/** Live pages a deleted article may redirect to: the hub and every other live article. */
export async function adminResearchTargets(fastify: FastifyInstance) {
  const rows = await fastify.prisma.researchArticle.findMany({ where: { live: { not: Prisma.DbNull } }, select: { id: true, slug: true, title: true } });
  return { data: [{ value: '/research', label: 'Research (all summaries)', sub: '/research' }, ...rows.map((r) => ({ value: `/research/${r.slug}`, label: r.title, sub: `/research/${r.slug}`, id: r.id }))] };
}

// ── photos placed in the text ────────────────────────────────────────────────

const imageSchema = z.object({
  url: z.string().trim().min(1).regex(/^\/uploads\//, 'Upload the photo through the image uploader'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  alt: z.string().trim().max(300).optional(),
  caption: z.string().trim().max(500).nullable().optional(),
  credit: z.string().trim().max(300).nullable().optional(),
  creditUrl: z.string().trim().url().nullable().optional().or(z.literal('').transform(() => null)),
});

export async function adminAddResearchImage(fastify: FastifyInstance, articleId: string, body: unknown) {
  const data = imageSchema.parse(body);
  const article = await fastify.prisma.researchArticle.findUnique({ where: { id: articleId }, select: { id: true } });
  if (!article) throw { statusCode: 404, message: 'Research article not found' };
  return fastify.prisma.researchImage.create({ data: { ...data, articleId } });
}

/** Edit alt/caption/credit, or replace the file (new url + size): the text's token keeps pointing at it.
 *  Like every draft change it reaches the site at the next publish. */
export async function adminUpdateResearchImage(fastify: FastifyInstance, imageId: string, body: unknown) {
  const data = imageSchema.partial().parse(body);
  const image = await fastify.prisma.researchImage.findUnique({ where: { id: imageId }, select: { id: true } });
  if (!image) throw { statusCode: 404, message: 'Image not found' };
  return fastify.prisma.researchImage.update({ where: { id: imageId }, data });
}

/** Removes the photo from the draft (the editor strips its token from the text in the same action).
 *  A live article keeps its published copy until the next publish. */
export async function adminDeleteResearchImage(fastify: FastifyInstance, imageId: string) {
  const image = await fastify.prisma.researchImage.findUnique({ where: { id: imageId }, select: { id: true } });
  if (!image) throw { statusCode: 404, message: 'Image not found' };
  await fastify.prisma.researchImage.delete({ where: { id: imageId } });
  return { success: true };
}

// ── sources ─────────────────────────────────────────────────────────────────

export async function adminListSources(fastify: FastifyInstance, query: Record<string, string>) {
  const { page, limit, skip } = getPaginationParams(query);
  const q = query.search?.trim();
  const where = q
    ? {
        OR: [
          { title: { contains: q, mode: 'insensitive' as const } },
          { journal: { contains: q, mode: 'insensitive' as const } },
          { doi: { contains: q.replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:)/i, ''), mode: 'insensitive' as const } },
          { pmid: { equals: q } },
        ],
      }
    : {};
  const [rows, total] = await Promise.all([
    fastify.prisma.researchSource.findMany({
      where,
      orderBy: [{ year: 'desc' }, { title: 'asc' }],
      skip,
      take: limit,
      include: { citations: { select: { article: { select: { id: true, title: true, liveAt: true } } } } },
    }),
    fastify.prisma.researchSource.count({ where }),
  ]);
  return paginatedResponse(
    rows.map(({ citations, ...s }) => ({ ...s, citedIn: citations.map((c) => c.article) })),
    total,
    page,
    limit
  );
}

export async function adminCreateSource(fastify: FastifyInstance, body: unknown) {
  const data = sourceSchema.parse(body);
  const created = await fastify.prisma.researchSource.create({ data });
  return { ...created, citedIn: [] };
}

export async function adminUpdateSource(fastify: FastifyInstance, id: string, body: unknown) {
  const data = sourceSchema.parse(body);
  const existing = await fastify.prisma.researchSource.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw { statusCode: 404, message: 'Source not found' };
  const updated = await fastify.prisma.researchSource.update({ where: { id }, data });
  notifyRevalidate(['research']);
  return updated;
}

export async function adminDeleteSource(fastify: FastifyInstance, id: string) {
  const source = await fastify.prisma.researchSource.findUnique({
    where: { id },
    include: { citations: { select: { article: { select: { title: true } } } } },
  });
  if (!source) throw { statusCode: 404, message: 'Source not found' };
  if (source.citations.length) {
    const titles = source.citations.map((c) => `“${c.article.title}”`).join(', ');
    throw { statusCode: 409, message: `Cited in ${titles}. Remove the citation there first.` };
  }
  await fastify.prisma.researchSource.delete({ where: { id } });
  return { success: true };
}

/** Title, journal, year and DOI for a PubMed ID, from NCBI's public E-utilities (read-only). */
export async function adminLookupPubmed(pmidRaw: string) {
  const pmid = pmidRaw.trim();
  if (!/^\d{5,9}$/.test(pmid)) throw { statusCode: 400, message: 'A PubMed ID is 5–9 digits' };
  const res = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${pmid}`, {
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!res?.ok) throw { statusCode: 502, message: 'PubMed did not answer. Try again, or fill the fields by hand.' };
  const json = (await res.json()) as { result?: Record<string, { error?: string; title?: string; source?: string; pubdate?: string; articleids?: { idtype: string; value: string }[] }> };
  const r = json.result?.[pmid];
  if (!r || r.error || !r.title) throw { statusCode: 404, message: `No PubMed record ${pmid}` };
  return {
    pmid,
    doi: r.articleids?.find((a) => a.idtype === 'doi')?.value ?? null,
    title: r.title,
    journal: r.source ?? '',
    year: Number(r.pubdate?.slice(0, 4)) || null,
  };
}

// ── people ──────────────────────────────────────────────────────────────────

const authorSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: slugRule.optional(),
  role: z.string().trim().max(120).nullable().optional(),
  credentials: z.string().trim().max(120).nullable().optional(),
  bio: z.string().trim().max(1000).nullable().optional(),
  sameAs: z.array(z.string().trim().url()).max(8).optional(),
});

export async function adminListAuthors(fastify: FastifyInstance) {
  const rows = await fastify.prisma.researchAuthor.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { written: true, reviewed: true } } },
  });
  return { data: rows };
}

export async function adminCreateAuthor(fastify: FastifyInstance, body: unknown) {
  const { slug, ...data } = authorSchema.parse(body);
  return fastify.prisma.researchAuthor.create({ data: { ...data, slug: slug ?? slugify(data.name) } });
}

export async function adminUpdateAuthor(fastify: FastifyInstance, id: string, body: unknown) {
  const data = authorSchema.partial().parse(body);
  const existing = await fastify.prisma.researchAuthor.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw { statusCode: 404, message: 'Person not found' };
  const updated = await fastify.prisma.researchAuthor.update({ where: { id }, data });
  notifyRevalidate(['research']);
  return updated;
}

/** Their articles fall back to the organisation byline (ON DELETE SET NULL). */
export async function adminDeleteAuthor(fastify: FastifyInstance, id: string) {
  const existing = await fastify.prisma.researchAuthor.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw { statusCode: 404, message: 'Person not found' };
  await fastify.prisma.researchAuthor.delete({ where: { id } });
  notifyRevalidate(['research']);
  return { success: true };
}
