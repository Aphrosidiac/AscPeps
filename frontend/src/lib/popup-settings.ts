/**
 * The store's three popups — newsletter, sign-up bonus, affiliate — and what
 * the team can change about each from Admin → Marketing → Popups: when it
 * appears, how long a closed one stays away, and (for sign-up and affiliate)
 * its words. Everything is a plain store setting (`popup_<kind>_<field>`);
 * a blank or missing value means the default below, which is how the popups
 * behaved before these were editable.
 *
 * Text may carry {discount}, {commission} (affiliate) and {bonus} (sign-up),
 * filled from the live programme settings so the words never disagree with
 * the numbers.
 */

export const POPUP_KINDS = ['newsletter', 'signup', 'affiliate'] as const;
export type PopupKind = (typeof POPUP_KINDS)[number];

export interface PopupTriggers {
  /** Desktop: seconds on the page before leaving the window can open it. */
  desktopDelayS: number;
  /** Phone: seconds before it opens on its own. */
  mobileDelayS: number;
  /** Phone: how far down the page (percent) opens it sooner. */
  mobileScrollPct: number;
  /** After it is closed (or its button pressed): days before it may show again. */
  hideDays: number;
}

export const TRIGGER_DEFAULTS: PopupTriggers = { desktopDelayS: 5, mobileDelayS: 15, mobileScrollPct: 50, hideDays: 30 };

export const TRIGGER_BOUNDS: Record<keyof PopupTriggers, { min: number; max: number; key: string }> = {
  desktopDelayS: { min: 0, max: 120, key: 'desktop_delay' },
  mobileDelayS: { min: 1, max: 300, key: 'mobile_delay' },
  mobileScrollPct: { min: 10, max: 100, key: 'mobile_scroll' },
  hideDays: { min: 0, max: 365, key: 'hide_days' },
};

export interface PopupText {
  heading: string;
  body: string;
  cta: string;
  note: string;
}

/** The words the sign-up and affiliate popups use when nothing is set. */
export const TEXT_DEFAULTS: Record<'signup' | 'affiliate', PopupText> = {
  signup: {
    heading: '{bonus}% off your first order',
    body: "Create a free Ascend MY account and we'll give you a one-time code for your first order. Track your orders and check out faster too.",
    cta: 'Create my account',
    note: 'Your code appears once you confirm your email.',
  },
  affiliate: {
    heading: 'Share Ascend, earn on every order',
    body: 'Become an Ascend affiliate: your own code gives your people {discount}% off, and you earn {commission} of every paid order made with it.',
    cta: 'Become an affiliate',
    note: 'Free to join. Paid to your bank account.',
  },
};

export const PLACEHOLDERS: Record<'signup' | 'affiliate', string[]> = {
  signup: ['{bonus}'],
  affiliate: ['{discount}', '{commission}'],
};

export const settingKey = (kind: PopupKind, field: string) => `popup_${kind}_${field}`;

/** Every popup setting key, for the public settings list and the admin page. */
export const POPUP_SETTING_KEYS: string[] = POPUP_KINDS.flatMap((k) => [
  ...Object.values(TRIGGER_BOUNDS).map((b) => settingKey(k, b.key)),
  ...(k === 'newsletter' ? [] : ['enabled', 'heading', 'body', 'cta', 'note', ...(k === 'affiliate' ? ['card'] : [])].map((f) => settingKey(k, f))),
]);

export interface PopupConfig {
  triggers: PopupTriggers;
  /** Sign-up and affiliate only; newsletter keeps its own heading/body settings. */
  text: PopupText | null;
  /** The team's own on/off (the programme switches still apply on top). */
  shown: boolean;
  /** Affiliate only: the earnings card above the button. */
  card: boolean;
}

function num(raw: string | undefined, d: number, b: { min: number; max: number }): number {
  if (raw == null || raw.trim() === '') return d;
  const n = Number(raw);
  return Number.isFinite(n) && n >= b.min && n <= b.max ? n : d;
}

/** Reads one popup's settings out of the public settings bag. */
export function popupConfig(settings: Record<string, string | undefined>, kind: PopupKind): PopupConfig {
  const g = (f: string) => settings[settingKey(kind, f)];
  const triggers = Object.fromEntries(
    (Object.keys(TRIGGER_BOUNDS) as (keyof PopupTriggers)[]).map((t) => [t, num(g(TRIGGER_BOUNDS[t].key), TRIGGER_DEFAULTS[t], TRIGGER_BOUNDS[t])])
  ) as unknown as PopupTriggers;
  if (kind === 'newsletter') return { triggers, text: null, shown: true, card: false };
  const d = TEXT_DEFAULTS[kind];
  const t = (f: keyof PopupText) => g(f)?.trim() || d[f];
  return {
    triggers,
    text: { heading: t('heading'), body: t('body'), cta: t('cta'), note: t('note') },
    shown: g('enabled') !== 'false',
    card: kind === 'affiliate' ? g('card') !== 'false' : false,
  };
}

/** Fills {discount}, {commission}, {bonus}. */
export function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}
