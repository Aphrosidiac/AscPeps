'use client';

import { useEffect, useRef } from 'react';

/**
 * The four things every modal in the admin has to do, in one place.
 *
 * Each dialog used to hand-roll its own Escape listener and body-scroll lock,
 * with the result that they drifted — the document drawer had no scroll lock at
 * all until it was noticed by eye. None of them trapped focus, so Tab walked
 * straight out of the dialog and into the page behind it: a keyboard user could
 * be typing into a form they could no longer see, and a screen reader would
 * happily read out a list that is visually covered by a backdrop.
 *
 * Returns a ref to put on the dialog's panel element.
 *
 *   const panelRef = useModalA11y({ onClose: requestClose });
 *   <div ref={panelRef} …>
 *
 * `onClose` should be whatever the dialog's own close path is — including any
 * unsaved-changes guard — so Escape can never bypass a confirmation the close
 * button would have shown.
 */
export function useModalA11y({
  onClose,
  enabled = true,
}: {
  onClose: () => void;
  enabled?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Held in a ref so the effect does not re-run — and re-steal focus — every
  // time the parent re-renders with a new closure. Written in an effect rather
  // than during render, which React forbids.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!enabled) return;

    const panel = panelRef.current;
    // Whatever had focus before, so it can be handed back on close — otherwise
    // dismissing a dialog dumps focus at the top of the document and a keyboard
    // user has to tab all the way back to where they were.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const FOCUSABLE =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const focusable = () =>
      Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );

    // Focus the panel itself rather than its first control: putting the caret
    // straight into a text field means a screen reader announces the field and
    // skips the dialog's own title.
    if (panel) {
      panel.setAttribute('tabindex', '-1');
      panel.focus({ preventScroll: true });
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;

      const items = focusable();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;

      // Wrap at both ends, and pull focus back in if it has escaped the panel
      // entirely (which happens when the element that had it is removed).
      if (e.shiftKey && (active === first || active === panel || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);

    // The page behind must not scroll while a modal is open — closing it and
    // finding yourself somewhere else in the list is disorienting.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = previousOverflow;
      // Only if focus is still somewhere inside the dialog being torn down —
      // if something else has legitimately taken it since, leave it alone.
      if (!panel || panel.contains(document.activeElement)) {
        previouslyFocused?.focus?.();
      }
    };
  }, [enabled]);

  return panelRef;
}
