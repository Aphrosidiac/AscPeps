'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Animate } from '@/components/ui/Animate';
import { DeliveryCalendar } from './DeliveryCalendar';
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  Plus,
  RefreshCw,
  Trash2,
  Truck,
  XCircle,
} from 'lucide-react';
import {
  adminCancelDelivery,
  adminDeliveryBookings,
  adminScheduleDelivery,
  adminUnscheduledOrders,
  adminUpdateDeliveryStatus,
} from '@/lib/api';

interface Booking {
  id: string;
  orderId: string;
  orderNumber: string;
  customer: string;
  phone: string;
  address: string | null;
  orderTotal: number;
  paymentStatus: string;
  label: string;
  localDate: string;
  localTime: string;
  status: string;
  notes: string | null;
}
interface UnscheduledOrder {
  id: string;
  orderNumber: string;
  customerName: string;
  phone: string;
  city: string;
  state: string;
  total: number;
  paymentStatus: string;
}

interface ApiError {
  message?: string;
  response?: { data?: { message?: string } };
}
const errorMessage = (e: unknown, fallback: string) => {
  const err = e as ApiError;
  return err?.response?.data?.message ?? err?.message ?? fallback;
};

// The admin's browser could be anywhere; the schedule is always Malaysia time.
// Deriving "today" from a fixed +08 keeps the calendar's past/future boundary
// identical to the server's.
const mytTodayKey = () => new Date(Date.now() + 8 * 60 * 60_000).toISOString().slice(0, 10);

const rm = (cents: number) => `RM ${(cents / 100).toFixed(2)}`;

