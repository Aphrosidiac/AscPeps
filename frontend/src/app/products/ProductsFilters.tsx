'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { CategoryFilter } from '@/components/products/CategoryFilter';
import { Animate } from '@/components/ui/Animate';
import type { Category } from '@/types';

interface ProductsFiltersProps {
  categories: Category[];
  selectedCategory: string | null;
  search: string;
}

// Drives the /products URL's ?category=&search= params directly, rather than
// fetching client-side — the initial (and every subsequent) product list stays
// server-rendered via ProductsGrid, which re-runs on every param change.
export function ProductsFilters({ categories, selectedCategory, search }: ProductsFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [searchValue, setSearchValue] = useState(search);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setSearchValue(search), [search]);

  function navigate(next: { category?: string | null; search?: string }) {
    const params = new URLSearchParams();
    const category = next.category !== undefined ? next.category : selectedCategory;
    const s = next.search !== undefined ? next.search : searchValue;
    if (category) params.set('category', category);
    if (s) params.set('search', s);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function handleSearchChange(value: string) {
    setSearchValue(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => navigate({ search: value }), 300);
  }

  return (
    <Animate variant="fadeUp" delay={0.1} duration={0.5}>
      <div className="space-y-6 mb-8">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search peptides..."
            value={searchValue}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-shadow"
          />
        </div>
        <CategoryFilter
          categories={categories}
          selected={selectedCategory}
          onSelect={(slug) => navigate({ category: slug })}
        />
      </div>
    </Animate>
  );
}
