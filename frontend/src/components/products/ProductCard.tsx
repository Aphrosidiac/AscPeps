'use client';

import Link from 'next/link';
import { ShoppingCart } from 'lucide-react';
import type { Product } from '@/types';
import { formatPrice } from '@/lib/utils';
import { useCart } from '@/lib/cart';
import { Button } from '@/components/ui/Button';

interface ProductCardProps {
  product: Product;
}

export function ProductCard({ product }: ProductCardProps) {
  const { addItem } = useCart();

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    addItem({
      productId: product.id,
      code: product.code,
      name: `${product.name}${product.size ? ` ${product.size}` : ''}`,
      size: product.size,
      price: product.price,
      quantity: 1,
      imageUrl: product.imageUrl,
    });
  };

  return (
    <Link href={`/products/${product.slug}`} className="group">
      <div className="bg-surface rounded-xl border border-border hover:border-border-hover hover:shadow-md hover:-translate-y-1 transition-all duration-300 p-4">
        <div className="aspect-square bg-surface-elevated rounded-lg mb-4 flex items-center justify-center overflow-hidden">
          <div className="text-4xl font-display font-bold text-text-muted/30 select-none">
            {product.code}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs text-text-muted font-medium uppercase tracking-wider">
            {product.category.name}
          </p>
          <h3 className="font-display font-semibold text-text-primary group-hover:text-primary-light">
            {product.name}
          </h3>
          {product.size && (
            <p className="text-sm text-text-secondary">{product.size}</p>
          )}
          <div className="flex items-center justify-between pt-2">
            <span className="font-display font-bold text-lg">{formatPrice(product.price)}</span>
            <Button
              variant="primary"
              size="sm"
              onClick={handleAddToCart}
              disabled={product.stock === 0}
            >
              <ShoppingCart className="w-4 h-4" />
            </Button>
          </div>
          {product.stock === 0 && (
            <p className="text-xs text-danger font-medium">Out of stock</p>
          )}
          {product.stock > 0 && product.stock <= 5 && (
            <p className="text-xs text-warning font-medium">Low stock</p>
          )}
        </div>
      </div>
    </Link>
  );
}
