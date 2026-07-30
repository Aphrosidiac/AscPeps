'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { X, ExternalLink, Maximize2 } from 'lucide-react';
import type { InsightFigure } from '@/types';

/**
 * Numbered figure grid for an article, in the shape a journal paper uses: the
 * body refers to "Figure 2", and the figures themselves sit together below it.
 *
 * Two details here are load-bearing rather than cosmetic:
 *
 *  - `object-contain` on a neutral panel, never `object-cover`. These are
 *    diagrams with axis labels and legends baked into the image; cropping to
 *    fill the box silently cuts the meaning off.
 *  - Click to enlarge. The article column is max-w-3xl, so a figure in a
 *    two-up grid lands around 350px wide — unreadable for anything with text
 *    in it.
 */
export function InsightFigures({ figures }: { figures: InsightFigure[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const open = openIndex !== null ? figures[openIndex] : null;

  const close = useCallback(() => setOpenIndex(null), []);

  useEffect(() => {
    if (open === null) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      // Arrow keys page through the set, which is the natural thing to try once
      // you're already zoomed into one figure.
      if (e.key === 'ArrowRight') setOpenIndex((i) => (i === null ? i : (i + 1) % figures.length));
      if (e.key === 'ArrowLeft') setOpenIndex((i) => (i === null ? i : (i - 1 + figures.length) % figures.length));
    };
    window.addEventListener('keydown', onKey);

    // The overlay scrolls its own content; letting the page scroll behind it
    // means closing the lightbox drops you somewhere else in the article.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, close, figures.length]);

  if (figures.length === 0) return null;

  return (
    <section className="my-8">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-3">
        Figures
      </p>

      <div className="grid sm:grid-cols-2 gap-4">
        {figures.map((figure, index) => (
          <figure
            key={figure.id}
            className="border border-border rounded-xl overflow-hidden bg-surface flex flex-col"
          >
            <button
              type="button"
              onClick={() => setOpenIndex(index)}
              aria-label={`Enlarge Figure ${figure.order}`}
              className="relative aspect-[4/3] bg-white group cursor-zoom-in"
            >
              <Image
                src={figure.imageUrl}
                alt={figure.altText || figure.caption}
                fill
                sizes="(min-width: 640px) 384px, 100vw"
                className="object-contain p-3"
              />
              <span className="absolute top-2 right-2 p-1.5 rounded-md bg-black/55 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity">
                <Maximize2 className="w-3.5 h-3.5" />
              </span>
            </button>

            <figcaption className="p-4 border-t border-border text-sm leading-relaxed">
              <span className="font-semibold">Figure {figure.order}</span>{' '}
              <span className="text-text-secondary">{figure.caption}</span>
              {figure.credit && (
                <span className="block mt-1.5 text-xs text-text-muted">
                  {figure.creditUrl ? (
                    <a
                      href={figure.creditUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="inline-flex items-center gap-1 underline hover:text-text-secondary transition-colors"
                    >
                      {figure.credit} <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : (
                    figure.credit
                  )}
                </span>
              )}
            </figcaption>
          </figure>
        ))}
      </div>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Figure ${open.order}`}
          onClick={close}
          className="fixed inset-0 z-50 bg-black/85 flex flex-col items-center justify-center p-4 sm:p-8"
        >
          <button
            type="button"
            onClick={close}
            aria-label="Close figure"
            className="absolute top-4 right-4 p-2 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Stop the backdrop's close handler firing when the figure itself is
              clicked — people click the image to look closer, not to dismiss. */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-5xl flex-1 min-h-0 bg-white rounded-lg overflow-hidden"
          >
            <Image
              src={open.imageUrl}
              alt={open.altText || open.caption}
              fill
              sizes="(min-width: 1024px) 1024px, 100vw"
              className="object-contain p-4"
            />
          </div>

          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-5xl mt-4 text-sm text-white/90 shrink-0"
          >
            <span className="font-semibold">Figure {open.order}</span>{' '}
            <span className="text-white/70">{open.caption}</span>
            {open.credit && <span className="block mt-1 text-xs text-white/50">{open.credit}</span>}
            {figures.length > 1 && (
              <span className="block mt-2 text-xs text-white/40">
                {openIndex! + 1} of {figures.length}{' '}&middot;{' '}use ← → to browse
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
