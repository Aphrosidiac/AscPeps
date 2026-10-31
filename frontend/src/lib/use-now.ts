'use client';

import { useSyncExternalStore } from 'react';

// One shared one-second clock for every countdown on the page. Read through
// useSyncExternalStore: null on the server and during hydration (so the
// server HTML never disagrees with the browser), then the current time —
// no mount effect setting state.
let now = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(onChange);
    if (!listeners.size) { clearInterval(timer); timer = undefined; }
  };
}

export function useNow(): number | null {
  const t = useSyncExternalStore(subscribe, () => now, () => 0);
  return t === 0 ? null : t;
}
