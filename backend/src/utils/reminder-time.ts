/**
 * Turning "tomorrow 3pm" / "in 2 hours" into a real instant.
 *
 * Pure functions, no database, so the part most likely to be quietly wrong can
 * be tested directly — see scripts/test-reminder-time.ts.
 *
 * TIMEZONE
 * Every wall-clock time an operator types is Malaysia local, and every
 * conversion here goes through the fixed +08:00 in utils/delivery-slots.ts
 * rather than the host clock. The production box runs Asia/Shanghai — the same
 * offset today, but only by coincidence — so a reminder built from the process
 * timezone would silently fire at the wrong hour the day that box is rebuilt
 * in another region. Malaysia has never observed daylight saving, so a fixed
 * offset is exact rather than an approximation.
 *
 * A reminder is worse than useless if it arrives at the wrong time, so
 * anything unparseable is REFUSED rather than guessed at. "Sometime next week"
 * has no defensible instant behind it, and picking one would mean an operator
 * believing they are covered when they are not.
 */
import { fromMytWallClock, parseTimeOfDay, toMytParts } from './delivery-slots.js';

/** How far ahead a reminder may be set. Guards a mistyped year. */
const MAX_AHEAD_MS = 2 * 365 * 24 * 60 * 60_000;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Malaysia-local midnight of the day `offsetDays` from the instant `from`. */
function mytDayStart(from: Date, offsetDays: number) {
  const p = toMytParts(from);
  // Build from calendar parts rather than adding 24h: that survives the day
  // rolling over correctly regardless of the host clock.
  const base = fromMytWallClock(p.year, p.month, p.day, 0);
  return new Date(base.getTime() + offsetDays * 24 * 60 * 60_000);
}

/**
 * Parse a reminder time. Returns the instant it should fire.
 *
 * Accepts the shapes people actually type:
 *   "in 30 minutes" / "in 2 hours" / "in 3 days"
 *   "tomorrow 3pm" / "today 9pm" / "tonight"
 *   "2026-08-05 14:00" / "5 Aug 3pm"
 *   a bare time ("3pm") — today if still ahead, otherwise tomorrow
 *
 * @param now injectable so the tests are not racing the wall clock.
 */
export function parseReminderTime(value: string, now: Date = new Date()): Date {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) throw new Error('No time given for the reminder.');

  const at = (d: Date) => {
    if (d.getTime() <= now.getTime()) {
      throw new Error(`"${value}" is in the past. Give a time in the future.`);
    }
    if (d.getTime() - now.getTime() > MAX_AHEAD_MS) {
      throw new Error(`"${value}" is more than two years away — check the date.`);
    }
    return d;
  };

  // ---- relative: "in 30 minutes", "in 2h", "in 3 days"
  const rel = raw.match(/^in\s+(\d+(?:\.\d+)?)\s*(min(?:ute)?s?|m|hours?|hrs?|h|days?|d|weeks?|w)\b/);
  if (rel) {
    const n = parseFloat(rel[1]);
    const unit = rel[2];
    const ms = /^(min|m$)/.test(unit)
      ? n * 60_000
      : /^(h|hour|hr)/.test(unit)
        ? n * 60 * 60_000
        : /^(w|week)/.test(unit)
          ? n * 7 * 24 * 60 * 60_000
          : n * 24 * 60 * 60_000;
    return at(new Date(now.getTime() + ms));
  }

  // ---- a day word, optionally followed by a time
  const dayWord = raw.match(/^(today|tonight|tomorrow|tmr|tmrw|besok|esok)\b(.*)$/);
  if (dayWord) {
    const word = dayWord[1];
    const rest = dayWord[2].replace(/^\s*(at|@|,)\s*/, '').trim();
    const offset = word === 'today' || word === 'tonight' ? 0 : 1;
    // "tonight" with no time means the evening, not midnight.
    const minute = rest ? parseTimeOfDay(rest) : word === 'tonight' ? 20 * 60 : 9 * 60;
    return at(new Date(mytDayStart(now, offset).getTime() + minute * 60_000));
  }

  // ---- an explicit date, optionally followed by a time
  //      "2026-08-05", "2026-08-05 14:00", "5 aug 3pm", "aug 5 3pm"
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})\b(.*)$/);
  if (iso) {
    const rest = iso[4].replace(/^\s*(at|@|,)\s*/, '').trim();
    const minute = rest ? parseTimeOfDay(rest) : 9 * 60;
    return at(fromMytWallClock(+iso[1], +iso[2], +iso[3], minute));
  }

  const dmy = raw.match(/^(\d{1,2})\s+([a-z]{3,})\b(.*)$/);
  const mdy = raw.match(/^([a-z]{3,})\s+(\d{1,2})\b(.*)$/);
  const named = dmy
    ? { day: +dmy[1], monthWord: dmy[2], rest: dmy[3] }
    : mdy
      ? { day: +mdy[2], monthWord: mdy[1], rest: mdy[3] }
      : null;
  if (named) {
    const monthIndex = MONTHS.findIndex((m) => named.monthWord.startsWith(m.toLowerCase()));
    if (monthIndex !== -1) {
      const rest = named.rest.replace(/^\s*(at|@|,)\s*/, '').trim();
      const minute = rest ? parseTimeOfDay(rest) : 9 * 60;
      const p = toMytParts(now);
      let candidate = fromMytWallClock(p.year, monthIndex + 1, named.day, minute);
      // A month already past this year means they mean next year.
      if (candidate.getTime() <= now.getTime()) {
        candidate = fromMytWallClock(p.year + 1, monthIndex + 1, named.day, minute);
      }
      return at(candidate);
    }
  }

  // ---- a bare time: today if it is still ahead, otherwise tomorrow.
  try {
    const minute = parseTimeOfDay(raw);
    const todayAt = new Date(mytDayStart(now, 0).getTime() + minute * 60_000);
    return at(todayAt.getTime() > now.getTime() ? todayAt : new Date(todayAt.getTime() + 24 * 60 * 60_000));
  } catch {
    throw new Error(
      `Could not read "${value}" as a time. Try "in 2 hours", "tomorrow 3pm", or "2026-08-05 14:00".`
    );
  }
}

/**
 * Human label for when a reminder fires, e.g. "Wed 5 Aug, 6:26 AM".
 *
 * Deliberately 12-hour with an explicit AM/PM rather than the 24-hour form the
 * delivery diary uses. This string is read back to the operator by the model,
 * and a 24-hour "06:26" was observed being confidently repeated as "6:26 PM" —
 * a reminder confirmed for the wrong half of the day is worse than no reminder,
 * and spelling it out removes the chance rather than relying on the model to
 * convert correctly every time.
 */
export function describeReminderTime(at: Date): string {
  const p = toMytParts(at);
  const hour24 = Math.floor(p.minuteOfDay / 60);
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const mm = String(p.minuteOfDay % 60).padStart(2, '0');
  const suffix = hour24 < 12 ? 'AM' : 'PM';
  return `${DAY_NAMES[p.dayOfWeek].slice(0, 3)} ${p.day} ${MONTHS[p.month - 1]}, ${hour12}:${mm} ${suffix}`;
}
