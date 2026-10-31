import { z } from 'zod';

// Rules shared by the admin API and the importer. Drafts may be incomplete;
// publishing runs `publishIssues`, which is where an article earns its place
// on the storefront.

/** A photo placed in the text: `{{image:<ResearchImage.id>}}`, anywhere, mid-sentence included. */
export const IMAGE_TOKEN = /\{\{image:([a-z0-9]+)\}\}/g;

export function imageTokenIds(body: string): string[] {
  return [...body.matchAll(IMAGE_TOKEN)].map((m) => m[1]);
}

export const slugRule = z
  .string()
  .trim()
  .min(2)
  .max(90)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, digits and single hyphens');

export const pmidRule = z.string().trim().regex(/^\d{5,9}$/, 'A PubMed ID is 5–9 digits');
export const doiRule = z
  .string()
  .trim()
  .transform((s) => s.replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:)/i, ''))
  .pipe(z.string().regex(/^10\.\d{4,9}\/\S+$/, 'A DOI starts with 10. and a registrant code, e.g. 10.1152/…'));

const optional = <T extends z.ZodTypeAny>(rule: T) =>
  z.preprocess((v) => (v === '' || v === undefined ? null : v), rule.nullable());

export const sourceSchema = z
  .object({
    pmid: optional(pmidRule),
    doi: optional(doiRule),
    url: optional(z.string().trim().url('A full https:// address')),
    journal: z.string().trim().min(1, 'Required'),
    year: z.coerce.number().int().min(1900).max(2100),
    title: z.string().trim().min(10, 'At least 10 characters'),
  })
  .refine((s) => s.pmid || s.doi || s.url, { message: 'A PMID, DOI or URL is required: a citation readers can check', path: ['pmid'] });

/** The DOI and PubMed links a source prints, in that order (same as Teliti's referenceLinks). */
export function sourceLinks(s: { pmid: string | null; doi: string | null; url: string | null }) {
  return [
    s.doi ? { label: `doi:${s.doi}`, href: `https://doi.org/${s.doi}` } : null,
    s.pmid ? { label: `PubMed ${s.pmid}`, href: `https://pubmed.ncbi.nlm.nih.gov/${s.pmid}/` } : null,
    !s.doi && !s.pmid && s.url ? { label: 'Source', href: s.url } : null,
  ].filter((x): x is { label: string; href: string } => !!x);
}

type Issue = { path: string; message: string };

/** Teliti's contract limits, shared with the admin's live "Contract check". */
export const LIMITS = {
  title: [10, 90],
  dek: [40, 260],
  seoTitle: [20, 65],
  seoDescription: [70, 160],
  alt: [10, 160],
} as const;

/** What stops an article going live. Empty = publishable. */
export function publishIssues(a: {
  slug: string;
  title: string;
  dek: string;
  body: string;
  seoTitle: string;
  seoDescription: string;
  leadImageUrl: string | null;
  leadImageAlt: string;
  citations: { finding: string }[];
  images: { id: string; alt: string }[];
}): Issue[] {
  const out: Issue[] = [];
  // Field paths as Teliti's contract names them: the H1 is `h1`, the SEO pair `seo.title` / `seo.description`.
  const NAME = { title: 'h1', dek: 'dek', seoTitle: 'seo.title', seoDescription: 'seo.description', alt: 'leadImage.alt' } as const;
  const len = (key: keyof typeof LIMITS, v: string) => {
    const [min, max] = LIMITS[key];
    const path = NAME[key];
    const n = v.trim().length;
    if (n < min) out.push({ path, message: n === 0 ? 'Required.' : `At least ${min} characters.` });
    else if (n > max) out.push({ path, message: `At most ${max} characters.` });
  };
  if (!slugRule.safeParse(a.slug).success) out.push({ path: 'slug', message: 'Lowercase letters, digits and single hyphens.' });
  len('title', a.title);
  len('dek', a.dek);
  len('seoTitle', a.seoTitle);
  len('seoDescription', a.seoDescription);
  if (a.body.trim().length < 200) out.push({ path: 'body', message: 'The article body is too short to publish.' });
  if (!a.leadImageUrl) out.push({ path: 'leadImage', message: 'Add an image.' });
  else {
    const n = a.leadImageAlt.trim().length;
    if (n < LIMITS.alt[0] || n > LIMITS.alt[1]) out.push({ path: 'leadImage.alt', message: 'Alt text is required (10–160 characters).' });
  }
  if (a.citations.length < 2) out.push({ path: 'citations', message: 'Research summaries cite at least two studies.' });
  a.citations.forEach((c, i) => {
    if (c.finding.trim().length < 20) out.push({ path: `citations.${i}.finding`, message: 'Say what the study found (at least 20 characters).' });
  });
  const known = new Map(a.images.map((im) => [im.id, im]));
  for (const id of new Set(imageTokenIds(a.body))) {
    const im = known.get(id);
    if (!im) out.push({ path: 'body', message: `The text places a photo that no longer exists ({{image:${id}}}).` });
    else if (!im.alt.trim()) out.push({ path: `images.${id}.alt`, message: 'Every placed photo needs alt text.' });
  }
  return out;
}

