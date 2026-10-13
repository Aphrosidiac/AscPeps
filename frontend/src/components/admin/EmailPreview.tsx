'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/** The width email clients lay these templates out at. */
const EMAIL_WIDTH = 640;

/**
 * A rendered email in a sandboxed frame — no scripts, same-origin only so its
 * height can be measured. Two modes:
 *
 *   full   the real thing at a chosen width, as tall as the email is.
 *   thumb  the desktop render scaled down to fit its box and clipped, for a
 *          card in the campaign list. It is a picture, not a document: no
 *          pointer events and hidden from assistive tech, since the card
 *          around it already carries the subject and the link.
 */
export function EmailPreview({
  html,
  mode = 'full',
  width = 'desktop',
  className,
}: {
  html: string | null;
  mode?: 'full' | 'thumb';
  width?: 'desktop' | 'mobile';
  className?: string;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(900);
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    if (mode !== 'thumb' || !boxRef.current) return;
    const box = boxRef.current;
    const ro = new ResizeObserver(() => setScale(box.clientWidth / EMAIL_WIDTH));
    ro.observe(box);
    return () => ro.disconnect();
  }, [mode]);

  const measure = () => {
    const doc = frameRef.current?.contentDocument;
    if (doc) setHeight(doc.documentElement.scrollHeight);
  };

  // Images arrive after the load event and change the height; re-measure
  // once they settle rather than leaving the frame cut short.
  useEffect(() => {
    if (!html) return;
    const t = setTimeout(measure, 700);
    return () => clearTimeout(t);
  }, [html, width]);

  if (!html) {
    return (
      <div ref={boxRef} className={cn('flex items-center justify-center text-sm text-text-muted bg-[#f4f4f4]', className)}>
        Rendering…
      </div>
    );
  }

  if (mode === 'thumb') {
    return (
      <div ref={boxRef} aria-hidden className={cn('relative overflow-hidden bg-[#f4f4f4]', className)}>
        <iframe
          ref={frameRef}
          title=""
          tabIndex={-1}
          srcDoc={html}
          sandbox="allow-same-origin"
          onLoad={measure}
          className="absolute top-0 left-0 border-0 pointer-events-none origin-top-left"
          style={{ width: EMAIL_WIDTH, height, transform: `scale(${scale})` }}
        />
      </div>
    );
  }

  return (
    <div className={cn('flex justify-center bg-[#f4f4f4]', className)}>
      <iframe
        ref={frameRef}
        title="Email preview"
        srcDoc={html}
        sandbox="allow-same-origin allow-popups"
        onLoad={measure}
        style={{ height }}
        className={cn('border-0 bg-transparent transition-[width] duration-200', width === 'mobile' ? 'w-[375px]' : 'w-full max-w-[680px]')}
      />
    </div>
  );
}

/**
 * How the campaign sits in an inbox list: sender, subject, preview line. The
 * two fields people get wrong are exactly the two that show here and nowhere
 * in the email body, so they get a picture of their own.
 */
export function InboxRow({ subject, preheader }: { subject: string; preheader: string }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 bg-surface">
      <span className="mt-0.5 w-8 h-8 shrink-0 rounded-full bg-[#0A0A0A] text-white text-[11px] font-bold flex items-center justify-center">
        A
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-text-primary truncate">Ascend MY</p>
          <p className="text-xs text-text-muted shrink-0">now</p>
        </div>
        <p className="text-sm font-semibold text-text-primary truncate">{subject || 'No subject'}</p>
        <p className="text-sm text-text-muted truncate">{preheader}</p>
      </div>
    </div>
  );
}
