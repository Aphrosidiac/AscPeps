'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { HardsellSlide, type HardsellSlideProps } from './HardsellSlide';

const AUTO_ADVANCE_MS = 5000;

interface HardsellCarouselProps {
  slides: HardsellSlideProps[];
}

export function HardsellCarousel({ slides }: HardsellCarouselProps) {
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const count = slides.length;

  const goTo = useCallback((i: number) => {
    setIndex(((i % count) + count) % count);
  }, [count]);

  // Paused while hovered — the same interaction that reveals the arrows
  // also stops the slide from being yanked out from under the cursor.
  useEffect(() => {
    if (hovered || count <= 1) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % count), AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
  }, [hovered, count]);

  if (count === 0) return null;

  return (
    <div
      className="relative group/carousel overflow-hidden"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Flex row, one 100%-width slide per item, no fixed height set on
          either the track or the slides — flex's default align-items:
          stretch makes every slide match the tallest one automatically,
          so switching slides never changes the section's height. */}
      <div
        className="flex transition-transform duration-[800ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ transform: `translateX(-${index * 100}%)` }}
      >
        {slides.map((slide, i) => (
          <div key={i} className="w-full shrink-0">
            <HardsellSlide {...slide} />
          </div>
        ))}
      </div>

      {count > 1 && (
        <>
          <button
            onClick={() => goTo(index - 1)}
            aria-label="Previous slide"
            className="absolute left-4 top-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full bg-black/40 backdrop-blur-sm border border-white/20 text-white flex items-center justify-center opacity-0 group-hover/carousel:opacity-100 transition-opacity duration-300 hover:bg-black/60 cursor-pointer"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={() => goTo(index + 1)}
            aria-label="Next slide"
            className="absolute right-4 top-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full bg-black/40 backdrop-blur-sm border border-white/20 text-white flex items-center justify-center opacity-0 group-hover/carousel:opacity-100 transition-opacity duration-300 hover:bg-black/60 cursor-pointer"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </>
      )}
    </div>
  );
}
