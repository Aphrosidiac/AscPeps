import {
  Sparkles,
  Flame,
  Dumbbell,
  ShieldPlus,
  Brain,
  Zap,
  Bone,
  Syringe,
  Activity,
  Package,
  type LucideIcon,
} from 'lucide-react';

// Categories have no icon field of their own (Category model is just
// id/name/slug/description/productCount) — this is presentational-only,
// keyed by slug so it doesn't break if a category is renamed.
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  'skin-anti-aging': Sparkles,
  'fat-loss-metabolism': Flame,
  'hormone-muscle-growth': Dumbbell,
  'immune-healing': ShieldPlus,
  'brain-nootropic': Brain,
  'mitochondrial-longevity': Zap,
  'joint-tissue-specialty': Bone,
  'health-boosters': Syringe,
  testosterone: Activity,
  supplies: Package,
};

export function getCategoryIcon(slug: string): LucideIcon {
  return CATEGORY_ICONS[slug] ?? Package;
}
