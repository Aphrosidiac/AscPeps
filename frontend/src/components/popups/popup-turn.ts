'use client';

import { useSyncExternalStore } from 'react';

/**
 * One store popup per visit. The newsletter, the sign-up bonus and the
 * affiliate invitation take turns: each new visit (browser session) moves to
 * the next one that is switched on, and the choice holds for the whole visit.
 * A Group Buy popup, when a batch has one, outranks all three (SiteChrome).
 */
export type PopupKind = 'newsletter' | 'signup' | 'affiliate';

const TURN_KEY = 'ascend-popup-turn';
const VISIT_KEY = 'ascend-popup-this-visit';

function choose(kinds: PopupKind[]): PopupKind | null {
  if (!kinds.length) return null;
  try {
    const held = sessionStorage.getItem(VISIT_KEY) as PopupKind | null;
    if (held && kinds.includes(held)) return held;
    const turn = Number(localStorage.getItem(TURN_KEY)) || 0;
    const pick = kinds[turn % kinds.length];
    localStorage.setItem(TURN_KEY, String(turn + 1));
    sessionStorage.setItem(VISIT_KEY, pick);
    return pick;
  } catch {
    // Storage blocked: no way to keep it to one per visit, so none.
    return null;
  }
}

const noop = () => () => {};

/** Which popup this visit may show, or null. Null on the server and first paint. */
export function usePopupTurn(kinds: PopupKind[]): PopupKind | null {
  const key = kinds.join(',');
  return useSyncExternalStore(
    noop,
    () => choose(key ? (key.split(',') as PopupKind[]) : []),
    () => null
  );
}
