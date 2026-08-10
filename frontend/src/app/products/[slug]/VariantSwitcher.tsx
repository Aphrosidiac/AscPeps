'use client';

import { useMemo, useRef, useState } from 'react';
import { Check, ShieldCheck, Truck } from 'lucide-react';
import posthog from 'posthog-js';
import { Animate } from '@/components/ui/Animate';
import { formatPrice, getDefaultVariant, getEffectivePrice, getVariantDisplayName, isSaleActive } from '@/lib/utils';
import { AddToCartPanel } from './AddToCartPanel';
import { ProductGallery, buildSlides } from './ProductGallery';
import { SkuBadge } from '@/components/products/SkuBadge';
import type { Product, ProductVariant } from '@/types';

interface Props {
  product: Product;
  benefits: string[];
  shippingFee: string;
}

/**
 * Price per mg (or mL, or whatever unit the sizes are written in), so the
 * bigger vial can argue for itself: 10mg is RM13.50/mg where 30mg is RM10.33.
 *
 * Returns null unless every active variant parses to a number plus the SAME
 * unit. Sizes are free text and the catalog mixes "10mg" with "3mL" and the
 * occasional null, so a per-unit figure is only meaningful when they all agree,
 * and a wrong one on a purchase page is worse than none.
 */
function getUnitPricing(variants: ProductVariant[]) {
  if (variants.length < 2) return null;
  const parsed = variants.map((v) => {
    const m = /^\s*([\d.]+)\s*(mg|ml|mcg|g|iu)\s*$/i.exec(v.size ?? '');
    if (!m) return null;
    const amount = parseFloat(m[1]);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return { id: v.id, unit: m[2], perUnit: getEffectivePrice(v) / amount };
  });
  if (parsed.some((x) => x === null)) return null;
  const rows = parsed as { id: string; unit: string; perUnit: number }[];
  const unit = rows[0].unit;
  if (rows.some((r) => r.unit.toLowerCase() !== unit.toLowerCase())) return null;

  const best = rows.reduce((a, b) => (b.perUnit < a.perUnit ? b : a));
  return {
    unit,
    byId: new Map(rows.map((r) => [r.id, r.perUnit])),
    bestId: best.id,
    // A "best value" nudge is pointless if every size costs the same per unit.
    hasSpread: rows.some((r) => Math.round(r.perUnit) !== Math.round(best.perUnit)),
  };
}

/**
 * Size picker. Previously three cards each carrying a thumbnail of the same
 * vial photo — the thumbnails distinguished nothing and cost a row of height
 * each, and the picker sat in the left column, far from the price it changes.
 * Now a segmented control directly under the price, so the number that moves
 * is next to the control that moves it.
 *
 * Semantics matter here: this is single-select, so it's a radiogroup with
 * roving tabindex and arrow-key navigation, not a row of aria-pressed
 * buttons. One Tab stop for the whole group, arrows to change size.
 */
