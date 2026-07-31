/**
 * Unit tests for the delivery time helpers.
 *
 * No database, no network. The timezone arithmetic is the part most likely to
 * be quietly wrong — and wrong here means a delivery booked for the wrong hour,
 * or the wrong day — so it is tested directly rather than inferred from how the
 * UI looks.
 *
 * The slot-generation cases that used to live here went with the availability
 * layer; what remains is the conversion every booking still depends on.
 *
 *   npx tsx scripts/test-delivery-slots.ts
 */
import {
  describeSlot,
  formatMinute,
  fromMytWallClock,
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

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) failures.forEach((f) => console.log(`  - ${f}`));
process.exit(fail ? 1 : 0);
