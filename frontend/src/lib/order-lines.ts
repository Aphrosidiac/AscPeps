import type { OrderItem } from '@/types';
import { getVariantDisplayName } from '@/lib/utils';

// Mirrors backend/src/utils/order-lines.ts — keep the two in step.

type GroupableItem = Pick<OrderItem, 'id' | 'unitPrice' | 'quantity'> & {
  parentItemId?: string | null;
  variant: { size: string | null; product: { name: string; addOnOnly?: boolean } };
};

export interface GroupedLine<T> {
  item: T;
  includes: T[];
}

/**
 * Order items as the customer thinks of them: each chosen product with what
 * came included under it (parentItemId). Orders from before bundles carried
 * their supplies as separate RM0 lines; those come back as `looseIncludes`.
 */
export function groupOrderItems<T extends GroupableItem>(items: T[]): { lines: GroupedLine<T>[]; looseIncludes: T[] } {
  const children = new Map<string, T[]>();
  for (const item of items) {
    if (item.parentItemId) children.set(item.parentItemId, [...(children.get(item.parentItemId) ?? []), item]);
  }
  const lines: GroupedLine<T>[] = [];
  const looseIncludes: T[] = [];
  for (const item of items) {
    if (item.parentItemId) continue;
    if (item.unitPrice === 0 && item.variant.product.addOnOnly) {
      looseIncludes.push(item);
      continue;
    }
    lines.push({ item, includes: children.get(item.id) ?? [] });
  }
  return { lines, looseIncludes };
}

export function isIncludedItem(item: GroupableItem): boolean {
  return !!item.parentItemId || (item.unitPrice === 0 && !!item.variant.product.addOnOnly);
}

/** "1× Bac Water 3mL · 6× Alcohol Swab" */
export function includesText(includes: GroupableItem[]): string {
  return includes.map((i) => `${i.quantity}× ${getVariantDisplayName(i.variant.product, i.variant)}`).join(' · ');
}

/** The product plus any priced includes. */
export function groupedLineTotal(line: GroupedLine<GroupableItem>): number {
  return line.item.unitPrice * line.item.quantity + line.includes.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
}
