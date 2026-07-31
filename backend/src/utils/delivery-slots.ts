/**
 * Malaysia-time helpers for the delivery diary.
 *
 * Pure functions with no database access, so the part most likely to be quietly
 * wrong — converting between a wall-clock time someone typed and a real instant
 * — can be tested directly.
 *
 * This file previously also generated bookable slots from recurring
 * availability windows. That layer was removed: see the comment on the delivery
 * models in schema.prisma for why.
 *
 * TIMEZONE
 * Windows are Malaysia local wall-clock. Every conversion here goes through a
 * fixed +08:00 rather than the host's own clock, because the server this runs
 * on is set to Asia/Shanghai — the same offset today, but only by coincidence.
 * Relying on the process timezone would mean the whole delivery diary silently
 * shifting the day that box is rebuilt in another region. Malaysia has never
 * observed daylight saving, so a fixed offset is not an approximation.
 */

export const MYT_OFFSET_MINUTES = 8 * 60;

/** The Malaysia-local calendar parts of an instant. */
export function toMytParts(instant: Date) {
  const shifted = new Date(instant.getTime() + MYT_OFFSET_MINUTES * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    dayOfWeek: shifted.getUTCDay(),
    minuteOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** "YYYY-MM-DD" for an instant, in Malaysia local time. */
export function mytDateKey(instant: Date): string {
  const p = toMytParts(instant);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Malaysia-local wall clock (y/m/d + minutes) back to a real instant. */
export function fromMytWallClock(year: number, month: number, day: number, minuteOfDay: number): Date {
  const asIfUtc = Date.UTC(year, month - 1, day, 0, minuteOfDay);
  return new Date(asIfUtc - MYT_OFFSET_MINUTES * 60_000);
}

export function formatMinute(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Parse "14:30" / "1430" / "2pm" into minutes from midnight. */
export function parseTimeOfDay(value: string): number {
  const raw = String(value).trim().toLowerCase();

  const ampm = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (ampm) {
    let h = parseInt(ampm[1], 10) % 12;
    if (ampm[3] === 'pm') h += 12;
    return h * 60 + (ampm[2] ? parseInt(ampm[2], 10) : 0);
  }

  const colon = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (colon) return parseInt(colon[1], 10) * 60 + parseInt(colon[2], 10);

  const compact = raw.match(/^(\d{3,4})$/);
  if (compact) {
    const n = compact[1].padStart(4, '0');
    return parseInt(n.slice(0, 2), 10) * 60 + parseInt(n.slice(2), 10);
  }

  throw new Error(`Could not read "${value}" as a time. Use 24-hour "14:30" or "2pm".`);
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function dayName(dayOfWeek: number): string {
  return DAY_NAMES[dayOfWeek] ?? `Day ${dayOfWeek}`;
}

/** Parse a day name or number into 0-6. */
export function parseDayOfWeek(value: string | number): number {
  if (typeof value === 'number' && value >= 0 && value <= 6) return value;
  const raw = String(value).trim().toLowerCase();
  const index = DAY_NAMES.findIndex((d) => d.toLowerCase().startsWith(raw.slice(0, 3)));
  if (index === -1) throw new Error(`Could not read "${value}" as a day of the week.`);
  return index;
}

/** Human label for a slot, e.g. "Mon 3 Aug, 10:00–11:00". */
export function describeSlot(startsAt: Date, durationMinutes: number): string {
  const p = toMytParts(startsAt);
  const end = formatMinute(p.minuteOfDay + durationMinutes);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${dayName(p.dayOfWeek).slice(0, 3)} ${p.day} ${months[p.month - 1]}, ${formatMinute(p.minuteOfDay)}–${end}`;
}
