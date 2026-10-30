/**
 * Pre-order: a sold-out size can still be bought, and ships when the restock
 * lands. The units bought beyond stock are recorded on the line
 * (OrderItem.preorderQty) and the order is flagged isPreorder, so every place
 * that shows the order can say so. Store-wide switch and lead time are
 * settings; a size can opt out with ProductVariant.preorder. See docs/preorder.md.
 */

export const PREORDER_DEFAULT_LEAD = '10–14 days';

type SettingsDb = { setting: { findMany: (args: { where: { key: { in: string[] } } }) => Promise<{ key: string; value: string }[]> } };

export interface PreorderSettings {
  /** On unless the `preorder_enabled` setting is the literal 'false'. */
  enabled: boolean;
  /** "10–14 days" — how long a pre-order takes to ship, as customers read it. */
  leadTime: string;
}

export function parsePreorderSettings(values: Record<string, string | undefined>): PreorderSettings {
  return {
    enabled: values.preorder_enabled !== 'false',
    leadTime: values.preorder_lead_time?.trim() || PREORDER_DEFAULT_LEAD,
  };
}

export async function getPreorderSettings(db: SettingsDb): Promise<PreorderSettings> {
  const rows = await db.setting.findMany({ where: { key: { in: ['preorder_enabled', 'preorder_lead_time'] } } });
  return parsePreorderSettings(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}

/** May units of this size be bought beyond its stock right now? */
export function canPreorder(settings: PreorderSettings, variant: { preorder: boolean }): boolean {
  return settings.enabled && variant.preorder;
}
