'use client';

import { useMemo, useRef, useState } from 'react';
import { Check, ShieldCheck, Wallet, User, BadgeCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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
  cryptoEnabled: boolean;
}

/**
 * One reassurance badge in the block under Add to Cart. Extracted rather than
 * copied a fourth time — the checkout's payment cards were three hand-copied
 * blocks and drifted out of alignment precisely because nothing forced them to
 * stay identical.
 *
 * `items-start` rather than `items-center`: at narrow widths the label wraps to
 * two lines, and centring floats the icon into the middle of the text block
 * instead of keeping it on the first line where it reads as a marker.
 */
function TrustBadge({ icon: Icon, label, detail }: { icon: LucideIcon; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-2.5 bg-surface-elevated rounded-lg px-3 py-2.5">
      <Icon className="w-4 h-4 text-text-muted shrink-0 mt-0.5" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs font-semibold leading-snug">{label}</p>
        <p className="text-[11px] text-text-muted leading-snug">{detail}</p>
      </div>
    </div>
  );
}

/**
 * Fakhrul's figure, covering every channel the business sells through.
 *
 * Do NOT "correct" this down against the orders table. That table only holds
 * orders placed through this site — 36 distinct phone numbers, 26 of them paid
 * at the time of writing — and misses the WhatsApp and direct sales that make
 * up the rest. The database is a floor on the real number, not the number.
 */
const TRUSTED_BUYER_COUNT = 100;

/**
 * Social proof under the badge grid. Deliberately NOT another grey card: it's a
 * different kind of claim from "we ship for RM10", and giving it the same
 * treatment is what made it read as filler.
 *
 * The avatars are generic on purpose. The obvious version of this pattern uses
 * customer photos and first names, but this store has neither — inventing them
 * would be fabricated social proof, and using real buyers' details would leak
 * customer identity onto a public product page for a regulated substance.
 * Anonymous silhouettes make the same visual point while only claiming what the
 * number claims. Swap in real avatars if consented testimonials ever exist.
 */
function SocialProof() {
  return (
    // Stacks below sm. Side-by-side, the line wraps at phone widths and leaves
    // the avatars floating against a two-line block with a ragged tail — and
    // once it fills the column there is no slack left, so "centred" stops
    // meaning anything. Stacked and centre-aligned it reads as deliberate at
    // every width.
    <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-2.5 text-center sm:text-left">
      <div className="flex -space-x-2 shrink-0" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            // ring in the page background colour, not a border, so the discs
            // read as overlapping cut-outs rather than three touching circles.
            className="w-7 h-7 rounded-full bg-surface-elevated ring-2 ring-surface flex items-center justify-center"
          >
            <User className="w-3.5 h-3.5 text-text-muted" />
          </span>
        ))}
      </div>
      <p className="text-xs text-text-muted leading-snug">
        <span className="font-semibold text-text-primary">Trusted by {TRUSTED_BUYER_COUNT}+</span>
        <BadgeCheck className="inline-block w-3.5 h-3.5 text-blue-500 align-text-bottom mx-1" aria-hidden="true" />
        buyers &amp; researchers across Malaysia
      </p>
    </div>
  );
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
  const selectedVariant = index >= 0 ? variants[index] : undefined;
  const pricing = getUnitPricing(variants);

  const step = (delta: number) => {
    const next = (index + delta + variants.length) % variants.length;
    onSelect(variants[next]);
    refs.current[next]?.focus();
  };

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-sm font-medium">Size</p>
        <p className="text-sm text-text-secondary">{selectedVariant?.size ?? ''}</p>
      </div>

      {/* A grid of cards rather than a row of small pills. The details column
          is ~550px wide and the pills were using a third of it, while the
          information that actually decides the purchase (unit price, which
          size is best value) was squeezed into 11px text or exiled to a line
          underneath. pt-2.5 reserves room for the badge that overhangs the
          top edge of the best-value card. */}
      <div
        role="radiogroup"
        aria-label="Choose a size"
        className="grid grid-cols-3 gap-2.5 pt-2.5"
      >
        {variants.map((v, i) => {
          const selected = v.id === selectedId;
          const soldOut = v.stock === 0;
          const perUnit = pricing?.byId.get(v.id);
          const isBest = pricing?.hasSpread && v.id === pricing.bestId && !soldOut;
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
              // border-2 on every state, not just the selected one: switching
              // between 1px and 2px would shift every neighbouring card by a
              // pixel on each selection.
              className={`relative rounded-xl border-2 px-3.5 py-3 text-left cursor-pointer transition-[border-color,background-color,box-shadow] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 ${
                selected
                  ? 'border-primary bg-surface shadow-sm'
                  : 'border-border bg-surface hover:border-border-hover'
              } ${soldOut ? 'opacity-60' : ''}`}
            >
              {isBest && (
                // Top-left, not centred: centred it runs into the check circle
                // in the top-right corner on a card this narrow.
                <span className="absolute -top-2.5 left-2.5 whitespace-nowrap rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                  Best value
                </span>
              )}

              {/* Decorative: aria-checked on the button already conveys state. */}
              <span
                aria-hidden="true"
                className={`absolute top-2.5 right-2.5 w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                  selected ? 'border-primary bg-primary' : 'border-border'
                }`}
              >
                {selected && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
              </span>

              <span className="block text-[17px] font-semibold leading-snug pr-5">
                {v.size ?? v.code}
              </span>
              <span className="block text-sm mt-1.5 leading-tight">
                {soldOut ? (
                  <span className="text-text-muted">Sold out</span>
                ) : (
                  formatPrice(getEffectivePrice(v))
                )}
              </span>
              {!soldOut && perUnit != null && (
                <span className="block text-xs mt-0.5 leading-tight text-text-muted">
                  {formatPrice(Math.round(perUnit))}/{pricing!.unit}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// The whole variant-reactive hero: photo + size picker + price + stock +
// Add to Cart all live in one client component so picking a different size
// swaps them together, without navigating to a different URL. Everything
// below this (dosage info, COA, related-product rails) is static per parent
// and stays server-rendered in page.tsx.
export function VariantSwitcher({ product, benefits, cryptoEnabled }: Props) {
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
              <TrustBadge
                icon={ShieldCheck}
                label="3rd Party Verified"
                detail="Identity & purity tested"
              />
              {/* Crypto is named either way, but only claimed as accepted when
                  the store is actually taking it. Checkout shows Bitcoin as
                  "Soon" while crypto_payment_enabled is off, and a product page
                  promising a method the checkout then refuses is the kind of
                  contradiction a buyer notices at exactly the wrong moment.
                  Flipping the setting upgrades this line automatically. */}
              <TrustBadge
                icon={Wallet}
                label="Flexible Payment"
                detail={cryptoEnabled ? 'DuitNow QR, FPX & crypto' : 'DuitNow QR & FPX, crypto soon'}
              />
            </div>

            <SocialProof />

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
