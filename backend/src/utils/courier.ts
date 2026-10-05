// Turns what an operator typed into the Tracking Number box into something a
// customer can act on. The box is free text and the live data shows both
// "650875383027" and "J&T : 650875864298", so the number is pulled out of
// whatever surrounds it rather than trusted as-is.
//
// The box is also used as a note: prod holds "COD" (13 orders), "Shipped" and
// at least one in-joke. None of that may reach a customer, so a value only
// counts as a tracking number if some part of it looks like a waybill —
// 8+ characters, at least 6 of them digits. Everything else is treated as
// no tracking number at all.
//
// Every shipped order so far went with J&T Express, whose Malaysian waybills
// are 12 digits. A waybill we cannot place still comes back with its number —
// the customer can copy it — just without a courier link.

export interface ParcelTracking {
  number: string;
  courier: string | null;
  url: string | null;
}

const COURIERS: { name: string; label: RegExp; number: RegExp; url: (n: string) => string }[] = [
  {
    name: 'J&T Express',
    label: /\bj\s*&\s*t\b|\bjnt\b/i,
    number: /^\d{12}$/,
    url: (n) => `https://www.jtexpress.my/tracking/${n}`,
  },
];

export function parseTracking(raw: string | null | undefined): ParcelTracking | null {
  const text = raw?.trim();
  if (!text) return null;

  // The waybill is the longest unbroken run of letters and digits that looks
  // like one — the courier's name never does.
  const tokens = text.match(/[A-Za-z0-9]+/g) ?? [];
  const number = tokens
    .filter((t) => t.length >= 8 && (t.match(/\d/g)?.length ?? 0) >= 6)
    .sort((a, b) => b.length - a.length)[0];
  if (!number) return null;

  const courier =
    COURIERS.find((c) => c.label.test(text)) ?? COURIERS.find((c) => c.number.test(number));
  return {
    number,
    courier: courier?.name ?? null,
    url: courier ? courier.url(number) : null,
  };
}
