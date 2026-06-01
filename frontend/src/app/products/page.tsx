'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { getProducts, getCategories } from '@/lib/api';
import { ProductCard } from '@/components/products/ProductCard';
import { CategoryFilter } from '@/components/products/CategoryFilter';
import { Animate, Stagger } from '@/components/ui/Animate';
import type { Product, Category } from '@/types';

export default function ProductsPage() {
  return (
    <Suspense fallback={<div className="max-w-7xl mx-auto px-4 py-8 animate-pulse"><div className="h-8 bg-surface-elevated rounded w-32 mb-6" /></div>}>
      <ProductsContent />
    </Suspense>
  );
}

function ProductsContent() {
  const searchParams = useSearchParams();
  const [products, setProducts] = useState<Product[]>([]);
  const [featured, setFeatured] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(searchParams.get('category'));
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCategories().then(setCategories).catch(() => {});
    getProducts({ featured: 'true', limit: 10 } as Parameters<typeof getProducts>[0])
      .then((r) => setFeatured(r.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params: Record<string, string> = { limit: '50' };
    if (selectedCategory) params.category = selectedCategory;
    if (search) params.search = search;

    getProducts(params as Parameters<typeof getProducts>[0])
      .then((r) => setProducts(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedCategory, search]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Animate variant="fadeUp" duration={0.5}>
        <h1 className="font-display text-3xl font-bold mb-6">Buy Research Peptides in Malaysia</h1>
      </Animate>

      {/* Featured Products Row */}
      {featured.length > 0 && !search && !selectedCategory && (
        <Animate variant="fadeUp" delay={0.05} duration={0.5}>
          <div className="mb-10">
            <div className="flex items-center gap-2 mb-4">
              <h2 className="font-display font-semibold text-lg">Featured</h2>
            </div>
            <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 snap-x snap-mandatory scrollbar-hide">
              {featured.map((product) => (
                <div key={product.id} className="w-[200px] sm:w-[220px] shrink-0 snap-start">
                  <ProductCard product={product} />
                </div>
              ))}
            </div>
          </div>
        </Animate>
      )}

      <Animate variant="fadeUp" delay={0.1} duration={0.5}>
        <div className="space-y-6 mb-8">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              placeholder="Search peptides..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-shadow"
            />
          </div>
          <CategoryFilter categories={categories} selected={selectedCategory} onSelect={setSelectedCategory} />
        </div>
      </Animate>

      {loading ? (
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
      ) : products.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-text-muted text-lg">No products found.</p>
        </div>
      ) : (
        <Stagger className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" stagger={0.05}>
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </Stagger>
      )}
    </div>
  );
}
