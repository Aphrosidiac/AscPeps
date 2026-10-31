import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { JsonLd } from '@/components/JsonLd';
import { ResearchCrumbs } from '@/components/research/ResearchArticleView';
import { getResearchListServer } from '@/lib/server-api';
import { RESEARCH_HUB, SITE, breadcrumbNode } from '@/lib/research';

export const metadata: Metadata = {
  title: { absolute: RESEARCH_HUB.title },
  description: RESEARCH_HUB.description,
  alternates: { canonical: `${SITE}/research` },
  openGraph: { type: 'website', title: RESEARCH_HUB.title, description: RESEARCH_HUB.description, url: `${SITE}/research` },
};

export default async function ResearchHubPage() {
  const { data: articles } = await getResearchListServer();
  // An empty hub would be a thin page: it exists only once something is published.
  if (articles.length === 0) notFound();

  const crumbs = [
    { name: 'Home', path: '/' },
    { name: RESEARCH_HUB.h1, path: '/research' },
  ];

  return (
    <div className="rs rs-page">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'CollectionPage',
              '@id': `${SITE}/research#page`,
              url: `${SITE}/research`,
              name: RESEARCH_HUB.h1,
              description: RESEARCH_HUB.description,
              isPartOf: { '@id': `${SITE}/#website` },
              mainEntity: {
                '@type': 'ItemList',
                itemListElement: articles.map((a, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/research/${a.slug}`, name: a.title })),
              },
            },
            breadcrumbNode(crumbs),
          ],
        }}
      />
      <div className="rs-wrap rs-hub">
        <ResearchCrumbs items={crumbs} />
        <div className="rs-hub__head">
          <div className="rs-hub__text">
            <h1>{RESEARCH_HUB.h1}</h1>
            <p className="rs-hub__intro">{RESEARCH_HUB.intro}</p>
          </div>
          {/* Decorative (the text beside it carries the meaning): empty alt, set size, and low priority so it
              never competes with the heading that is this page's LCP. */}
          {RESEARCH_HUB.art && (
            <picture className="rs-hub__art">
              <img
                src={RESEARCH_HUB.art.src}
                srcSet={RESEARCH_HUB.art.srcSet}
                sizes="(min-width: 1000px) 360px, 0px"
                width={RESEARCH_HUB.art.width}
                height={RESEARCH_HUB.art.height}
                alt=""
                loading="eager"
                decoding="async"
                fetchPriority="low"
              />
            </picture>
          )}
        </div>
        <ul className="rs-posts">
          {articles.map((a) => (
            <li key={a.id}>
              <p className="rs-posts__kind">Research summary</p>
              <h2 className="rs-posts__title">
                <Link href={`/research/${a.slug}`}>{a.title}</Link>
              </h2>
              <p className="rs-posts__dek">{a.dek}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
