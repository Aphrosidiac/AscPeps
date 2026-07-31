'use client';

import { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Month grid for picking a delivery date — the Calendly shape: see the whole
 * month at a glance, click a day, then choose a time.
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
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
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

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onMonthChange(shiftMonth(month, -1))}
          className="rounded-lg border border-border p-1.5 text-text-secondary transition-colors hover:bg-surface-elevated active:scale-95"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="text-sm font-medium text-text-primary">
          {MONTH_NAMES[monthNum - 1]} {year}
        </p>
        <button
          type="button"
          onClick={() => onMonthChange(shiftMonth(month, 1))}
          className="rounded-lg border border-border p-1.5 text-text-secondary transition-colors hover:bg-surface-elevated active:scale-95"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-1">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1 text-center text-[11px] font-medium text-text-muted">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((key, i) => {
          if (!key) return <div key={`blank-${i}`} />;

          const bookings = bookingsByDate[key] ?? 0;
          const isPast = key < today;
          const isToday = key === today;
          const isSelected = key === selectedDate;
          // Any day from today onwards can be booked. Past days are excluded
          // because scheduling a delivery into the past is always a mistake.
          const selectable = !isPast;
          const dayNum = Number(key.slice(8));

          return (
            <button
              key={key}
              type="button"
              disabled={!selectable}
              onClick={() => onSelectDate(isSelected ? null : key)}
              style={{ animationDelay: `${Math.min(i * 8, 200)}ms` }}
              title={
                isPast
                  ? 'In the past'
                  : bookings
                    ? `${bookings} delivery${bookings === 1 ? '' : 's'} already booked`
                    : 'No deliveries booked'
              }
              className={[
                'row-rise relative flex aspect-square flex-col items-center justify-center rounded-lg border text-sm transition-all',
                isSelected
                  ? 'border-accent bg-accent text-white shadow-sm'
                  : selectable
                    ? 'border-border bg-surface text-text-primary hover:border-border-hover hover:bg-surface-elevated active:scale-95'
                    : 'border-transparent bg-surface-elevated/40 text-text-muted cursor-not-allowed',
                isToday && !isSelected ? 'ring-1 ring-accent/40' : '',
              ].join(' ')}
            >
              <span className={isPast && !isSelected ? 'opacity-50' : ''}>{dayNum}</span>

              {/* How busy the day already is — the only signal that helps
                  when choosing where to put the next drop. */}
              {bookings > 0 && (
                <span className={`text-[9px] leading-none ${isSelected ? 'text-white/80' : 'text-text-muted'}`}>
                  {bookings} booked
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
