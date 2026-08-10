'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Product, ProductVariant } from '@/types';

export interface GallerySlide {
  url: string;
  /** Variants whose own image this is. Empty for product-level gallery shots. */
  variantIds: string[];
}

/**
 * Builds the slide list for a product.
 *
 * Variant images come first and in variant order, because the size picker
 * jumps into them by index. They are de-duplicated by URL: most products in
 * this catalog reuse one photo across every size, and repeating it once per
 * size would give a thumbnail strip of identical pictures. When two sizes do
 * share an image, both ids map to the same slide, so selecting either lands
 * in the right place.
 *
 * Product-level gallery images follow, in the order the admin arranged them.
 */
export function buildSlides(product: Product, variants: ProductVariant[]): GallerySlide[] {
  const slides: GallerySlide[] = [];
  const byUrl = new Map<string, GallerySlide>();

  for (const v of variants) {
    if (!v.imageUrl) continue;
    const existing = byUrl.get(v.imageUrl);
    if (existing) {
      existing.variantIds.push(v.id);
    } else {
      const slide: GallerySlide = { url: v.imageUrl, variantIds: [v.id] };
      byUrl.set(v.imageUrl, slide);
      slides.push(slide);
    }
  }

  for (const img of product.images ?? []) {
    if (byUrl.has(img.url)) continue; // already shown as a variant image
    const slide: GallerySlide = { url: img.url, variantIds: [] };
    byUrl.set(img.url, slide);
    slides.push(slide);
  }

  return slides;
}

interface Props {
  slides: GallerySlide[];
  /** Currently selected variant. The gallery follows it. */
  selectedVariantId: string;
  productName: string;
  /** Label for the active slide, used for alt text. */
  altFor: (slide: GallerySlide, index: number) => string;
  /** Fallback shown when the product has no images at all. */
  fallback?: React.ReactNode;
}

