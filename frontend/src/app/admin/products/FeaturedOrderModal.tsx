'use client';

import { useState } from 'react';
import { X, ArrowUp, ArrowDown, ImageIcon } from 'lucide-react';
import { adminUpdateProduct } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import type { Product } from '@/types';

interface Props {
  products: Product[];
  token: string;
  onClose: () => void;
  onSaved: () => void;
}

export function FeaturedOrderModal({ products, token, onClose, onSaved }: Props) {
  // Array.prototype.sort is stable, so ties (everything defaults to
  // sortOrder: 0 until curated) keep `products`' existing order — which is
  // already createdAt-desc, matching the public listing's tie-break.
  const [order, setOrder] = useState<Product[]>(() =>
    products.filter((p) => p.featured).sort((a, b) => a.sortOrder - b.sortOrder)
  );
  const [saving, setSaving] = useState(false);

  const persist = async (next: Product[]) => {
    setOrder(next);
    setSaving(true);
    try {
      await Promise.all(next.map((p, i) => adminUpdateProduct(token, p.id, { sortOrder: i })));
    } finally {
      setSaving(false);
      onSaved();
    }
  };

  const move = (index: number, direction: -1 | 1) => {
    if (saving) return;
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    persist(next);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-surface rounded-xl border border-border w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="font-display font-semibold text-lg">Featured Order</h2>
          <button onClick={onClose} className="p-1 hover:bg-surface-elevated rounded cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-2">
          {order.length === 0 ? (
            <p className="text-text-muted text-sm text-center py-8">No featured products yet — mark a product as Featured to curate its position here.</p>
          ) : (
            order.map((p, i) => (
              <div key={p.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border bg-surface">
                <div className="w-10 h-10 rounded bg-surface-elevated overflow-hidden shrink-0 flex items-center justify-center">
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <ImageIcon className="w-4 h-4 text-text-muted" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  {p.size && <p className="text-xs text-text-muted">{p.size}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => move(i, -1)}
                    disabled={i === 0 || saving}
                    aria-label="Move up"
                    className="p-1.5 rounded hover:bg-surface-elevated disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => move(i, 1)}
                    disabled={i === order.length - 1 || saving}
                    aria-label="Move down"
                    className="p-1.5 rounded hover:bg-surface-elevated disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <ArrowDown className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex justify-end gap-3 p-6 border-t border-border">
          <Button type="button" onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}
