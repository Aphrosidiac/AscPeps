import { Suspense } from 'react';
import { ProductsContent } from './ProductsContent';

export default function ProductsPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="font-display text-3xl font-bold mb-3">Buy Research Peptides in Malaysia</h1>
      <p className="text-text-secondary mb-8 max-w-2xl leading-relaxed">
        Browse ASCEND&apos;s full range of premium research peptides — including Retatrutide, GHK-Cu,
        BPC-157, Tesamorelin, MOTS-c and AOD9604. Every compound is lab-grade, tested to 99%+ purity,
        priced in Malaysian Ringgit, and shipped free across Malaysia.
      </p>

      <Suspense
        fallback={
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
        }
      >
        <ProductsContent />
      </Suspense>
    </div>
  );
}
