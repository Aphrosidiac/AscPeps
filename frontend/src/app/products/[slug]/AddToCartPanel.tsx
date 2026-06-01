'use client';

import { useState } from 'react';
import { ShoppingCart, Check } from 'lucide-react';
import { useCart } from '@/lib/cart';
import { Button } from '@/components/ui/Button';

interface Props {
  productId: string;
  code: string;
  name: string;
  size: string | null;
  price: number;
  imageUrl: string | null;
  stock: number;
}

export function AddToCartPanel({ productId, code, name, size, price, imageUrl, stock }: Props) {
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const { addItem } = useCart();

  const handleAddToCart = () => {
    addItem({
      productId,
      code,
      name: `${name}${size ? ` ${size}` : ''}`,
      size,
      price,
      quantity,
      imageUrl,
    });
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  return (
    <div className="flex items-center gap-4 pt-4">
      <div className="flex items-center border border-border rounded-lg">
        <button
          onClick={() => setQuantity(Math.max(1, quantity - 1))}
          className="px-3 py-2 text-text-secondary hover:text-text-primary cursor-pointer"
          aria-label="Decrease quantity"
        >
          -
        </button>
        <span className="px-4 py-2 font-medium min-w-[3rem] text-center">{quantity}</span>
        <button
          onClick={() => setQuantity(quantity + 1)}
          className="px-3 py-2 text-text-secondary hover:text-text-primary cursor-pointer"
          aria-label="Increase quantity"
        >
          +
        </button>
      </div>
      <Button onClick={handleAddToCart} disabled={stock === 0} size="lg" className="flex-1">
        {added ? (
          <><Check className="w-4 h-4" /> Added</>
        ) : (
          <><ShoppingCart className="w-4 h-4" /> Add to Cart</>
        )}
      </Button>
    </div>
  );
}
