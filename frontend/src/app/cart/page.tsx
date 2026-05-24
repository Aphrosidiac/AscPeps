'use client';

import Link from 'next/link';
import { Trash2, ShoppingCart } from 'lucide-react';
import { useCart } from '@/lib/cart';
import { formatPrice } from '@/lib/utils';
import { Button } from '@/components/ui/Button';

export default function CartPage() {
  const { items, removeItem, updateQuantity, total, itemCount } = useCart();

  if (items.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <ShoppingCart className="w-16 h-16 text-text-muted mx-auto mb-4" />
        <h1 className="font-display text-2xl font-bold mb-2">Your cart is empty</h1>
        <p className="text-text-secondary mb-6">Browse our products and add items to your cart.</p>
        <Link href="/products"><Button>Browse Products</Button></Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="font-display text-3xl font-bold mb-8">Shopping Cart</h1>

      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-4">
          {items.map((item) => (
            <div key={item.productId} className="bg-surface rounded-xl border border-border p-4 flex items-center gap-4">
              <div className="w-16 h-16 bg-surface-elevated rounded-lg flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-text-muted">{item.code}</span>
              </div>

              <div className="flex-1 min-w-0">
                <h3 className="font-medium truncate">{item.name}</h3>
                <p className="text-sm text-text-secondary">{formatPrice(item.price)}</p>
              </div>

              <div className="flex items-center border border-border rounded-lg">
                <button
                  onClick={() => updateQuantity(item.productId, Math.max(1, item.quantity - 1))}
                  className="px-2 py-1 text-text-secondary hover:text-text-primary cursor-pointer"
                >
                  -
                </button>
                <span className="px-3 py-1 text-sm font-medium">{item.quantity}</span>
                <button
                  onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                  className="px-2 py-1 text-text-secondary hover:text-text-primary cursor-pointer"
                >
                  +
                </button>
              </div>

              <p className="font-semibold w-24 text-right">{formatPrice(item.price * item.quantity)}</p>

              <button onClick={() => removeItem(item.productId)} className="p-2 text-text-muted hover:text-danger transition-colors cursor-pointer">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="bg-surface rounded-xl border border-border p-6 h-fit sticky top-24">
          <h3 className="font-display font-semibold text-lg mb-4">Order Summary</h3>
          <div className="space-y-2 mb-4">
            <div className="flex justify-between text-sm text-text-secondary">
              <span>Items ({itemCount})</span>
              <span>{formatPrice(total)}</span>
            </div>
          </div>
          <div className="border-t border-border pt-4 mb-6">
            <div className="flex justify-between font-display font-bold text-lg">
              <span>Total</span>
              <span>{formatPrice(total)}</span>
            </div>
          </div>
          <Link href="/checkout" className="block">
            <Button className="w-full" size="lg">Proceed to Checkout</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
