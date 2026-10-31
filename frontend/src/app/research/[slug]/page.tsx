import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { JsonLd } from '@/components/JsonLd';
import { ResearchArticleView } from '@/components/research/ResearchArticleView';
import { getProductsServer, getResearchServer } from '@/lib/server-api';
import { SITE, researchGraph } from '@/lib/research';
import { absoluteImageUrl } from '@/lib/utils';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const found = await getResearchServer(slug);
  if (!found || !('article' in found)) return { robots: { index: false } };
  const a = found.article;
  const url = `${SITE}/research/${a.slug}`;
  const image = absoluteImageUrl(a.leadImageUrl);
  return {
    title: { absolute: a.seoTitle },
    description: a.seoDescription || a.dek,
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      title: a.seoTitle,
      description: a.seoDescription || a.dek,
      url,
      publishedTime: a.datePublished,
      modifiedTime: a.dateModified,
      authors: [a.author?.name ?? 'Ascend MY editorial team'],
      ...(image && { images: [{ url: image, width: a.leadImageWidth ?? undefined, height: a.leadImageHeight ?? undefined, alt: a.leadImageAlt }] }),
    },
  };
}

export default async function ResearchArticlePage({ params }: Props) {
  const { slug } = await params;
  const found = await getResearchServer(slug);
  // A renamed or deleted article's URL: one 301 hop to where it went. Gone answers 404 (the
  // App Router has no 410), out of the index all the same.
  if (found && 'redirect' in found) permanentRedirect(found.redirect);
  if (!found || !('article' in found)) notFound();
  const article = found.article;

  const wantsProducts = article.relatedProductIds.length > 0 || article.body.includes('{{product:');
  const catalog = wantsProducts ? (await getProductsServer({ limit: 100 })).data : [];

  const crumbs = [
    { name: 'Home', path: '/' },
    { name: 'Research', path: '/research' },
    { name: article.title, path: `/research/${article.slug}` },
  ];

  return (
    <>
      <JsonLd data={researchGraph(article, crumbs)} />
      <ResearchArticleView article={article} catalog={catalog} />
    </>
  );
}