function SizeSelector({
  variants,
  selectedId,
  onSelect,
}: {
  variants: ProductVariant[];
  selectedId: string;
  onSelect: (v: ProductVariant) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = variants.findIndex((v) => v.id === selectedId);
  const pricing = getUnitPricing(variants);
  const best = pricing?.bestId ? variants.find((v) => v.id === pricing.bestId) : undefined;

  const step = (delta: number) => {
    const next = (index + delta + variants.length) % variants.length;
    onSelect(variants[next]);
    refs.current[next]?.focus();
  };

  return (
    <div>
    <div role="radiogroup" aria-label="Choose a size" className="flex flex-wrap gap-2">
      {variants.map((v, i) => {
        const selected = v.id === selectedId;
        const soldOut = v.stock === 0;
        const perUnit = pricing?.byId.get(v.id);
        return (
          <button
            key={v.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                step(1);
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                step(-1);
              }
            }}
            onClick={() => onSelect(v)}
            className={`min-w-[104px] rounded-lg border px-4 py-2.5 text-left transition-colors cursor-pointer ${
              selected
                ? 'border-primary bg-primary text-white'
                : 'border-border bg-surface hover:border-border-hover'
            } ${soldOut && !selected ? 'opacity-55' : ''}`}
          >
            <span className="block text-sm font-semibold leading-tight">{v.size ?? v.code}</span>
            <span
              className={`block text-xs mt-0.5 leading-tight ${
                selected ? 'text-white/70' : 'text-text-muted'
              }`}
            >
              {soldOut ? 'Sold out' : formatPrice(getEffectivePrice(v))}
            </span>
            {!soldOut && perUnit != null && (
              <span
                className={`block text-[11px] mt-0.5 leading-tight ${
                  selected ? 'text-white/55' : 'text-text-muted'
                }`}
              >
                {formatPrice(Math.round(perUnit))}/{pricing!.unit}
              </span>
            )}
          </button>
        );
      })}
    </div>
      {/* Only nudge when there is something to nudge toward: a real spread in
          per-unit price, and the customer is not already on the best one. */}
      {pricing?.hasSpread && best && best.id !== selectedId && best.stock > 0 && (
        <p className="mt-2 text-xs text-text-secondary">
          Best value: <span className="font-medium text-text-primary">{best.size}</span> at{' '}
          {formatPrice(Math.round(pricing.byId.get(best.id)!))}/{pricing.unit}
        </p>
      )}
    </div>
  );
}

