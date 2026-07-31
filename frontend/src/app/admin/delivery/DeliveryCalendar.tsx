'use client';

import { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * The month grid that drives the whole delivery page — the Calendly shape: see
 * the month at a glance, click a day, work on that day.
 *
 * Every future day is selectable. There is no availability layer to grey days
 * out against (see the delivery models in schema.prisma); the only thing the
 * grid reports is how many deliveries are already booked on each day, which is
 * what actually helps when deciding where to put the next one.
 *
 * Works on "YYYY-MM-DD" date KEYS in Malaysia local time, never on Date
 * objects, so the grid cannot drift a day against what the backend returns.
 */

interface Props {
  /** Count of existing bookings per "YYYY-MM-DD". */
  bookingsByDate?: Record<string, number>;
  /** First of the visible month, as "YYYY-MM". */
  month: string;
  onMonthChange: (month: string) => void;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  /** Today's date key in Malaysia time — past days are not selectable. */
  today: string;
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** Day-of-week for a date key, computed without constructing a local Date. */
function dayOfWeek(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

export function DeliveryCalendar({
  bookingsByDate = {},
  month,
  onMonthChange,
  selectedDate,
  onSelectDate,
  today,
}: Props) {
  const [year, monthNum] = month.split('-').map(Number);

  // Leading blanks so the 1st lands under the right weekday, then the days.
  const cells = useMemo(() => {
    const first = `${year}-${pad(monthNum)}-01`;
    const lead = dayOfWeek(first);
    const count = daysInMonth(year, monthNum);
    const out: (string | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= count; d++) out.push(`${year}-${pad(monthNum)}-${pad(d)}`);
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [year, monthNum]);

  const monthTotal = useMemo(
    () => Object.entries(bookingsByDate).reduce((n, [k, v]) => (k.startsWith(month) ? n + v : n), 0),
    [bookingsByDate, month]
  );

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-lg font-medium text-text-primary">
            {MONTH_NAMES[monthNum - 1]} {year}
          </p>
          <p className="text-xs text-text-muted">
            {monthTotal} {monthTotal === 1 ? 'delivery' : 'deliveries'} this month
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onMonthChange(shiftMonth(month, -1))}
            className="rounded-lg border border-border p-2 text-text-secondary transition-all hover:bg-surface-elevated active:scale-95"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onMonthChange(today.slice(0, 7))}
            className="rounded-lg border border-border px-3 py-2 text-xs text-text-secondary transition-all hover:bg-surface-elevated active:scale-95"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => onMonthChange(shiftMonth(month, 1))}
            className="rounded-lg border border-border p-2 text-text-secondary transition-all hover:bg-surface-elevated active:scale-95"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mb-1.5 grid grid-cols-7 gap-1.5">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1 text-center text-[11px] font-medium text-text-muted">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((key, i) => {
          if (!key) return <div key={`blank-${i}`} />;

          const bookings = bookingsByDate[key] ?? 0;
          const isPast = key < today;
          const isToday = key === today;
          const isSelected = key === selectedDate;
          // Any day from today onwards can be booked. Past days stay clickable
          // so history is readable, but only if something happened on them.
          const selectable = !isPast || bookings > 0;
          const dayNum = Number(key.slice(8));

          return (
            <button
              key={key}
              type="button"
              disabled={!selectable}
              onClick={() => onSelectDate(key)}
              style={{ animationDelay: `${Math.min(i * 8, 200)}ms` }}
              title={
                bookings
                  ? `${bookings} delivery${bookings === 1 ? '' : 's'} booked`
                  : isPast
                    ? 'In the past'
                    : 'Nothing booked'
              }
              className={[
                'row-rise relative flex min-h-[62px] min-w-0 flex-col items-start gap-1 overflow-hidden rounded-xl border p-1.5 text-left transition-all sm:min-h-[76px] sm:p-2',
                isSelected
                  ? 'border-accent bg-accent text-white shadow-md'
                  : selectable
                    ? 'border-border bg-surface text-text-primary hover:-translate-y-0.5 hover:border-border-hover hover:shadow-sm active:scale-[0.98]'
                    : 'border-transparent bg-surface-elevated/40 text-text-muted',
                isToday && !isSelected ? 'ring-1 ring-accent/40' : '',
              ].join(' ')}
            >
              <span className={`text-sm font-medium ${isPast && !isSelected ? 'opacity-40' : ''}`}>
                {dayNum}
              </span>

              {/* How busy the day already is — the only signal that helps when
                  choosing where to put the next drop. */}
              {bookings > 0 && (
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium leading-none ${
                    isSelected ? 'bg-white/20 text-white' : 'bg-accent/10 text-accent'
                  }`}
                >
                  {bookings}
                  {/* A narrow cell has no room for the word; the number alone
                      still reads as "how busy is this day". */}
                  <span className="hidden sm:inline"> {bookings === 1 ? 'drop' : 'drops'}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
