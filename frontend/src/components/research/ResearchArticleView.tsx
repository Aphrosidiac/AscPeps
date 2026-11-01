import Link from 'next/link';
import Image from 'next/image';
import { ProductCard } from '@/components/products/ProductCard';
import { ResearchToc } from '@/components/research/ResearchToc';
import { headings, renderResearchBody, type EmbedProduct } from '@/lib/research-markdown';
import { researchDate, sourceLinks } from '@/lib/research';
import { formatPrice, getDefaultVariant } from '@/lib/utils';
import type { Product, ResearchContent } from '@/types';

// The article as readers see it. Rendered on the server for /research/[slug]
// and, unchanged, as the admin editor's live preview.

type ArticleData = ResearchContent & { datePublished?: string | null; dateModified?: string | null };

const EMBED = /^\{\{product:([A-Za-z0-9_-]+)\}\}$/gm;

/** A product as the in-text card shows it: name, sizes and price straight from the catalogue. */
function toEmbed(p: Product): EmbedProduct {
  const active = p.variants.filter((v) => v.active);
  const prices = active.map((v) => v.price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    imageUrl: getDefaultVariant(p)?.imageUrl ?? null,
    sizes: active.map((v) => v.size).filter(Boolean).join(' · '),
    price: prices.length === 0 ? '' : lo === hi ? formatPrice(lo) : `${formatPrice(lo)}–${formatPrice(hi).replace(/^RM\s?/, '')}`,
  };
}

export function ResearchCrumbs({ items }: { items: { name: string; path: string }[] }) {
  return (
    <nav className="rs-crumbs" aria-label="Breadcrumb">
      <ol>
        {items.map((c, i) =>
          i < items.length - 1 ? (
            <li key={c.path}>
              <Link href={c.path}>{c.name}</Link>
            </li>
          ) : (
            <li key={c.path} aria-current="page">
              {c.name}
            </li>
          )
        )}
      </ol>
    </nav>
  );
}

/**
 * `catalog` is every product the article may show: cards placed in the text and the
 * "Compounds in this piece" row (related products, minus any already placed in the text).
 */
export function ResearchArticleView({ article: a, catalog = [], preview = false }: { article: ArticleData; catalog?: Product[]; preview?: boolean }) {
  const toc = headings(a.body);
  const embedded = new Set([...a.body.matchAll(EMBED)].map((m) => m[1]));
  const html = renderResearchBody(a.body, {
    images: a.images,
    products: catalog.filter((p) => embedded.has(p.id)).map(toEmbed),
    showMissing: preview,
  });
  const products = a.relatedProductIds
    .filter((id) => !embedded.has(id))
    .map((id) => catalog.find((p) => p.id === id))
    .filter((p): p is Product => !!p);
  const published = a.datePublished ? researchDate(a.datePublished) : null;
  const modified = a.dateModified ? researchDate(a.dateModified) : null;
  const crumbs = [
    { name: 'Home', path: '/' },
    { name: 'Research', path: '/research' },
    { name: a.title || 'Untitled', path: `/research/${a.slug}` },
  ];

  return (
    <article className="rs rs-page">
      <div className={`rs-post__grid${toc.length >= 3 ? ' rs-post--toc' : ''}`}>
        <header className="rs-post__head">
          <ResearchCrumbs items={crumbs} />
          <p className="rs-eyebrow">Research summary</p>
          <h1>{a.title}</h1>
          {a.dek && <p className="rs-post__dek">{a.dek}</p>}
          <p className="rs-post__meta">
            Written by <Link href="/about">{a.author ? a.author.name : 'Ascend MY editorial team'}</Link>
            {a.reviewer && (
              <>
                {' · '}Reviewed by <Link href="/about">{a.reviewer.name}</Link>
                {a.reviewer.credentials && `, ${a.reviewer.credentials}`}
              </>
            )}
            {published && (
              <>
                {' · '}
                <time dateTime={published.iso}>{published.label}</time>
              </>
            )}
            {modified && published && modified.iso !== published.iso && (
              <>
                {' · '}Updated <time dateTime={modified.iso}>{modified.label}</time>
              </>
            )}
          </p>
        </header>
        <div className="rs-post__lead">
          {a.leadImageUrl && (
            <Image
              src={a.leadImageUrl}
              alt={a.leadImageAlt}
              width={a.leadImageWidth ?? 1600}
              height={a.leadImageHeight ?? 900}
              sizes="(min-width: 1000px) 760px, 100vw"
              priority
            />
          )}
        </div>
        {toc.length >= 3 && <ResearchToc items={toc} />}
        <div className="rs-post__body">
          <div className="rs-prose" dangerouslySetInnerHTML={{ __html: html }} />
          {a.citations.length > 0 && (
            <section className="rs-post__refs" aria-labelledby="refs-h">
              <h2 id="refs-h">Cited studies</h2>
              <ol className="rs-refs">
                {a.citations.map((c) => (
                  <li key={c.position} id={`study-${c.position}`}>
                    {c.finding && <p className="rs-ref__finding">{c.finding}</p>}
                    <p className="rs-ref__cite">
                      <cite>{c.source.title}</cite>. <span className="rs-ref__journal">{c.source.journal}</span>, {c.source.year}.{' '}
                      {sourceLinks(c.source).map((l, i) => (
                        <span key={l.href}>
                          {i > 0 && ' · '}
                          <a href={l.href} rel="noopener">{l.label}</a>
                        </span>
                      ))}
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      </div>
      {products.length > 0 && (
        <section className="rs-wrap rs-post__cards" aria-labelledby="post-cards">
          <h2 id="post-cards" className="rs-post__cards-h">Compounds in this piece</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
