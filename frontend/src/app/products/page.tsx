import { Suspense } from 'react';
import { ProductsGrid } from './ProductsGrid';
import { ProductsFilters } from './ProductsFilters';
import { getCategoriesServer, getProductsServer } from '@/lib/server-api';
import { JsonLd, BreadcrumbJsonLd } from '@/components/JsonLd';

const BASE_URL = 'https://ascendpeptides.my';

function CollectionJsonLd({ products }: { products: { name: string; slug: string }[] }) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Buy Research Peptides in Malaysia',
    url: `${BASE_URL}/products`,
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: products.map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${BASE_URL}/products/${p.slug}`,
        name: p.name,
      })),
    },
  };

  return <JsonLd data={data} />;
}

interface ProductsPageProps {
  searchParams: Promise<{ category?: string; search?: string }>;
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="bg-surface rounded-xl border border-border p-4 animate-pulse">
          <div className="aspect-square bg-surface-elevated rounded-lg mb-4" />
          <div className="h-3 bg-surface-elevated rounded w-1/3 mb-2" />
          <div className="h-4 bg-surface-elevated rounded w-2/3 mb-2" />
          <div className="h-5 bg-surface-elevated rounded w-1/4" />
        </div>
      ))}
    </div>
  );
}

export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const { category, search } = await searchParams;
  const isUnfiltered = !category && !search;

  const [categories, catalog] = await Promise.all([
    getCategoriesServer(),
    isUnfiltered ? getProductsServer({ limit: 100 }) : Promise.resolve(null),
  ]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {catalog && <CollectionJsonLd products={catalog.data} />}
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', url: BASE_URL },
          { name: 'Products', url: `${BASE_URL}/products` },
        ]}
      />
      <h1 className="font-display text-3xl font-bold mb-3">Buy Research Peptides in Malaysia</h1>
      <p className="text-text-secondary mb-8 max-w-2xl leading-relaxed">
        Browse Ascend MY&apos;s full range of premium research peptides — including Retatrutide, GHK-Cu,
        BPC-157, Tesamorelin, MOTS-c and AOD9604. Every compound is lab-grade, tested to 99%+ purity,
        priced in Malaysian Ringgit, and shipped free across Peninsular Malaysia.
      </p>

      <ProductsFilters categories={categories} selectedCategory={category ?? null} search={search ?? ''} />

      {/* The unfiltered catalog renders in the document itself. Inside a
          Suspense boundary it streamed into a <div hidden> after a skeleton,
          so any reader that skips hidden nodes or doesn't run JS (several AI
          fetchers) saw an empty grid on the page that lists every product.
          Filter and search changes still stream behind the skeleton. */}
      {isUnfiltered ? (
        <ProductsGrid />
      ) : (
        <Suspense key={`${category ?? ''}:${search ?? ''}`} fallback={<GridSkeleton />}>
          <ProductsGrid category={category} search={search} />
        </Suspense>
      )}
    </div>
  );
}