export function ProductGallery({ slides, selectedVariantId, productName, altFor, fallback }: Props) {
  // `previous` is carried alongside `current` because the outgoing image has to
  // stay on screen, fully opaque, underneath the incoming one for the whole
  // transition. See the layer comment in the render for why.
  const [pos, setPos] = useState({ current: 0, previous: 0 });
  // Tracks which variant the index was last synced to, so "the variant
  // changed" can be told apart from "the customer is browsing". Without that
  // distinction, following the variant would fight the customer and every
  // arrow press would snap back to the variant's own slide.
  const [syncedVariant, setSyncedVariant] = useState(selectedVariantId);

  // Start point of an in-progress drag; null when no pointer is down.
  const swipe = useRef<{ x: number; y: number } | null>(null);

  const count = slides.length;
  const goTo = (next: number) => setPos((s) => (next === s.current ? s : { current: next, previous: s.current }));

  // Follow the size picker: selecting a size moves the gallery to that size's
  // photo, which is what the picker implies. Done during render rather than in
  // an effect — this is React's documented way to adjust state when a prop
  // changes, and it avoids a second paint at the old index.
  if (syncedVariant !== selectedVariantId) {
    setSyncedVariant(selectedVariantId);
    const target = slides.findIndex((s) => s.variantIds.includes(selectedVariantId));
    if (target >= 0) goTo(target);
  }

  const safeIndex = count > 0 ? Math.min(pos.current, count - 1) : 0;
  const prevIndex = count > 0 ? Math.min(pos.previous, count - 1) : 0;

  if (count === 0) {
    return (
      <div className="relative aspect-square bg-surface-elevated rounded-xl border border-border flex items-center justify-center overflow-hidden">
        {fallback}
      </div>
    );
  }

  const go = (delta: number) => goTo((safeIndex + delta + count) % count);

  return (
    <div>
      <div
        className="relative aspect-square bg-surface-elevated rounded-xl border border-border overflow-hidden group touch-pan-y select-none"
        role="group"
        aria-roledescription="carousel"
        aria-label={`${productName} images`}
        tabIndex={0}
        onPointerDown={(e) => {
          swipe.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={(e) => {
          const start = swipe.current;
          swipe.current = null;
          if (!start || count < 2) return;
          const dx = e.clientX - start.x;
          const dy = e.clientY - start.y;
          // Only act on a clearly horizontal drag, so a vertical scroll that
          // happens to begin on the photo is never stolen. Taps (dx ~ 0) fall
          // through, which leaves the arrow buttons working normally.
          if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy)) return;
          go(dx < 0 ? 1 : -1);
        }}
        onPointerCancel={() => {
          swipe.current = null;
        }}
        onKeyDown={(e) => {
          if (count < 2) return;
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            go(1);
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            go(-1);
          }
        }}
      >
        {/* Every slide is a stacked layer that stays mounted. Only the incoming
            one animates: it fades 0 -> 1 on top of the outgoing one, which is
            held at full opacity underneath until it is completely covered.
            Two things this gets right that the previous version did not:

            The old approach remounted a single <img> on a changed key, so the
            outgoing image vanished instantly and the panel's grey background
            was visible for the whole fade. That read as a flash to white, and
            it happened on every change regardless of caching.

            Cross-fading both layers at once does not fix it either: at the
            midpoint a 0.5-opacity image over another 0.5-opacity image lets
            roughly a quarter of the backdrop through. Only the incoming layer
            may animate; the outgoing one must stay opaque.

            Keeping every layer mounted also means each image decodes once, so
            revisiting a slide is instant. */}
        {slides.map((s, i) => {
          const isActive = i === safeIndex;
          const isOutgoing = i === prevIndex && !isActive;
          return (
            <div
              key={s.url}
              aria-hidden={!isActive}
              className={`absolute inset-0 ${
                isActive ? 'transition-opacity duration-300 ease-out motion-reduce:transition-none' : ''
              }`}
              style={{
                opacity: isActive || isOutgoing ? 1 : 0,
                // The incoming layer must paint above the one it is covering.
                // DOM order alone would put slide 1 under slide 3 when going
                // backwards.
                zIndex: isActive ? 2 : isOutgoing ? 1 : 0,
              }}
            >
              <Image
                src={s.url}
                alt={isActive ? altFor(s, i) : ''}
                fill
                sizes="(min-width: 768px) 50vw, 100vw"
                priority={i === 0}
                className="object-cover"
              />
            </div>
          );
        })}

        {count > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous image"
              className="absolute z-10 left-2 top-1/2 -translate-y-1/2 w-11 h-11 md:w-9 md:h-9 rounded-full bg-surface/90 border border-border flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface transition-[color,background-color,opacity] cursor-pointer shadow-sm md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:focus-visible:opacity-100"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next image"
              className="absolute z-10 right-2 top-1/2 -translate-y-1/2 w-11 h-11 md:w-9 md:h-9 rounded-full bg-surface/90 border border-border flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface transition-[color,background-color,opacity] cursor-pointer shadow-sm md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:focus-visible:opacity-100"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
            {/* Position readout, mainly for screen readers and small screens
                where the arrows sit over the photo. */}
            <p className="absolute z-10 bottom-2 right-2 text-[11px] px-2 py-0.5 rounded-full bg-surface/85 text-text-secondary border border-border">
              <span className="sr-only">Image </span>
              {safeIndex + 1} / {count}
            </p>
          </>
        )}
      </div>

      {/* Thumbnails are centred via an inner `w-max mx-auto` rather than
          `justify-center` on the scroller: with justify-center, once the strip
          is wider than the column the overflow spills equally both ways and the
          left-most thumbnails become unreachable by scrolling. w-max sizes the
          row to its content, so mx-auto centres it while it fits and simply
          does nothing once it overflows and scrolls normally. */}
      {count > 1 && (
        <div className="mt-3 overflow-x-auto pb-1">
          <div className="flex gap-2 w-max mx-auto" role="tablist" aria-label="Product images">
            {slides.map((s, i) => {
              const active = i === safeIndex;
              return (
                <button
                  key={s.url}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-label={`Show image ${i + 1} of ${count}`}
                  onClick={() => goTo(i)}
                  className={`relative w-16 h-16 shrink-0 rounded-lg overflow-hidden border transition-colors cursor-pointer ${
                    active ? 'border-primary' : 'border-border hover:border-border-hover'
                  }`}
                >
                  <Image src={s.url} alt="" fill sizes="64px" className="object-cover" />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
