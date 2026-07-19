'use client';

import Link from 'next/link';
import Image from 'next/image';
import { ShoppingCart } from 'lucide-react';
import type { Product } from '@/types';
import { formatPrice, getDefaultVariant, getEffectivePrice, getVariantDisplayName, isSaleActive } from '@/lib/utils';
import { useCart } from '@/lib/cart';
import { Button } from '@/components/ui/Button';

interface ProductCardProps {
  product: Product;
}

export function ProductCard({ product }: ProductCardProps) {
  const { addItem } = useCart();
  const variant = getDefaultVariant(product);
  const activeVariants = product.variants.filter((v) => v.active);
  // "From RMxx" only when active sizes genuinely differ in price — a plain
  // price on a single-price product isn't misleading, so don't hedge it.
  const priceRange = activeVariants.length > 1 && new Set(activeVariants.map((v) => v.price)).size > 1;

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!variant) return;
    addItem({
      variantId: variant.id,
      code: variant.code,
      name: getVariantDisplayName(product, variant),
      size: variant.size,
      price: getEffectivePrice(variant),
      quantity: 1,
      imageUrl: variant.imageUrl,
    });
  };

  return (
    <Link href={`/products/${product.slug}`} className="group">
      <div className="bg-surface rounded-xl border border-border hover:border-border-hover hover:shadow-md hover:-translate-y-1 transition-all duration-300 p-4">
        <div className="relative aspect-square bg-surface-elevated rounded-lg mb-4 flex items-center justify-center overflow-hidden">
          {variant?.imageUrl ? (
            <Image
              src={variant.imageUrl}
              alt={product.name}
              fill
              sizes="(min-width: 1024px) 220px, (min-width: 768px) 25vw, 45vw"
              className="object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="text-4xl font-display font-bold text-text-muted/30 select-none">
              {variant?.code ?? product.name.slice(0, 2).toUpperCase()}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-xs text-text-muted font-medium uppercase tracking-wider">
            {product.category.name}
          </p>
          <h3 className="font-display font-semibold text-text-primary group-hover:text-primary-light">
            {product.name}
          </h3>
          {variant?.size && <p className="text-sm text-text-secondary">{variant.size}</p>}
          <div className="flex items-center justify-between gap-2 pt-2">
            {variant ? (
              <>
                {/* "From" stacks above the price instead of sitting inline
                    beside it — inline, "From" + an active sale's
                    strikethrough price could combine into a string wider
                    than the narrow card leaves room for next to the button,
                    pushing the button past the card's own right edge. */}
                <span className="flex flex-col min-w-0">
                  {priceRange && <span className="text-xs text-text-muted leading-tight">From</span>}
                  <span className="flex items-baseline gap-1.5">
                    <span className="font-display font-bold text-lg">{formatPrice(getEffectivePrice(variant))}</span>
                    {isSaleActive(variant) && (
                      <span className="text-xs text-text-muted line-through">{formatPrice(variant.price)}</span>
                    )}
                  </span>
                </span>
                {variant.stock === 0 ? (
                  <span className="text-xs font-semibold text-danger shrink-0">Out of stock</span>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    className="min-w-11 min-h-11 shrink-0"
                    onClick={handleAddToCart}
                    aria-label="Add to cart"
                  >
                    <ShoppingCart className="w-4 h-4" />
                  </Button>
                )}
              </>
            ) : (
              <span className="text-xs font-semibold text-danger">Unavailable</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
