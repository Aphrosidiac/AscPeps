/**
 * Pre-order rules shared by server and client components (no React here, so a
 * server component can import it). The context lives in lib/preorder.tsx.
 * The server decides for real at checkout — see backend/src/utils/preorder.ts.
 */

export const PREORDER_DEFAULT_LEAD = '10–14 days';
/**
 * The most of one size a store order can take: the API refuses more than 50
 * units in one store order (and 100 of one item), so 50 is the real ceiling.
 */
export const STORE_MAX_PER_ITEM = 50;

export interface PreorderSettings {
  enabled: boolean;
  leadTime: string;
}

export function parsePreorderSettings(values: Record<string, string | undefined>): PreorderSettings {
  return {
    enabled: values.preorder_enabled !== 'false',
    leadTime: values.preorder_lead_time?.trim() || PREORDER_DEFAULT_LEAD,
  };
}

/** May this size be bought beyond its stock? */
export function canPreorder(settings: PreorderSettings, variant: { preorder?: boolean }): boolean {
  return settings.enabled && variant.preorder !== false;
}

/** Units of a line that are on pre-order, given the stock it was added against. */
export function preorderUnits(quantity: number, stock: number | undefined, allowed: boolean | undefined): number {
  if (!allowed || stock == null) return 0;
  return Math.max(quantity - Math.max(stock, 0), 0);
}

/** "Pre-order" when nothing is in stock, else "3 of 5 on pre-order". */
export function preorderLabel(quantity: number, stock: number | undefined): string {
  const units = Math.max(quantity - Math.max(stock ?? 0, 0), 0);
  return units >= quantity ? 'Pre-order' : `${units} of ${quantity} on pre-order`;
}
