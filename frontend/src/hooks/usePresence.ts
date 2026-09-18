'use client';

import { useEffect, useState } from 'react';

/**
 * Keep an element mounted long enough to play its exit animation.
 *
 * The admin's dialogs each hand-roll `closing` state plus a timeout before
 * unmounting; this is that pattern once, for anything that appears and
 * disappears — a side panel, a popover, a toast, a Stop button. An element
 * that simply unmounts on `open = false` can never animate out, which reads
 * as a glitch next to one that animated in.
 *
 *   const { mounted, closing } = usePresence(open, 160);
 *   {mounted && <div className={cn('pop-in', closing && 'is-closing')} />}
 *
 * The open→closed edge is caught during render (React's "adjust state from
 * the previous render" pattern), not in an effect, so nothing is set
 * synchronously inside one. Reduced motion: the CSS turns the animations off
 * and the ≤200ms linger is not felt.
 */
export function usePresence(open: boolean, exitMs = 160): { mounted: boolean; closing: boolean } {
  const [prevOpen, setPrevOpen] = useState(open);
  const [lingering, setLingering] = useState(false);

  if (open !== prevOpen) {
    setPrevOpen(open);
    setLingering(!open);
  }

  useEffect(() => {
    if (!lingering) return;
    const id = window.setTimeout(() => setLingering(false), exitMs);
    return () => window.clearTimeout(id);
  }, [lingering, exitMs]);

  return { mounted: open || lingering, closing: !open && lingering };
}
