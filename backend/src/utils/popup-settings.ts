/**
 * The store's popups — newsletter, sign-up bonus, affiliate — as settings the
 * team edits in Admin → Marketing → Popups. The frontend's
 * lib/popup-settings.ts reads them (and holds the defaults); this side only
 * publishes the keys and refuses out-of-range timings.
 */
const KINDS = ['newsletter', 'signup', 'affiliate'] as const;

const TRIGGERS: Record<string, { min: number; max: number }> = {
  // Desktop: seconds on the page before an exit can open it.
  desktop_delay: { min: 0, max: 120 },
  // Phone: seconds before it opens by itself, and how far down (percent).
  mobile_delay: { min: 1, max: 300 },
  mobile_scroll: { min: 10, max: 100 },
  // Days a closed popup stays away.
  hide_days: { min: 0, max: 365 },
};

export const POPUP_TRIGGER_BOUNDS: Record<string, { min: number; max: number }> = Object.fromEntries(
  KINDS.flatMap((k) => Object.entries(TRIGGERS).map(([f, b]) => [`popup_${k}_${f}`, b]))
);

export const POPUP_SETTING_KEYS: string[] = KINDS.flatMap((k) => [
  ...Object.keys(TRIGGERS).map((f) => `popup_${k}_${f}`),
  ...(k === 'newsletter' ? [] : ['enabled', 'heading', 'body', 'cta', 'note', ...(k === 'affiliate' ? ['card'] : [])].map((f) => `popup_${k}_${f}`)),
]);
