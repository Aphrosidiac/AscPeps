/**
 * Unit tests for the delivery slot engine.
 *
 * No database, no network. The timezone arithmetic is the part most likely to
 * be quietly wrong — and wrong here means promising a customer a delivery
 * window that does not exist — so it is tested directly rather than inferred
 * from how the UI looks.
 *
 *   npx tsx scripts/test-delivery-slots.ts
 */
import {
  describeSlot,
  formatMinute,
  fromMytWallClock,
  generateSlots,
  mytDateKey,
  parseDayOfWeek,
  parseTimeOfDay,
  toMytParts,
} from '../src/utils/delivery-slots.js';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
    pass++;
  } catch (e: any) {
    console.log(`✗ ${name} — ${e?.message}`);
    fail++;
    failures.push(name);
  }
}

const eq = (actual: unknown, expected: unknown, msg = '') => {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg} got ${a}, expected ${b}`);
};

// ---------------------------------------------------------------- timezone

check('Malaysia wall clock maps to the right instant', () => {
  // 2026-08-03 10:00 MYT is 02:00 UTC the same day.
  const instant = fromMytWallClock(2026, 8, 3, 10 * 60);
  eq(instant.toISOString(), '2026-08-03T02:00:00.000Z');
});

check('an instant maps back to the right Malaysia wall clock', () => {
  const p = toMytParts(new Date('2026-08-03T02:00:00.000Z'));
  eq([p.year, p.month, p.day, p.minuteOfDay], [2026, 8, 3, 600]);
});

check('late-evening MYT stays on the correct local date', () => {
  // 23:30 MYT on the 3rd is 15:30 UTC on the 3rd — the local date must not
  // roll forward or back.
  const instant = fromMytWallClock(2026, 8, 3, 23 * 60 + 30);
  eq(instant.toISOString(), '2026-08-03T15:30:00.000Z');
  eq(mytDateKey(instant), '2026-08-03');
});

check('early-morning MYT belongs to the local day, not the UTC one', () => {
  // 07:00 MYT on the 3rd is 23:00 UTC on the 2nd. Naive UTC handling would
  // file this under the 2nd and offer it on the wrong day.
  const instant = fromMytWallClock(2026, 8, 3, 7 * 60);
  eq(instant.toISOString(), '2026-08-02T23:00:00.000Z');
  eq(mytDateKey(instant), '2026-08-03');
});

check('the engine does not depend on the host timezone', () => {
  // Whatever TZ the process is in, the same wall clock must produce the same
  // instant. The production box runs Asia/Shanghai, not Kuala Lumpur.
  const before = process.env.TZ;
  const results: string[] = [];
  for (const tz of ['UTC', 'America/New_York', 'Asia/Shanghai', 'Asia/Kuala_Lumpur']) {
    process.env.TZ = tz;
    results.push(fromMytWallClock(2026, 8, 3, 10 * 60).toISOString());
  }
  process.env.TZ = before;
  if (new Set(results).size !== 1) throw new Error(`host timezone changed the answer: ${results.join(' | ')}`);
});

// ---------------------------------------------------------------- parsing

check('time parsing accepts the shapes people type', () => {
  eq(parseTimeOfDay('14:30'), 870);
  eq(parseTimeOfDay('2pm'), 840);
  eq(parseTimeOfDay('2:15pm'), 855);
  eq(parseTimeOfDay('0930'), 570);
  eq(parseTimeOfDay('9:05'), 545);
  eq(parseTimeOfDay('12am'), 0);
  eq(parseTimeOfDay('12pm'), 720);
});

check('nonsense times are rejected rather than guessed', () => {
  let threw = false;
  try {
    parseTimeOfDay('tea time');
  } catch {
    threw = true;
  }
  if (!threw) throw new Error('accepted an unparseable time');
});

check('day names parse from prefixes', () => {
  eq(parseDayOfWeek('monday'), 1);
  eq(parseDayOfWeek('Sat'), 6);
  eq(parseDayOfWeek('sun'), 0);
  eq(parseDayOfWeek(3), 3);
});

check('minute formatting pads correctly', () => {
  eq(formatMinute(600), '10:00');
  eq(formatMinute(545), '09:05');
  eq(formatMinute(0), '00:00');
});

// ---------------------------------------------------------------- slots

// 2026-08-03 is a Monday.
const MON = new Date('2026-08-03T00:00:00.000Z');
const WEEK_LATER = new Date('2026-08-10T00:00:00.000Z');
const BEFORE_ALL = new Date('2026-08-01T00:00:00.000Z');

const window10to13 = {
  id: 'w1',
  dayOfWeek: 1,
  startMinute: 600,
  endMinute: 780,
  slotMinutes: 60,
  capacity: 1,
};

check('a 10:00-13:00 window at 60 minutes yields 3 slots', () => {
  const slots = generateSlots({
    windows: [window10to13],
    blackouts: [],
    bookedAt: [],
    from: MON,
    to: WEEK_LATER,
    now: BEFORE_ALL,
  });
  const monday = slots.filter((s) => s.localDate === '2026-08-03');
  eq(monday.map((s) => s.localTime), ['10:00', '11:00', '12:00']);
});

check('a trailing part-slot is never offered', () => {
  const slots = generateSlots({
    windows: [{ ...window10to13, endMinute: 800 }], // 10:00-13:20
    blackouts: [],
    bookedAt: [],
    from: MON,
    to: WEEK_LATER,
    now: BEFORE_ALL,
  });
  const monday = slots.filter((s) => s.localDate === '2026-08-03');
  eq(monday.map((s) => s.localTime), ['10:00', '11:00', '12:00']);
});

check('the window recurs weekly', () => {
  const slots = generateSlots({
    windows: [window10to13],
    blackouts: [],
    bookedAt: [],
    from: MON,
    to: new Date('2026-08-17T23:59:00.000Z'),
    now: BEFORE_ALL,
  });
  eq([...new Set(slots.map((s) => s.localDate))], ['2026-08-03', '2026-08-10', '2026-08-17']);
});

check('slots already in the past are not offered', () => {
  const slots = generateSlots({
    windows: [window10to13],
    blackouts: [],
    bookedAt: [],
    from: MON,
    to: WEEK_LATER,
    // 11:30 MYT on the Monday — 10:00 and 11:00 have gone.
    now: fromMytWallClock(2026, 8, 3, 690),
  });
  const monday = slots.filter((s) => s.localDate === '2026-08-03');
  eq(monday.map((s) => s.localTime), ['12:00']);
});

check('booked counts are attached per slot', () => {
  const slots = generateSlots({
    windows: [window10to13],
    blackouts: [],
    bookedAt: [fromMytWallClock(2026, 8, 3, 600)],
    from: MON,
    to: WEEK_LATER,
    now: BEFORE_ALL,
  });
  const ten = slots.find((s) => s.localDate === '2026-08-03' && s.localTime === '10:00')!;
  eq([ten.booked, ten.capacity], [1, 1]);
});

check('capacity above 1 allows several bookings in one slot', () => {
  const at = fromMytWallClock(2026, 8, 3, 600);
  const slots = generateSlots({
    windows: [{ ...window10to13, capacity: 3 }],
    blackouts: [],
    bookedAt: [at, at],
    from: MON,
    to: WEEK_LATER,
    now: BEFORE_ALL,
  });
  const ten = slots.find((s) => s.localTime === '10:00')!;
  eq([ten.booked, ten.capacity], [2, 3]);
});

check('a whole-day blackout closes that date only', () => {
  const slots = generateSlots({
    windows: [window10to13],
    blackouts: [{ date: fromMytWallClock(2026, 8, 10, 0), reason: 'Public holiday' }],
    bookedAt: [],
    from: MON,
    to: new Date('2026-08-17T23:59:00.000Z'),
    now: BEFORE_ALL,
  });
  eq([...new Set(slots.map((s) => s.localDate))], ['2026-08-03', '2026-08-17']);
});

check('a partial blackout closes only the overlapping slots', () => {
  const slots = generateSlots({
    windows: [window10to13],
    blackouts: [
      // 10:30-11:30 blocks the 10:00 and 11:00 slots, but not 12:00.
      { date: fromMytWallClock(2026, 8, 3, 0), startMinute: 630, endMinute: 690, reason: 'Dentist' },
    ],
    bookedAt: [],
    from: MON,
    to: new Date('2026-08-04T00:00:00.000Z'),
    now: BEFORE_ALL,
  });
  eq(slots.map((s) => s.localTime), ['12:00']);
});

check('a blackout that ends exactly when a slot starts does not block it', () => {
  const slots = generateSlots({
    windows: [window10to13],
    blackouts: [{ date: fromMytWallClock(2026, 8, 3, 0), startMinute: 540, endMinute: 600, reason: 'Meeting' }],
    bookedAt: [],
    from: MON,
    to: new Date('2026-08-04T00:00:00.000Z'),
    now: BEFORE_ALL,
  });
  eq(slots.map((s) => s.localTime), ['10:00', '11:00', '12:00']);
});

check('several windows on one day are merged in time order', () => {
  const slots = generateSlots({
    windows: [
      window10to13,
      { id: 'w2', dayOfWeek: 1, startMinute: 900, endMinute: 1020, slotMinutes: 60, capacity: 1 }, // 15:00-17:00
    ],
    blackouts: [],
    bookedAt: [],
    from: MON,
    to: new Date('2026-08-04T00:00:00.000Z'),
    now: BEFORE_ALL,
  });
  eq(slots.map((s) => s.localTime), ['10:00', '11:00', '12:00', '15:00', '16:00']);
});

check('no windows means no slots, not a crash', () => {
  eq(generateSlots({ windows: [], blackouts: [], bookedAt: [], from: MON, to: WEEK_LATER }).length, 0);
});

check('slot labels read the way a person would say them', () => {
  eq(describeSlot(fromMytWallClock(2026, 8, 3, 600), 60), 'Mon 3 Aug, 10:00–11:00');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) failures.forEach((f) => console.log(`  - ${f}`));
process.exit(fail ? 1 : 0);
