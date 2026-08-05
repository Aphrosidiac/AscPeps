import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExternalLink, FileText } from 'lucide-react';
import { InsightCard } from '@/components/insights/InsightCard';
import { InsightFigures } from '@/components/insights/InsightFigures';
import { InsightComments } from '@/components/insights/InsightComments';
import { JsonLd } from '@/components/JsonLd';
import { getInsightServer, getInsightsServer, getInsightCommentsServer } from '@/lib/server-api';
import { absoluteImageUrl, formatShortDate } from '@/lib/utils';

const BASE_URL = 'https://ascendpeptides.my';

interface InsightPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: InsightPageProps): Promise<Metadata> {
  const { slug } = await params;
  const insight = await getInsightServer(slug);
  if (!insight) return {};

  const url = `${BASE_URL}/insights/${insight.slug}`;
  const image = absoluteImageUrl(insight.coverImageUrl);

  return {
    title: `${insight.title} | ASCEND Insights`,
    description: insight.excerpt,
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      title: insight.title,
      description: insight.excerpt,
      url,
      ...(insight.publishedAt && { publishedTime: insight.publishedAt }),
      authors: [insight.authorName],
      ...(image && { images: [image] }),
    },
  };
}

function ArticleJsonLd({
  insight,
  commentCount,
}: {
  insight: NonNullable<Awaited<ReturnType<typeof getInsightServer>>>;
  commentCount: number;
}) {
  // Cover first, then every figure. Google reads `image` as an array and the
  // figures genuinely are this article's images — leaving them out meant a
  // figure-heavy piece advertised a single stock cover. Relative upload paths
  // must be absolute here; JSON-LD has no document base to resolve against.
  const images = [insight.coverImageUrl, ...(insight.figures ?? []).map((f) => f.imageUrl)]
    .map((url) => absoluteImageUrl(url))
    .filter((url): url is string => Boolean(url));

  const data = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: insight.title,
    description: insight.excerpt,
    url: `${BASE_URL}/insights/${insight.slug}`,
    datePublished: insight.publishedAt ?? insight.createdAt,
    dateModified: insight.updatedAt,
    author: { '@type': 'Person', name: insight.authorName, jobTitle: insight.authorRole },
    publisher: { '@type': 'Organization', name: 'ASCEND' },
    ...(images.length > 0 && { image: images }),
    // Omitted rather than emitted as 0 — declaring "this article has no
    // discussion" is a weaker signal than saying nothing about it.
    ...(commentCount > 0 && { commentCount }),
  };

  return <JsonLd data={data} />;
}

export default async function InsightPage({ params }: InsightPageProps) {
  const { slug } = await params;
  const insight = await getInsightServer(slug);
  if (!insight) notFound();

  const [{ data: allInsights }, { data: comments }] = await Promise.all([
    getInsightsServer({ limit: 100 }),
    getInsightCommentsServer(slug),
  ]);
  const more = allInsights
    .filter((i) => i.id !== insight.id)
    // Same-category articles first; ties keep their original order (sort is
    // stable). The old form ignored `b` entirely — an invalid comparator.
    .sort((a, b) => Number(b.category === insight.category) - Number(a.category === insight.category))
    .slice(0, 3);

  const date = insight.publishedAt ?? insight.createdAt;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <ArticleJsonLd insight={insight} commentCount={comments.length} />

      <p className="text-sm text-text-muted mb-4">
        <Link href="/insights" className="hover:text-text-primary transition-colors">Insights</Link>
        {' / '}
        <Link href={`/insights?category=${encodeURIComponent(insight.category)}`} className="text-text-secondary hover:text-text-primary transition-colors">
          {insight.category}
        </Link>
      </p>

      {insight.coverImageUrl ? (
        <div className="relative aspect-[2/1] bg-surface-elevated rounded-xl overflow-hidden mb-6">
          <Image src={insight.coverImageUrl} alt="" fill sizes="(min-width: 768px) 768px, 100vw" className="object-cover" priority />
        </div>
      ) : (
        <div className="aspect-[2/1] bg-surface-elevated rounded-xl mb-6 flex items-center justify-center">
          <FileText className="w-10 h-10 text-text-muted/40" />
        </div>
      )}

      <p className="text-xs text-text-muted font-medium uppercase tracking-wider mb-2">{insight.category}</p>
      <h1 className="font-display text-2xl sm:text-3xl font-bold leading-tight text-balance mb-5">{insight.title}</h1>

      <div className="flex items-center gap-3 pb-6 mb-6 border-b border-border">
        <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-sm shrink-0">
          {insight.authorName.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium">{insight.authorName}</p>
          <p className="text-xs text-text-muted">{insight.authorRole}</p>
        </div>
        <p className="ml-auto text-xs text-text-muted text-right shrink-0">
          {formatShortDate(date)}<br />{insight.readTimeMinutes} min read
        </p>
      </div>

      <p className="text-lg leading-relaxed mb-6">{insight.excerpt}</p>
      <p className="text-[15px] leading-relaxed text-text-secondary whitespace-pre-line mb-6">{insight.content}</p>

      {/* Body, then the figures it refers to, then the paper they came from. */}
      {insight.figures && insight.figures.length > 0 && <InsightFigures figures={insight.figures} />}

      {insight.citationTitle && (
        <div className="bg-surface-elevated border border-border rounded-xl p-4 my-8">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Referenced study</p>
          <p className="text-sm font-medium mb-1">{insight.citationTitle}</p>
          <p className="text-xs text-text-secondary flex items-center gap-1.5 flex-wrap">
            {insight.citationSource}
            {insight.citationUrl && (
              <a href={insight.citationUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline hover:text-text-primary transition-colors">
                View paper <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </p>
        </div>
      )}

      {insight.relatedProducts && insight.relatedProducts.length > 0 && (
        <div className="my-8">
          <p className="text-xs text-text-muted mb-2.5">Mentioned in this article</p>
          <div className="flex flex-wrap gap-2">
            {insight.relatedProducts.map((p) => (
              <Link
                key={p.id}
                href={`/products/${p.slug}`}
                className="px-3.5 py-1.5 rounded-full text-sm border border-border text-text-secondary hover:text-text-primary hover:border-border-hover transition-colors"
              >
                {p.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      <InsightComments slug={insight.slug} initialComments={comments} />

      {more.length > 0 && (
        <div className="mt-12 pt-8 border-t border-border">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-5">More from {insight.authorName}</p>
          <div className="grid sm:grid-cols-3 gap-6">
            {more.map((i) => (
              <InsightCard key={i.id} insight={i} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
