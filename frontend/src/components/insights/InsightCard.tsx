import Link from 'next/link';
import Image from 'next/image';
import { FileText } from 'lucide-react';
import type { Insight } from '@/types';
import { formatShortDate } from '@/lib/utils';

interface InsightCardProps {
  insight: Insight;
  featured?: boolean;
}

export function InsightCard({ insight, featured = false }: InsightCardProps) {
  const date = insight.publishedAt ?? insight.createdAt;

  return (
    <Link href={`/insights/${insight.slug}`} className="group block">
      <div className={featured ? 'grid sm:grid-cols-[300px_1fr] gap-6 items-center' : ''}>
        <div
          className={`relative bg-surface-elevated rounded-xl overflow-hidden flex items-center justify-center shrink-0 ${
            featured ? 'aspect-[3/2]' : 'aspect-[3/2] mb-4'
          }`}
        >
          {insight.coverImageUrl ? (
            <Image
              src={insight.coverImageUrl}
              alt=""
              fill
              sizes={featured ? '(min-width: 640px) 300px, 100vw' : '(min-width: 1024px) 320px, 45vw'}
              className="object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <FileText className="w-8 h-8 text-text-muted/40" />
          )}
        </div>
        <div>
          <p className="text-xs text-text-muted font-medium uppercase tracking-wider mb-2">{insight.category}</p>
          <h3
            className={`font-display font-semibold group-hover:text-primary-light transition-colors text-balance ${
              featured ? 'text-xl mb-2' : 'text-base mb-1.5 line-clamp-2'
            }`}
          >
            {insight.title}
          </h3>
          <p className={`text-text-secondary ${featured ? 'text-sm mb-3' : 'text-sm mb-2 line-clamp-2'}`}>{insight.excerpt}</p>
          <p className="text-xs text-text-muted">
            {insight.authorName} &middot; {formatShortDate(date)} &middot; {insight.readTimeMinutes} min read
          </p>
        </div>
      </div>
    </Link>
  );
}
