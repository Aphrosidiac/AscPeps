/**
 * The reminder time parser.
 *
 * No database, no network, and `now` is injected so nothing here races the
 * wall clock. A reminder that fires at the wrong hour is worse than no
 * reminder at all — the operator believes they are covered — so the parsing is
 * pinned down directly rather than inferred from how a conversation went.
 *
 *   npx tsx scripts/test-reminder-time.ts
 */
import { parseReminderTime, describeReminderTime } from '../src/utils/reminder-time.js';
import { toMytParts } from '../src/utils/delivery-slots.js';

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

const throws = (fn: () => unknown, pattern: RegExp) => {
  try {
    fn();
  } catch (e: any) {
    if (!pattern.test(e.message)) throw new Error(`wrong error: ${e.message}`);
    return;
  }
  throw new Error('did not throw');
};

// A fixed "now": 2026-08-02 14:00 MYT === 06:00 UTC.
const NOW = new Date('2026-08-02T06:00:00.000Z');
// Sanity-check the fixture itself, so a wrong assumption here can't make every
// case below look right for the wrong reason.
check('the test fixture really is 14:00 MYT', () => {
  const p = toMytParts(NOW);
  eq([p.year, p.month, p.day, p.minuteOfDay], [2026, 8, 2, 14 * 60]);
});

// ---------------------------------------------------------------- relative

check('"in 30 minutes"', () => {
  eq(parseReminderTime('in 30 minutes', NOW).toISOString(), '2026-08-02T06:30:00.000Z');
});

check('"in 2 hours"', () => {
  eq(parseReminderTime('in 2 hours', NOW).toISOString(), '2026-08-02T08:00:00.000Z');
});

check('"in 3 days" keeps the time of day', () => {
  eq(parseReminderTime('in 3 days', NOW).toISOString(), '2026-08-05T06:00:00.000Z');
});

check('"in 1 week"', () => {
  eq(parseReminderTime('in 1 week', NOW).toISOString(), '2026-08-09T06:00:00.000Z');
});

check('short units parse too ("in 45m", "in 2h")', () => {
  eq(parseReminderTime('in 45m', NOW).toISOString(), '2026-08-02T06:45:00.000Z');
  eq(parseReminderTime('in 2h', NOW).toISOString(), '2026-08-02T08:00:00.000Z');
});

// ---------------------------------------------------------------- day words

check('"tomorrow 3pm" is 15:00 MYT the next day', () => {
  // 2026-08-03 15:00 MYT === 07:00 UTC.
  eq(parseReminderTime('tomorrow 3pm', NOW).toISOString(), '2026-08-03T07:00:00.000Z');
});

check('"tomorrow at 9am" — the filler word is ignored', () => {
  eq(parseReminderTime('tomorrow at 9am', NOW).toISOString(), '2026-08-03T01:00:00.000Z');
});

check('"today 9pm" stays on today', () => {
  eq(parseReminderTime('today 9pm', NOW).toISOString(), '2026-08-02T13:00:00.000Z');
});

check('"tonight" with no time means the evening, not midnight', () => {
  const p = toMytParts(parseReminderTime('tonight', NOW));
  eq([p.day, p.minuteOfDay], [2, 20 * 60]);
});

check('"tmr" and "esok" are understood', () => {
  eq(parseReminderTime('tmr 10am', NOW).toISOString(), '2026-08-03T02:00:00.000Z');
  eq(parseReminderTime('esok 10am', NOW).toISOString(), '2026-08-03T02:00:00.000Z');
});

// ---------------------------------------------------------------- dates

check('an ISO date with a time', () => {
  eq(parseReminderTime('2026-08-05 14:00', NOW).toISOString(), '2026-08-05T06:00:00.000Z');
});

check('an ISO date with no time defaults to 9am, not midnight', () => {
  // Midnight would technically satisfy "on the 5th" and be useless.
  const p = toMytParts(parseReminderTime('2026-08-05', NOW));
  eq([p.day, p.minuteOfDay], [5, 9 * 60]);
});

check('"5 Aug 3pm" and "Aug 5 3pm" both work', () => {
  eq(parseReminderTime('5 aug 3pm', NOW).toISOString(), '2026-08-05T07:00:00.000Z');
  eq(parseReminderTime('aug 5 3pm', NOW).toISOString(), '2026-08-05T07:00:00.000Z');
});

check('a month already past rolls to next year', () => {
  // January is behind us on 2 Aug 2026, so "10 jan" means 2027.
  eq(toMytParts(parseReminderTime('10 jan 9am', NOW)).year, 2027);
});

// ---------------------------------------------------------------- bare time

check('a bare time later today stays today', () => {
  eq(parseReminderTime('6pm', NOW).toISOString(), '2026-08-02T10:00:00.000Z');
});

check('a bare time already past rolls to tomorrow', () => {
  // 9am is behind 14:00, so it means tomorrow morning rather than the past.
  eq(parseReminderTime('9am', NOW).toISOString(), '2026-08-03T01:00:00.000Z');
});

// ---------------------------------------------------------------- refusals

check('a time in the past is refused, not silently moved', () => {
  throws(() => parseReminderTime('2020-01-01 09:00', NOW), /in the past/i);
});

check('a mistyped year is refused', () => {
  throws(() => parseReminderTime('2126-01-01 09:00', NOW), /two years/i);
});

check('something unparseable is refused rather than guessed', () => {
  // "sometime next week" has no defensible instant behind it; picking one
  // would leave the operator believing they are covered when they are not.
  throws(() => parseReminderTime('sometime next week', NOW), /could not read/i);
  throws(() => parseReminderTime('', NOW), /no time given/i);
});

// ---------------------------------------------------------------- host tz

check('the parser does not depend on the host timezone', () => {
  const before = process.env.TZ;
  const results: string[] = [];
  for (const tz of ['UTC', 'America/New_York', 'Asia/Shanghai', 'Asia/Kuala_Lumpur']) {
    process.env.TZ = tz;
    results.push(parseReminderTime('tomorrow 3pm', NOW).toISOString());
  }
  process.env.TZ = before;
  if (new Set(results).size !== 1) throw new Error(`host timezone changed the answer: ${results.join(' | ')}`);
});

// ---------------------------------------------------------------- formatting

check('the human label reads in Malaysia time, with an explicit AM/PM', () => {
  // 24-hour was observed being read back by the model as the wrong half of the
  // day ("06:26" repeated as "6:26 PM"), so the label spells it out.
  eq(describeReminderTime(new Date('2026-08-03T07:00:00.000Z')), 'Mon 3 Aug, 3:00 PM');
  eq(describeReminderTime(new Date('2026-08-04T22:26:00.000Z')), 'Wed 5 Aug, 6:26 AM');
  // Midnight and noon are the two the 12-hour clock gets wrong most often.
  eq(describeReminderTime(new Date('2026-08-04T16:00:00.000Z')), 'Wed 5 Aug, 12:00 AM');
  eq(describeReminderTime(new Date('2026-08-05T04:00:00.000Z')), 'Wed 5 Aug, 12:00 PM');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) failures.forEach((f) => console.log(`  - ${f}`));
process.exit(fail ? 1 : 0);
