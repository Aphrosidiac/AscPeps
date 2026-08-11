'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

interface AnnouncementBarProps {
  enabled: boolean;
  text: string;
}

/**
 * One line, always.
 *
 * The text is admin-editable and the current one runs to three wrapped lines on
 * a 390px screen — a third of the first viewport spent on a banner, before the
 * logo, before the product. Clamping it would silently hide most of what an
 * operator wrote, so instead it stays a single line and scrolls when it does
 * not fit.
 *
 * Only when it does not fit. A short notice on a desktop width sits still and
 * centred, because a marquee that runs when there is nothing to reveal is just
 * motion for its own sake.
 */
export function AnnouncementBar({ enabled, text }: AnnouncementBarProps) {
  const [dismissed, setDismissed] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const [durationSec, setDurationSec] = useState(20);
  const viewportRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    const measure = measureRef.current;
    if (!viewport || !measure) return;

    const check = () => {
      const contentWidth = measure.scrollWidth;
      const available = viewport.clientWidth;
      const needsScroll = contentWidth > available;
      setOverflowing(needsScroll);
      // Constant reading speed rather than a constant loop time: a fixed
      // duration makes a long notice sprint and a short one crawl. ~60px/s is
      // brisk enough not to feel stuck and slow enough to read in passing.
      if (needsScroll) setDurationSec(Math.max(8, (contentWidth + available) / 60));
    };

    check();
    const observer = new ResizeObserver(check);
    observer.observe(viewport);
    observer.observe(measure);
    return () => observer.disconnect();
  }, [text]);

  if (!enabled || dismissed) return null;

  // Two copies, translated by exactly half the track: as the first leaves, the
  // second is already in place, so the seam never shows.
  const marquee = (
    <div
      className="marquee-track flex w-max shrink-0"
      style={{ animationDuration: `${durationSec}s` }}
    >
      <span className="px-6 whitespace-nowrap">{text}</span>
      <span className="px-6 whitespace-nowrap" aria-hidden="true">{text}</span>
    </div>
  );

  return (
    <div className="bg-primary text-white text-sm sm:text-base relative">
      {/* MARGIN, not padding. overflow-hidden clips at the padding box, so a
          pr-10 still let the scrolling text render underneath the dismiss
          button. A right margin ends the clipping box before the button. */}
      <div ref={viewportRef} className="overflow-hidden py-2 px-2 mr-9">
        {/* Always rendered, off-screen, at natural width — this is what the
            measurement compares against. Measuring the visible node instead
            would give the clamped width and never report an overflow. */}
        <span
          ref={measureRef}
          aria-hidden="true"
          className="absolute -left-[9999px] top-0 whitespace-nowrap font-medium text-sm sm:text-base"
        >
          {text}
        </span>

        {overflowing ? (
          <p className="font-medium flex">{marquee}</p>
        ) : (
          <p className="font-medium text-center">{text}</p>
        )}
      </div>

      <button
        onClick={() => setDismissed(true)}
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-white/10 rounded transition-colors cursor-pointer"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
