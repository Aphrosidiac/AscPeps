import type { ResearchArticle, ResearchSource } from '@/types';
import { absoluteImageUrl } from '@/lib/utils';

export const SITE = 'https://ascendpeptides.my';
const ORG_ID = `${SITE}/#organization`;

// The hub's copy, in one place (the page, its metadata and llms.txt read it).
export const RESEARCH_HUB = {
  h1: 'Peptide research summaries',
  intro:
    'What published studies report about each compound sold here: who was studied and how, what each study measured and what it found, with every finding linked to its DOI or PubMed record. Each summary says how strong the evidence is, whether it comes from cell, animal or human studies, and what is not yet known. Summaries are a laboratory research reference, not advice about use in people or animals.',
  title: 'Peptide Research Summaries With Cited Studies',
  description:
    'Summaries of the published research on the compounds Ascend MY sells, each finding linked to its study on PubMed or by DOI.',
  // The illustration beside the heading (Teliti's layout: 360 px from 1000 px up). None until Ascend has its
  // own art; Teliti's may not ship here (its DECISIONS #19), so the heading takes the full width meanwhile.
  art: null as { src: string; srcSet: string; width: number; height: number } | null,
};

/** "26 October 2026", in Malaysian time, and the ISO day for <time datetime>. */
export function researchDate(value: string) {
  const d = new Date(value);
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(d);
  const label = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  return { iso, label };
}

/** The DOI and PubMed links a cited study prints, in that order. */
export function sourceLinks(s: Pick<ResearchSource, 'pmid' | 'doi' | 'url'>) {
  return [
    s.doi ? { label: `doi:${s.doi}`, href: `https://doi.org/${s.doi}` } : null,
    s.pmid ? { label: `PubMed ${s.pmid}`, href: `https://pubmed.ncbi.nlm.nih.gov/${s.pmid}/` } : null,
    !s.doi && !s.pmid && s.url ? { label: 'Source', href: s.url } : null,
  ].filter((x): x is { label: string; href: string } => !!x);
}

export function breadcrumbNode(items: { name: string; path: string }[]) {
  return {
    '@type': 'BreadcrumbList',
    '@id': `${SITE}${items[items.length - 1].path}#breadcrumb`,
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: `${SITE}${it.path === '/' ? '' : it.path}` })),
  };
}

const personId = (slug: string) => `${SITE}/research#person-${slug}`;

function personNode(p: NonNullable<ResearchArticle['author']>) {
  return {
    '@type': 'Person',
    '@id': personId(p.slug),
    name: p.name,
    ...(p.role && { jobTitle: p.role }),
    ...(p.bio && { description: p.bio }),
    ...(p.credentials && { hasCredential: { '@type': 'EducationalOccupationalCredential', name: p.credentials } }),
    worksFor: { '@id': ORG_ID },
    ...(p.sameAs.length > 0 && { sameAs: p.sameAs }),
  };
}

/**
 * Article + its people + breadcrumbs as one @graph. Each cited study is a
 * CreativeWork with additionalType ScholarlyArticle, not a ScholarlyArticle:
 * Google reads any Article subtype as an Article rich result and flags every
 * citation for an image, author and datetime a reference list doesn't have
 * (Teliti, Rich Results Test 2026-10-28).
 */
export function researchGraph(a: ResearchArticle, crumbs: { name: string; path: string }[]) {
  const url = `${SITE}/research/${a.slug}`;
  const images = [a.leadImageUrl, ...a.images.map((im) => im.url)]
    .map((u) => absoluteImageUrl(u))
    .filter((u): u is string => !!u);
  const article = {
    '@type': 'Article',
    '@id': `${url}#article`,
    headline: a.title,
    description: a.dek,
    ...(images.length > 0 && { image: images }),
    author: a.author ? { '@id': personId(a.author.slug) } : { '@id': ORG_ID },
    ...(a.reviewer && { reviewedBy: { '@id': personId(a.reviewer.slug) } }),
    publisher: { '@id': ORG_ID },
    datePublished: a.datePublished,
    dateModified: a.dateModified,
    mainEntityOfPage: url,
    inLanguage: 'en',
    citation: a.citations.map((c) => {
      const links = sourceLinks(c.source);
      return {
        '@type': 'CreativeWork',
        additionalType: 'https://schema.org/ScholarlyArticle',
        headline: c.source.title,
        datePublished: String(c.source.year),
        isPartOf: { '@type': 'Periodical', name: c.source.journal },
        ...(links[0] && { url: links[0].href }),
        ...(links.length > 1 && { sameAs: links.slice(1).map((l) => l.href) }),
        ...(c.source.doi && { identifier: { '@type': 'PropertyValue', propertyID: 'DOI', value: c.source.doi } }),
      };
    }),
  };
  return {
    '@context': 'https://schema.org',
    '@graph': [
      article,
      ...(a.author ? [personNode(a.author)] : []),
      ...(a.reviewer && a.reviewer.id !== a.author?.id ? [personNode(a.reviewer)] : []),
      breadcrumbNode(crumbs),
    ],
  };
}