const longDate = (key: string) =>
  new Date(`${key}T00:00:00`).toLocaleDateString('en-MY', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

const QUICK_TIMES = ['10:00', '12:00', '14:00', '16:00', '18:00', '20:00'];

export default function DeliveryPage() {
  const { token } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [unscheduled, setUnscheduled] = useState<UnscheduledOrder[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const [today] = useState(mytTodayKey);
  const [month, setMonth] = useState(() => mytTodayKey().slice(0, 7));
  const [pickedDate, setPickedDate] = useState<string>(today);

  // The booking form lives inside the selected day, so a booking is always
  // made *at* a day rather than at a date typed into a box.
  const [adding, setAdding] = useState(false);
  const [orderId, setOrderId] = useState('');
  const [pickedTime, setPickedTime] = useState('14:00');
  const [notes, setNotes] = useState('');

  const refresh = useCallback(() => {
    if (!token) return;
    adminDeliveryBookings(token, { limit: '200' }).then(setBookings).catch(() => {});
    adminUnscheduledOrders(token).then(setUnscheduled).catch(() => {});
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const act = (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    fn()
      .then(() => refresh())
      .catch((e: unknown) => alert(errorMessage(e, 'Failed')))
      .finally(() => setBusy(null));
  };

  // Cancelled bookings are kept for history but are not part of the diary.
  const live = useMemo(() => bookings.filter((b) => b.status !== 'CANCELLED'), [bookings]);

  const bookingsByDate = useMemo(
    () =>
      live.reduce<Record<string, number>>((acc, b) => {
        acc[b.localDate] = (acc[b.localDate] ?? 0) + 1;
        return acc;
      }, {}),
    [live]
  );

  const dayBookings = useMemo(
    () => live.filter((b) => b.localDate === pickedDate).sort((a, b) => a.localTime.localeCompare(b.localTime)),
    [live, pickedDate]
  );

  const openAdd = (preselect?: string) => {
    setOrderId(preselect ?? '');
    setPickedTime('14:00');
    setNotes('');
    setAdding(true);
    if (pickedDate < today) setPickedDate(today);
    // Booking happens up in the selected day, which can be off-screen when the
    // order was picked from the queue below.
    document.getElementById('delivery-day')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const book = () => {
    if (!token || !orderId) return;
    act('book', async () => {
      await adminScheduleDelivery(token, {
        orderId,
        scheduledFor: `${pickedDate}T${pickedTime}:00+08:00`,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      setAdding(false);
      setOrderId('');
      setNotes('');
    });
  };

  if (!token) return <div className="p-8 text-text-secondary">Loading…</div>;

  const statusTint: Record<string, string> = {
    SCHEDULED: 'border-border',
    COMPLETED: 'border-green-300 bg-green-50/40',
    FAILED: 'border-amber-300 bg-amber-50/40',
  };

  return (
    // No padding of its own: the admin <main> already pads every page, and
    // adding p-6 on top left this one with 295px of a 375px screen while every
    // sibling page got 343.
    <div className="space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-text-primary">
            <Truck className="h-6 w-6" /> Delivery Schedule
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Asywa&apos;s delivery diary. Pick a day, put an order on it — all times are Malaysia time.
          </p>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-elevated active:scale-[0.98]"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </header>

      {/* ---- The calendar runs the page: month on the left, the chosen day's
           run sheet and booking form on the right. ---- */}
      <Animate variant="fadeUp">
        <section className="grid gap-6 rounded-2xl border border-border bg-surface p-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0">
            <DeliveryCalendar
              bookingsByDate={bookingsByDate}
              month={month}
              onMonthChange={(m) => setMonth(m)}
              selectedDate={pickedDate}
              // The form follows the calendar rather than being dismissed by
              // it — changing your mind about the day mid-booking is the most
              // ordinary thing to do, and it should not cost you the order you
              // already picked.
              onSelectDate={(d) => {
                setPickedDate(d);
                if (d < today) setAdding(false);
              }}
              today={today}
            />
          </div>

          {/* Selected day */}
          <div id="delivery-day" key={pickedDate} className="slot-column min-w-0 lg:border-l lg:border-border lg:pl-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-text-primary">{longDate(pickedDate)}</p>
                <p className="text-xs text-text-muted">
                  {pickedDate === today ? 'Today · ' : ''}
                  {dayBookings.length
                    ? `${dayBookings.length} ${dayBookings.length === 1 ? 'delivery' : 'deliveries'}`
                    : 'Nothing booked'}
                </p>
              </div>
              {!adding && pickedDate >= today && (
                <button
                  onClick={() => openAdd()}
                  className="flex shrink-0 items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-all hover:opacity-90 active:scale-[0.97]"
                >
                  <Plus className="h-3.5 w-3.5" /> Add
                </button>
              )}
            </div>

            {/* Booking form, in place on the day it books into. */}
            {adding && (
              <div className="slot-column mt-4 rounded-xl border border-border bg-surface-elevated/60 p-4">
                <label className="block text-xs text-text-muted">Order</label>
                <select
                  value={orderId}
                  onChange={(e) => setOrderId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
                >
                  <option value="">Choose an order…</option>
                  {unscheduled.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.orderNumber} — {o.customerName} ({o.city})
                    </option>
                  ))}
                </select>
                {!unscheduled.length && (
                  <p className="mt-1 text-xs text-text-muted">Every live order already has a delivery booked.</p>
                )}

                <label className="mt-3 block text-xs text-text-muted">Time</label>
                <input
                  type="time"
                  value={pickedTime}
                  onChange={(e) => setPickedTime(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
                />
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  {QUICK_TIMES.map((t, i) => (
                    <button
                      key={t}
                      type="button"
                      style={{ animationDelay: `${i * 25}ms` }}
                      onClick={() => setPickedTime(t)}
                      className={`row-rise rounded-md border py-1.5 text-xs transition-all active:scale-95 ${
                        pickedTime === t
                          ? 'border-accent bg-accent text-white'
                          : 'border-border text-text-secondary hover:bg-surface'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                <label className="mt-3 block text-xs text-text-muted">Note for the driver</label>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Gate code, call on arrival…"
                  className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
                />

                <div className="mt-4 flex gap-2">
                  <button
                    disabled={!!busy || !orderId}
                    onClick={book}
                    className="flex-1 rounded-lg bg-accent py-2.5 text-sm font-medium text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-40"
                  >
                    {busy === 'book' ? 'Booking…' : 'Book delivery'}
                  </button>
                  <button
                    onClick={() => setAdding(false)}
                    className="rounded-lg border border-border px-3 py-2.5 text-sm text-text-secondary transition-colors hover:bg-surface"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* That day's run sheet, in the order she drives it. */}
            <div className="mt-4 space-y-2">
              {dayBookings.map((b, i) => (
                <div
                  key={b.id}
                  style={{ animationDelay: `${Math.min(i * 40, 300)}ms` }}
                  className={`row-rise rounded-xl border px-4 py-3 transition-all hover:shadow-sm ${
                    statusTint[b.status] ?? 'border-border'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-medium text-text-primary">
                      {b.localTime} · {b.customer}
                    </p>
                    <span className="shrink-0 text-xs text-text-muted">{b.orderNumber}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-text-secondary">{b.address}</p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {b.phone} · {rm(b.orderTotal)} ·{' '}
                    <span className={b.paymentStatus === 'PAID' ? 'text-green-700' : 'text-amber-700'}>
                      {b.paymentStatus}
                    </span>
                    {b.notes ? ` · ${b.notes}` : ''}
                  </p>

                  {b.status === 'SCHEDULED' ? (
                    <div className="mt-2 flex items-center gap-1.5">
                      <button
                        disabled={!!busy}
                        onClick={() =>
                          act(`done-${b.id}`, () => adminUpdateDeliveryStatus(token, b.id, { status: 'COMPLETED' }))
                        }
                        className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-green-700 transition-colors hover:bg-green-50 active:scale-[0.97] disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Delivered
                      </button>
                      <button
                        disabled={!!busy}
                        onClick={() =>
                          act(`fail-${b.id}`, () => adminUpdateDeliveryStatus(token, b.id, { status: 'FAILED' }))
                        }
                        className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-elevated active:scale-[0.97] disabled:opacity-50"
                      >
                        <XCircle className="h-3.5 w-3.5" /> Failed
                      </button>
                      <button
                        disabled={!!busy}
                        onClick={() => {
                          if (!confirm(`Cancel the delivery for ${b.orderNumber}?`)) return;
                          act(`cancel-${b.id}`, () => adminCancelDelivery(token, b.id));
                        }}
                        className="ml-auto rounded border border-border p-1.5 text-danger transition-colors hover:bg-red-50 active:scale-[0.95] disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center gap-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          b.status === 'COMPLETED' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {b.status}
                      </span>
                      <button
                        disabled={!!busy}
                        onClick={() =>
                          act(`undo-${b.id}`, () => adminUpdateDeliveryStatus(token, b.id, { status: 'SCHEDULED' }))
                        }
                        className="text-xs text-text-muted underline-offset-2 transition-colors hover:text-text-primary hover:underline disabled:opacity-50"
                      >
                        put back
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {!dayBookings.length && !adding && (
                <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-text-muted">
                  {pickedDate < today ? 'Nothing was delivered this day.' : 'Nothing booked. Add a delivery.'}
                </p>
              )}
            </div>
          </div>
        </section>
      </Animate>

      {/* ---- The queue. "Book" drops the order straight into the day that is
           already selected above. ---- */}
      <Animate variant="fadeUp" delay={0.05}>
        <section className="rounded-xl border border-border bg-surface p-6">
          <h2 className="flex items-center gap-2 text-lg font-medium text-text-primary">
            <Clock className="h-5 w-5" /> Waiting for a slot
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            Live orders with no delivery booked yet. Booking one puts it on{' '}
            <span className="text-text-primary">{longDate(pickedDate < today ? today : pickedDate)}</span> — pick a
            different day in the calendar first to change that.
          </p>

          <div className="mt-4 space-y-2">
            {unscheduled.map((o, i) => (
              <div
                key={o.id}
                style={{ animationDelay: `${Math.min(i * 35, 350)}ms` }}
                className="row-rise flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-elevated px-4 py-3 transition-all hover:border-border-hover hover:shadow-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium text-text-primary">
                    {o.customerName} <span className="text-sm font-normal text-text-muted">{o.orderNumber}</span>
                  </p>
                  <p className="text-xs text-text-muted">
                    {o.city}, {o.state} · {rm(o.total)} ·{' '}
                    <span className={o.paymentStatus === 'PAID' ? 'text-green-700' : 'text-amber-700'}>
                      {o.paymentStatus}
                    </span>
                  </p>
                </div>
                <button
                  onClick={() => openAdd(o.id)}
                  className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-all hover:opacity-90 active:scale-[0.97]"
                >
                  <CalendarDays className="h-3.5 w-3.5" /> Book a slot
                </button>
              </div>
            ))}
            {!unscheduled.length && (
              <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">
                Every live order has a delivery booked.
              </p>
            )}
          </div>
        </section>
      </Animate>
    </div>
  );
}
