'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Product } from '@/types';
import { ProductCard } from './ProductCard';

interface Props {
  products: Product[];
}

export function FeaturedRail({ products }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // A tolerance, not an exact 0/max comparison: with scroll-snap + smooth
  // scrollBy, scrollLeft routinely settles a fraction of a pixel short of
  // its true rest value (sub-pixel layout), and once at rest no further
  // 'scroll' event fires to correct it — an exact >0 check left the left
  // arrow stuck visible at the very start of the rail.
  const EDGE_TOLERANCE = 4;

  const updateArrows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > EDGE_TOLERANCE);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - EDGE_TOLERANCE);
  }, []);

  useEffect(() => {
    updateArrows();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateArrows, { passive: true });
    window.addEventListener('resize', updateArrows);
    return () => {
      el.removeEventListener('scroll', updateArrows);
      window.removeEventListener('resize', updateArrows);
    };
  }, [updateArrows]);

  // Touch and trackpad already scroll this rail natively (they send real
  // deltaX). A plain mouse wheel only ever sends vertical deltaY with
  // nothing to translate it into horizontal movement, so on Windows with a
  // regular mouse the rail is simply unscrollable — translate it here.
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    scrollRef.current?.scrollBy({ left: e.deltaY });
  };

  const scrollByPage = (direction: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    const cardWidth = (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? 220;
    el.scrollBy({ left: direction * (cardWidth + 16) * 2, behavior: 'smooth' });
  };

  return (
    <div className="relative">
      {canScrollLeft && (
        <button
          onClick={() => scrollByPage(-1)}
          aria-label="Scroll left"
          className="hidden sm:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 items-center justify-center w-9 h-9 rounded-full bg-surface border border-border shadow-md hover:bg-surface-elevated cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      )}

      <div
        ref={scrollRef}
        onWheel={handleWheel}
        className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 snap-x snap-mandatory scrollbar-hide"
      >
        {products.map((product) => (
          <div key={product.id} className="w-[200px] sm:w-[220px] shrink-0 snap-start">
            <ProductCard product={product} />
          </div>
        ))}
      </div>

      {canScrollRight && (
        <button
          onClick={() => scrollByPage(1)}
          aria-label="Scroll right"
          className="hidden sm:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-10 items-center justify-center w-9 h-9 rounded-full bg-surface border border-border shadow-md hover:bg-surface-elevated cursor-pointer"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
