import type { Metadata } from 'next';
import Link from 'next/link';
import { InsightCard } from '@/components/insights/InsightCard';
import { getInsightsServer } from '@/lib/server-api';

export const metadata: Metadata = {
  title: 'Insights — Peptide Research & Product Updates | ASCEND',
  description:
    "Peptide research, dosing science and product updates from Asywa, Founder & CEO of ASCEND, drawing on the peer-reviewed literature cited on every product page.",
  alternates: { canonical: 'https://ascendpeptides.my/insights' },
};

interface InsightsPageProps {
  searchParams: Promise<{ category?: string }>;
}

function pillClass(active: boolean) {
  return `px-4 py-2 rounded-full text-sm font-medium transition-colors ${
    active ? 'bg-primary text-white' : 'bg-surface-elevated text-text-secondary hover:text-text-primary'
  }`;
}

export default async function InsightsPage({ searchParams }: InsightsPageProps) {
  const { category } = await searchParams;
  // Small, slow-growing content set — fetched once and filtered here, same
  // convention as the admin products list (see admin/products/page.tsx).
  const { data: insights } = await getInsightsServer({ limit: 100 });

  const categories = Array.from(new Set(insights.map((i) => i.category)));
  const filtered = category ? insights.filter((i) => i.category === category) : insights;
  const [latest, ...rest] = filtered;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <p className="text-xs text-text-muted font-medium uppercase tracking-wider mb-2">Research &amp; Insights</p>
      <h1 className="font-display text-3xl font-bold mb-3">Insights</h1>
      <p className="text-text-secondary mb-8 max-w-2xl leading-relaxed">
        Peptide research, dosing science and product updates — written by Asywa, Founder &amp; CEO of ASCEND,
        drawing on the same peer-reviewed literature cited on every product page.
      </p>

      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-8">
          <Link href="/insights" className={pillClass(!category)}>All</Link>
          {categories.map((cat) => (
            <Link key={cat} href={`/insights?category=${encodeURIComponent(cat)}`} className={pillClass(category === cat)}>
              {cat}
            </Link>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="text-text-muted py-16 text-center">No insights published yet — check back soon.</p>
      ) : (
        <>
          <div className="pb-8 mb-8 border-b border-border">
            <InsightCard insight={latest} featured />
          </div>
          {rest.length > 0 && (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-10">
              {rest.map((insight) => (
                <InsightCard key={insight.id} insight={insight} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
