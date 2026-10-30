'use client';

import { useSyncExternalStore } from 'react';

const noSubscribe = () => () => {};

/**
 * False on the server and during hydration, true after. For anything that may
 * only render in the browser (a portal, a localStorage-driven bit), without a
 * `mounted` flag flipped in a mount effect.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(noSubscribe, () => true, () => false);
}