// The whole variant-reactive hero: photo + size picker + price + stock +
// Add to Cart all live in one client component so picking a different size
// swaps them together, without navigating to a different URL. Everything
// below this (dosage info, COA, related-product rails) is static per parent
// and stays server-rendered in page.tsx.
export function VariantSwitcher({ product, benefits, shippingFee }: Props) {
  // Memoised so `slides` below is genuinely stable: a fresh filter() array
  // every render would defeat its useMemo and re-run the gallery's effect.
  const activeVariants = useMemo(() => product.variants.filter((v) => v.active), [product.variants]);
  const defaultVariant = getDefaultVariant(product);
  const [selectedId, setSelectedId] = useState(defaultVariant?.id ?? '');
  const variant = activeVariants.find((v) => v.id === selectedId) ?? defaultVariant;

  // Slide list is derived, not state: it only depends on the product and its
  // active variants, and useMemo keeps its identity stable so the gallery's
  // variant-follow effect doesn't re-run on every render.
  const slides = useMemo(() => buildSlides(product, activeVariants), [product, activeVariants]);

  if (!variant) {
    return <p className="text-danger font-medium py-8">This product is currently unavailable.</p>;
  }

  const onSale = isSaleActive(variant);
  const effectivePrice = getEffectivePrice(variant);

  return (
    <>
      {/* No `items-start` on the grid on purpose: the left cell has to stretch
          to the full row height for the sticky child inside it to have any
          distance to travel. Previously the photo column ended around 700px
          while the details column ran past 1400px, leaving half the page as
          dead white space on the left. */}
      <div className="grid md:grid-cols-2 gap-8 md:gap-12">
        <div>
          {/* top-24 clears the sticky navbar (top-0, ~72px) plus breathing room. */}
          <div className="md:sticky md:top-24">
            <Animate variant="fade" duration={0.6}>
              <ProductGallery
                slides={slides}
                selectedVariantId={variant.id}
                productName={product.name}
                altFor={(slide, i) =>
                  // A slide that belongs to a size names that size; gallery
                  // shots fall back to the product with a position, so alt
                  // text never repeats verbatim across the strip.
                  slide.variantIds.length > 0
                    ? `${getVariantDisplayName(product, activeVariants.find((v) => slide.variantIds.includes(v.id)) ?? variant)} research peptide available in Malaysia`
                    : `${product.name} research peptide, image ${i + 1}`
                }
                fallback={
                  <span className="text-6xl font-display font-bold text-text-muted/20 select-none">{variant.code}</span>
                }
              />
            </Animate>
          </div>
        </div>

        <Animate variant="fadeUp" delay={0.15} duration={0.6}>
          {/* Ordered so the purchase decision comes first: identity, price,
              size, add-ons, then the button. Description and benefits are
              supporting reading and sit below the CTA rather than pushing it
              off the screen. space-y-6 because AddToCartPanel brings its own
              pt-4/pt-3 leading gaps and was written against that rhythm. */}
          <div className="space-y-6">
            <div>
              <p className="text-sm text-text-muted font-medium uppercase tracking-wider mb-1">{product.category.name}</p>
              <SkuBadge code={variant.code} size="lg" className="block mb-1" />
              {/* Text and tag are unchanged for SEO (matches generateMetadata's
                  <title>) — only the visual weight shrinks now that the code
                  above carries the "first thing you see" role. */}
              <h1 className="font-display text-base sm:text-lg font-medium text-text-secondary">{product.name}</h1>
            </div>

            <div className="flex items-baseline gap-2.5">
              <p className="font-display text-3xl font-bold">{formatPrice(effectivePrice)}</p>
              {onSale && <p className="text-lg text-text-muted line-through">{formatPrice(variant.price)}</p>}
            </div>

            {activeVariants.length > 1 && (
              <SizeSelector
                variants={activeVariants}
                selectedId={variant.id}
                onSelect={(v) => {
                  if (v.id !== variant.id) {
                    posthog.capture('product_variant_selected', {
                      product_name: product.name,
                      variant_code: v.code,
                      variant_size: v.size,
                    });
                  }
                  setSelectedId(v.id);
                }}
              />
            )}

            {variant.stock === 0 && <p className="text-danger text-sm font-medium">Out of stock</p>}
            {variant.stock > 0 && variant.stock <= 5 && (
              <p className="text-warning text-sm">Only {variant.stock} left in stock</p>
            )}

            <AddToCartPanel
              key={variant.id}
              variantId={variant.id}
              code={variant.code}
              name={getVariantDisplayName(product, variant)}
              size={variant.size}
              price={effectivePrice}
              imageUrl={variant.imageUrl}
              stock={variant.stock}
              addOns={product.addOns}
              addOnReminder={product.addOnReminder}
            />

            {/* This badge deliberately does NOT link to product.coaUrl, even
                though every product has one. 48 of the 50 populated coaUrl
                values are the same shared Janoshik "Blind_GLP" certificate, so
                for almost every product that link resolves to a test for a
                different substance. Down in the COA section that inaccuracy is
                pre-existing and known; promoting it to a trust badge beside Add
                to Cart would be actively misleading at the moment of purchase.
                Wire this up once COAs are per-product. */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2.5 bg-surface-elevated rounded-lg px-3 py-2.5">
                <ShieldCheck className="w-4 h-4 text-text-muted shrink-0" />
                <div>
                  <p className="text-xs font-semibold">3rd Party Verified</p>
                  <p className="text-[11px] text-text-muted">Identity &amp; purity tested</p>
                </div>
              </div>
              <div className="flex items-center gap-2.5 bg-surface-elevated rounded-lg px-3 py-2.5">
                <Truck className="w-4 h-4 text-text-muted shrink-0" />
                <div>
                  <p className="text-xs font-semibold">
                    {!shippingFee || shippingFee === '0' ? 'Free Shipping' : `Shipping: RM${shippingFee}`}
                  </p>
                  <p className="text-[11px] text-text-muted">
                    {!shippingFee || shippingFee === '0' ? 'All orders, Peninsular Malaysia' : 'Peninsular Malaysia delivery'}
                  </p>
                </div>
              </div>
            </div>

            <p className="text-xs text-text-muted italic">For research and laboratory use only.</p>

            {(product.description || benefits.length > 0) && (
              <div className="pt-1 space-y-5 border-t border-border">
                {product.description && (
                  <p className="text-text-secondary leading-relaxed pt-5">{product.description}</p>
                )}

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
              </div>
            )}
          </div>
        </Animate>
      </div>
    </>
  );
}
