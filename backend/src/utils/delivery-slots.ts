/**
 * Delivery slot arithmetic.
 *
 * Pure functions with no database access, so the awkward part — turning
 * "Monday 10:00–13:00, hourly" into real instants, minus holidays, minus
 * what is already booked — can be tested directly.
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

export interface WindowSpec {
  id: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  slotMinutes: number;
  capacity: number;
}

export interface BlackoutSpec {
  /** Local Malaysia date; only the calendar day is significant. */
  date: Date;
  startMinute?: number | null;
  endMinute?: number | null;
  reason: string;
}

export interface Slot {
  /** Slot start, as a real instant (UTC under the hood). */
  startsAt: Date;
  durationMinutes: number;
  capacity: number;
  booked: number;
  windowId: string;
  /** "2026-08-03" in Malaysia local time. */
  localDate: string;
  /** "10:00" in Malaysia local time. */
  localTime: string;
}

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

function blackoutCovers(blackout: BlackoutSpec, slotStartMinute: number, slotEndMinute: number): boolean {
  // A whole-day blackout closes everything on that date.
  if (blackout.startMinute == null || blackout.endMinute == null) return true;
  // Otherwise close only slots that actually overlap the blocked span. A slot
  // ending exactly when the blackout begins is still fine.
  return slotStartMinute < blackout.endMinute && slotEndMinute > blackout.startMinute;
}

/**
 * Every slot between `from` and `to`, with how many bookings each already has.
 *
 * `bookedAt` is the list of instants already booked (one entry per booking), so
 * capacity is counted rather than assumed. Slots in the past are omitted:
 * offering a delivery window that has already elapsed is never useful, and it
 * is the kind of thing an operator only notices after promising it to someone.
 */
export function generateSlots(opts: {
  windows: WindowSpec[];
  blackouts: BlackoutSpec[];
  bookedAt: Date[];
  from: Date;
  to: Date;
  now?: Date;
}): Slot[] {
  const { windows, blackouts, bookedAt, from, to } = opts;
  const now = opts.now ?? new Date();
  if (!windows.length) return [];

  // Count bookings per exact start instant.
  const bookedCount = new Map<number, number>();
  for (const at of bookedAt) {
    const key = at.getTime();
    bookedCount.set(key, (bookedCount.get(key) ?? 0) + 1);
  }

  // Blackouts indexed by local date.
  const blackoutsByDate = new Map<string, BlackoutSpec[]>();
  for (const b of blackouts) {
    const key = mytDateKey(b.date);
    const list = blackoutsByDate.get(key) ?? [];
    list.push(b);
    blackoutsByDate.set(key, list);
  }

  const slots: Slot[] = [];
  const startParts = toMytParts(from);

  // Walk local calendar days, not 24-hour jumps from an instant — the latter
  // drifts if the range crosses anything unexpected.
  for (let dayOffset = 0; dayOffset < 400; dayOffset++) {
    const dayStart = fromMytWallClock(startParts.year, startParts.month, startParts.day + dayOffset, 0);
    if (dayStart.getTime() > to.getTime()) break;

    const parts = toMytParts(dayStart);
    const dateKey = mytDateKey(dayStart);
    const dayBlackouts = blackoutsByDate.get(dateKey) ?? [];

    for (const w of windows) {
      if (w.dayOfWeek !== parts.dayOfWeek) continue;
      if (w.slotMinutes <= 0) continue;

      // Only whole slots are offered — a 10:00-13:20 window at 60 minutes
      // gives three slots, not three and a stub.
      for (let m = w.startMinute; m + w.slotMinutes <= w.endMinute; m += w.slotMinutes) {
        const startsAt = fromMytWallClock(parts.year, parts.month, parts.day, m);
        if (startsAt.getTime() < from.getTime() || startsAt.getTime() > to.getTime()) continue;
        if (startsAt.getTime() < now.getTime()) continue;
        if (dayBlackouts.some((b) => blackoutCovers(b, m, m + w.slotMinutes))) continue;

        slots.push({
          startsAt,
          durationMinutes: w.slotMinutes,
          capacity: w.capacity,
          booked: bookedCount.get(startsAt.getTime()) ?? 0,
          windowId: w.id,
          localDate: dateKey,
          localTime: formatMinute(m),
        });
      }
    }
  }

  slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return slots;
}

export function isSlotOpen(slot: Slot): boolean {
  return slot.booked < slot.capacity;
}

/** Human label for a slot, e.g. "Mon 3 Aug, 10:00–11:00". */
export function describeSlot(startsAt: Date, durationMinutes: number): string {
  const p = toMytParts(startsAt);
  const end = formatMinute(p.minuteOfDay + durationMinutes);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${dayName(p.dayOfWeek).slice(0, 3)} ${p.day} ${months[p.month - 1]}, ${formatMinute(p.minuteOfDay)}–${end}`;
}
