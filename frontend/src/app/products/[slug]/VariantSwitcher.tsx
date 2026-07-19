'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Check, ShieldCheck, Truck } from 'lucide-react';
import { Animate } from '@/components/ui/Animate';
import { formatPrice, getEffectivePrice, isSaleActive } from '@/lib/utils';
import { AddToCartPanel } from './AddToCartPanel';
import type { Product } from '@/types';

interface Props {
  product: Product;
  benefits: string[];
  shippingFee: string;
}

// The whole variant-reactive hero: photo + size picker + price + stock +
// Add to Cart all live in one client component so picking a different size
// swaps them together, without navigating to a different URL. Everything
// below this (dosage info, COA, related-product rails) is static per parent
// and stays server-rendered in page.tsx.
export function VariantSwitcher({ product, benefits, shippingFee }: Props) {
  const activeVariants = product.variants.filter((v) => v.active);
  const defaultVariant = activeVariants.length
    ? activeVariants.reduce((min, v) => (v.price < min.price ? v : min))
    : null;
  const [selectedId, setSelectedId] = useState(defaultVariant?.id ?? '');
  const variant = activeVariants.find((v) => v.id === selectedId) ?? defaultVariant;

  if (!variant) {
    return <p className="text-danger font-medium py-8">This product is currently unavailable.</p>;
  }

  const onSale = isSaleActive(variant);
  const effectivePrice = getEffectivePrice(variant);

  return (
    <>
      <div className="grid md:grid-cols-2 gap-6 md:gap-8">
        <Animate variant="fade" duration={0.6}>
          <div className="relative aspect-square max-w-[280px] mx-auto sm:max-w-none sm:mx-0 bg-surface-elevated rounded-xl border border-border flex items-center justify-center overflow-hidden">
            {variant.imageUrl ? (
              <Image
                key={variant.id}
                src={variant.imageUrl}
                alt={`${product.name}${variant.size ? ` ${variant.size}` : ''} — research peptide available in Malaysia`}
                fill
                sizes="(min-width: 768px) 50vw, 280px"
                priority
                className="object-cover"
              />
            ) : (
              <span className="text-6xl font-display font-bold text-text-muted/20 select-none">{variant.code}</span>
            )}
          </div>
        </Animate>

        <Animate variant="fadeUp" delay={0.15} duration={0.6}>
          <div className="space-y-6">
            <div>
              <p className="text-sm text-text-muted font-medium uppercase tracking-wider mb-1">{product.category.name}</p>
              <h1 className="font-display text-3xl font-bold">{product.name}</h1>
            </div>

            {activeVariants.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" role="group" aria-label="Choose a size">
                {activeVariants.map((v) => {
                  const selected = v.id === variant.id;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setSelectedId(v.id)}
                      aria-pressed={selected}
                      className={`shrink-0 flex flex-col items-center gap-1.5 rounded-lg border px-3 py-2 min-w-[76px] transition-colors cursor-pointer ${
                        selected ? 'border-primary bg-primary/5' : 'border-border hover:border-border-hover'
                      }`}
                    >
                      <div className="relative w-10 h-10 rounded bg-surface-elevated overflow-hidden flex items-center justify-center">
                        {v.imageUrl ? (
                          <Image src={v.imageUrl} alt={v.size ?? v.code} fill sizes="40px" className="object-cover" />
                        ) : (
                          <span className="text-[9px] font-bold text-text-muted">{v.code}</span>
                        )}
                      </div>
                      <span className="text-xs font-medium whitespace-nowrap">{v.size ?? v.code}</span>
                      <span className="text-[11px] text-text-muted whitespace-nowrap">{formatPrice(getEffectivePrice(v))}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex items-baseline gap-2.5">
              <p className="font-display text-3xl font-bold">{formatPrice(effectivePrice)}</p>
              {onSale && <p className="text-lg text-text-muted line-through">{formatPrice(variant.price)}</p>}
            </div>

            {product.description && <p className="text-text-secondary leading-relaxed">{product.description}</p>}

            {benefits.length > 0 && (
              <div>
                <h2 className="font-display font-semibold mb-3 text-base">Benefits</h2>
                <ul className="space-y-2">
                  {benefits.map((b, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                      <Check className="w-4 h-4 text-success mt-0.5 shrink-0" />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <AddToCartPanel
              variantId={variant.id}
              code={variant.code}
              name={variant.size ? `${product.name} ${variant.size}` : product.name}
              size={variant.size}
              price={effectivePrice}
              imageUrl={variant.imageUrl}
              stock={variant.stock}
              addOns={product.addOns}
              addOnReminder={product.addOnReminder}
            />

            {variant.stock === 0 && <p className="text-danger font-medium">Out of stock</p>}
            {variant.stock > 0 && variant.stock <= 5 && <p className="text-warning text-sm">Only {variant.stock} left in stock</p>}

            <p className="text-xs text-text-muted italic">For research and laboratory use only.</p>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="flex items-center gap-2.5 bg-surface-elevated rounded-lg px-3 py-2.5">
                <ShieldCheck className="w-4 h-4 text-text-muted shrink-0" />
                <div>
                  <p className="text-xs font-semibold">3rd Party Verified</p>
                  <p className="text-[11px] text-text-muted">Identity & purity tested</p>
                </div>
              </div>
              <div className="flex items-center gap-2.5 bg-surface-elevated rounded-lg px-3 py-2.5">
                <Truck className="w-4 h-4 text-text-muted shrink-0" />
                <div>
                  <p className="text-xs font-semibold">
                    {!shippingFee || shippingFee === '0' ? 'Free Shipping' : `Shipping: RM${shippingFee}`}
                  </p>
                  <p className="text-[11px] text-text-muted">
                    {!shippingFee || shippingFee === '0' ? 'All orders, nationwide' : 'Nationwide delivery'}
                  </p>
                </div>
              </div>
            </div>

            <p className="text-xs text-text-muted">Product Code: {variant.code}</p>
          </div>
        </Animate>
      </div>
    </>
  );
}
