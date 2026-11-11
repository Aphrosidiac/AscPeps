import { renderLayout, paragraph, heading, button, linkList, codeBox, spacer, formatDate, SITE_URL } from './layout.js';

const SUBJECT_WITH_CODE = 'Welcome to Ascend MY — your reference links and first-order code';
const SUBJECT_PLAIN = 'Welcome to Ascend MY — your reference links';

export interface WelcomeDiscount {
  code: string;
  percent: number;
  expiresAt: Date;
  minOrderAmount: number | null;
}

// The popup promised reference material, so the mail leads with it. Batch COAs
// were removed from this list at Fakhrul's direction; don't add them back.
const RESOURCES = [
  {
    label: 'Reconstitution calculator',
    blurb: 'Work out BAC water volume and units per dose for any vial size.',
    href: `${SITE_URL}/calculator`,
  },
  {
    label: 'Peptide guide',
    blurb: 'Storage, handling and half-life reference for every compound we carry.',
    href: `${SITE_URL}/guide`,
  },
  {
    label: 'Research',
    blurb: 'Research write-ups and product updates, citing the papers behind them.',
    href: `${SITE_URL}/research`,
  },
];

/** Welcome to the list. `discount` is null when welcome discounts are off. */
export function renderWelcome(
  discount: WelcomeDiscount | null,
  unsubscribeUrl: string,
  settings: Record<string, string>
): { subject: string; html: string } {
  const code = discount
    ? `${spacer(32)}${codeBox(
        `${discount.percent}% off your first order`,
        discount.code,
        `One use, tied to this address. Valid until ${formatDate(discount.expiresAt)}.${
          discount.minOrderAmount && discount.minOrderAmount > 0
            ? ` On orders over RM ${(discount.minOrderAmount / 100).toFixed(2)}.`
            : ''
        }`
      )}`
    : spacer(32);

  return {
    subject: discount ? SUBJECT_WITH_CODE : SUBJECT_PLAIN,
    html: renderLayout({
      headline: 'Welcome to Ascend MY',
      body: `${paragraph(
        "You'll hear from us when a compound is back in stock, when new batch COAs are published, and when we put out something worth reading. Not often, and never without something in it.",
        { mb: 0 }
      )}${heading('Start here')}${linkList(RESOURCES)}${code}${button('Browse the catalogue', `${SITE_URL}/products`, { mt: 0 })}`,
      preheader: discount
        ? `Your reconstitution reference, the peptide guide, and ${discount.percent}% off your first order.`
        : 'Your reconstitution reference and the peptide guide.',
      settings,
      unsubscribeUrl,
    }),
  };
}
