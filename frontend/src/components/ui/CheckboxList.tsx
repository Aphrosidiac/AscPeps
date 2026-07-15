'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

interface CheckboxListItem {
  id: string;
  label: string;
}

interface CheckboxListProps {
  label?: string;
  items: CheckboxListItem[];
  selectedIds: string[];
  onChange: (selectedIds: string[]) => void;
  searchPlaceholder?: string;
  emptyMessage?: string;
}

export function CheckboxList({
  label,
  items,
  selectedIds,
  onChange,
  searchPlaceholder = 'Search...',
  emptyMessage = 'No items available.',
}: CheckboxListProps) {
  const [search, setSearch] = useState('');

  const filtered = search.trim()
    ? items.filter((item) => item.label.toLowerCase().includes(search.trim().toLowerCase()))
    : items;

  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  }

  return (
    <div className="space-y-1">
      {label && <label className="block text-sm font-medium text-text-secondary">{label}</label>}
      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        {items.length > 5 && (
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className={cn(
              'w-full px-3 py-2 border-b border-border bg-transparent text-text-primary text-sm',
              'focus:outline-none focus:ring-2 focus:ring-primary/20'
            )}
          />
        )}
        <div className="max-h-48 overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-3 py-2 text-sm text-text-secondary">{emptyMessage}</p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-text-secondary">No matches.</p>
          ) : (
            filtered.map((item) => (
              <label
                key={item.id}
                htmlFor={`checkbox-list-${item.id}`}
                className="flex items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-primary/5 cursor-pointer"
              >
                <input
                  type="checkbox"
                  id={`checkbox-list-${item.id}`}
                  checked={selectedIds.includes(item.id)}
                  onChange={() => toggle(item.id)}
                  className="rounded accent-primary"
                />
                {item.label}
              </label>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
