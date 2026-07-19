'use client';

import Link from 'next/link';
import { Trash2, ShoppingCart } from 'lucide-react';
import { useCart } from '@/lib/cart';
import { formatPrice } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Animate, Stagger } from '@/components/ui/Animate';

export default function CartPage() {
  const { items, removeItem, updateQuantity, total, itemCount } = useCart();

  if (items.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <Animate variant="scale" duration={0.5}>
        <ShoppingCart className="w-16 h-16 text-text-muted mx-auto mb-4" />
        <h1 className="font-display text-2xl font-bold mb-2">Your cart is empty</h1>
        <p className="text-text-secondary mb-6">Browse our products and add items to your cart.</p>
        <Link href="/products"><Button>Browse Products</Button></Link>
        </Animate>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Animate variant="fadeUp" duration={0.5}>
        <h1 className="font-display text-3xl font-bold mb-8">Shopping Cart</h1>
      </Animate>

      <div className="grid lg:grid-cols-3 gap-8">
        <Stagger className="lg:col-span-2 space-y-4" stagger={0.08}>
          {items.map((item) => (
            <div key={item.variantId} className="bg-surface rounded-xl border border-border p-4">
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 sm:w-16 sm:h-16 bg-surface-elevated rounded-lg flex items-center justify-center shrink-0 overflow-hidden">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xs font-bold text-text-muted">{item.code}</span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-sm sm:text-base truncate">{item.name}</h3>
                  <p className="text-sm text-text-secondary">{formatPrice(item.price)}</p>
                </div>

                <button onClick={() => removeItem(item.variantId)} className="p-2 text-text-muted hover:text-danger transition-colors cursor-pointer shrink-0">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                <div className="flex items-center border border-border rounded-lg">
                  <button
                    onClick={() => updateQuantity(item.variantId, Math.max(1, item.quantity - 1))}
                    className="px-3 py-1.5 text-text-secondary hover:text-text-primary cursor-pointer"
                  >
                    -
                  </button>
                  <span className="px-4 py-1.5 text-sm font-medium">{item.quantity}</span>
                  <button
                    onClick={() => updateQuantity(item.variantId, item.quantity + 1)}
                    className="px-3 py-1.5 text-text-secondary hover:text-text-primary cursor-pointer"
                  >
                    +
                  </button>
                </div>
                <p className="font-display font-bold text-lg">{formatPrice(item.price * item.quantity)}</p>
              </div>
            </div>
          ))}
        </Stagger>

        <Animate variant="fadeUp" delay={0.2}>
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
        </Animate>
      </div>
    </div>
  );
}
