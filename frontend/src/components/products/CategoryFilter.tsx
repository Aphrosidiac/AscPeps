'use client';

import { cn } from '@/lib/utils';
import { getCategoryIcon } from '@/lib/category-icons';
import type { Category } from '@/types';

interface CategoryFilterProps {
  categories: Category[];
  selected: string | null;
  onSelect: (slug: string | null) => void;
}

export function CategoryFilter({ categories, selected, onSelect }: CategoryFilterProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => onSelect(null)}
        className={cn(
          'px-4 py-2 rounded-full text-sm font-medium transition-colors cursor-pointer',
          !selected
            ? 'bg-primary text-white'
            : 'bg-surface-elevated text-text-secondary hover:text-text-primary'
        )}
      >
        All
      </button>
      {categories.map((cat) => {
        const CategoryIcon = getCategoryIcon(cat.slug);
        return (
          <button
            key={cat.slug}
            onClick={() => onSelect(cat.slug)}
            className={cn(
              'inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-colors cursor-pointer',
              selected === cat.slug
                ? 'bg-primary text-white'
                : 'bg-surface-elevated text-text-secondary hover:text-text-primary'
            )}
          >
            <CategoryIcon className="w-4 h-4 shrink-0" />
            {cat.name}
          </button>
        );
      })}
    </div>
  );
}
