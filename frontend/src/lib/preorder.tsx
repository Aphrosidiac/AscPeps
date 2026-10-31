'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { PREORDER_DEFAULT_LEAD, type PreorderSettings } from './preorder-rules';

/**
 * Pre-order on the storefront: a sold-out size can still be bought, and the
 * units beyond stock ship on the restock. Store-wide switch and lead time come
 * from settings (preorder_enabled, preorder_lead_time); a size can opt out
 * (ProductVariant.preorder). Rules in lib/preorder-rules.ts.
 */

export * from './preorder-rules';

const PreorderContext = createContext<PreorderSettings>({ enabled: true, leadTime: PREORDER_DEFAULT_LEAD });

export function PreorderProvider({ value, children }: { value: PreorderSettings; children: ReactNode }) {
  return <PreorderContext.Provider value={value}>{children}</PreorderContext.Provider>;
}

export function usePreorder(): PreorderSettings {
  return useContext(PreorderContext);
}