type Person = { id: string; slug: string; name: string; role: string | null; credentials: string | null; bio: string | null; sameAs: string[] };
type WithRelations = {
  slug: string; title: string; dek: string; body: string; seoTitle: string; seoDescription: string;
  leadImageUrl: string | null; leadImageAlt: string; leadImageWidth: number | null; leadImageHeight: number | null;
  datePublished: Date | null; relatedProductIds: string[];
  author: Person | null; reviewer: Person | null;
  citations: { position: number; finding: string; sourceId: string; source: { id: string; pmid: string | null; doi: string | null; url: string | null; journal: string; year: number; title: string } }[];
  images: { id: string; url: string; width: number; height: number; alt: string; caption: string | null; credit: string | null; creditUrl: string | null }[];
};

const person = (p: Person | null) => (p ? { id: p.id, slug: p.slug, name: p.name, role: p.role, credentials: p.credentials, bio: p.bio, sameAs: p.sameAs } : null);

/** The article as the storefront reads it: self-contained, so later edits to a person, study or photo
 *  wait for the next publish like every other change. Only photos the text places are kept. */
export function publicContent(a: WithRelations) {
  const placed = new Set(imageTokenIds(a.body));
  return {
    slug: a.slug,
    title: a.title,
    dek: a.dek,
    body: a.body,
    seoTitle: a.seoTitle,
    seoDescription: a.seoDescription,
    leadImageUrl: a.leadImageUrl,
    leadImageAlt: a.leadImageAlt,
    leadImageWidth: a.leadImageWidth,
    leadImageHeight: a.leadImageHeight,
    relatedProductIds: a.relatedProductIds,
    author: person(a.author),
    reviewer: person(a.reviewer),
    citations: a.citations
      .slice()
      .sort((x, y) => x.position - y.position)
      .map((c) => ({ position: c.position, finding: c.finding, sourceId: c.sourceId, source: { id: c.source.id, pmid: c.source.pmid, doi: c.source.doi, url: c.source.url, journal: c.source.journal, year: c.source.year, title: c.source.title } })),
    images: a.images
      .filter((im) => placed.has(im.id))
      .map((im) => ({ id: im.id, url: im.url, width: im.width, height: im.height, alt: im.alt, caption: im.caption, credit: im.credit, creditUrl: im.creditUrl })),
  };
}
export type PublicContent = ReturnType<typeof publicContent>;
export type LiveArticle = PublicContent & { datePublished: string; dateModified: string; updatedAt: string };

/** JSON with keys in a fixed order: Postgres JSONB reorders an object's keys, so the stored live copy
 *  and a fresh build of the same article only compare equal this way. */
export function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x
  );
}

/** draft = never published · excluded = taken offline · live = the site shows the draft · changed = saved changes not live yet. */
export function publishState(a: WithRelations & { live: unknown; slugLockedAt: Date | null }) {
  if (!a.live) return a.slugLockedAt ? 'excluded' : 'draft';
  const { datePublished: _p, dateModified: _m, updatedAt: _u, ...live } = a.live as LiveArticle;
  return canonical(live) === canonical(publicContent(a)) ? 'live' : 'changed';
}
