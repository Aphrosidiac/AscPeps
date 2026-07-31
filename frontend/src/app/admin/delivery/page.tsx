'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Animate } from '@/components/ui/Animate';
import { DeliveryCalendar } from './DeliveryCalendar';
import { CalendarDays, CheckCircle2, Clock, MapPin, RefreshCw, Trash2, Truck, User, XCircle } from 'lucide-react';
import {
  adminCancelDelivery,
  adminDeliveryBookings,
  adminScheduleDelivery,
  adminUnscheduledOrders,
  adminUpdateDeliveryStatus,
} from '@/lib/api';

interface Booking {
  id: string;
  orderNumber: string;
  customer: string;
  phone: string;
  address: string | null;
  orderTotal: number;
  paymentStatus: string;
  label: string;
  localDate: string;
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

export default function DeliveryPage() {
  const { token } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [unscheduled, setUnscheduled] = useState<UnscheduledOrder[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const [assigning, setAssigning] = useState<UnscheduledOrder | null>(null);
  const [pickedTime, setPickedTime] = useState('14:00');
  const [today] = useState(mytTodayKey);
  const [month, setMonth] = useState(() => mytTodayKey().slice(0, 7));
  const [pickedDate, setPickedDate] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!token) return;
    adminDeliveryBookings(token, { limit: '100' }).then(setBookings).catch(() => {});
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

  if (!token) return <div className="p-8 text-text-secondary">Loading…</div>;

  const openPicker = (order: UnscheduledOrder) => {
    setPickedDate(null);
    setPickedTime('14:00');
    setMonth(today.slice(0, 7));
    setAssigning(order);
  };


  const upcoming = bookings.filter((b) => b.status === 'SCHEDULED');
  const bookingsByDate = upcoming.reduce<Record<string, number>>((acc, b) => {
    acc[b.localDate] = (acc[b.localDate] ?? 0) + 1;
    return acc;
  }, {});
  // Group the run sheet by day — that is how a delivery day is actually planned.
  const byDate = upcoming.reduce<Record<string, Booking[]>>((acc, b) => {
    (acc[b.localDate] ??= []).push(b);
    return acc;
  }, {});

  return (
    <div className="space-y-8 p-6 md:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-text-primary">
            <Truck className="h-6 w-6" /> Delivery Schedule
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Asywa&apos;s delivery diary. Pick any date and time for an order — all times are Malaysia time.
          </p>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-elevated active:scale-[0.98]"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </header>

      {/* ---- Run sheet ---- */}
      <Animate variant="fadeUp">
      <section className="rounded-xl border border-border bg-surface p-6">
        <h2 className="flex items-center gap-2 text-lg font-medium text-text-primary">
          <CalendarDays className="h-5 w-5" /> Upcoming deliveries
        </h2>
        <p className="mt-1 text-sm text-text-secondary">{upcoming.length} scheduled.</p>

        <div className="mt-4 space-y-5">
          {Object.entries(byDate).map(([date, list], dayIndex) => (
            <div key={date} className="row-rise" style={{ animationDelay: `${Math.min(dayIndex * 60, 300)}ms` }}>
              <p className="mb-2 text-sm font-medium text-text-primary">
                {new Date(`${date}T00:00:00`).toLocaleDateString('en-MY', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}
              </p>
              <div className="space-y-2">
                {list.map((b, i) => (
                  <div
                    key={b.id}
                    style={{ animationDelay: `${Math.min(dayIndex * 60 + i * 35, 400)}ms` }}
                    className="row-rise rounded-lg border border-border bg-surface-elevated px-4 py-3 transition-all hover:border-border-hover hover:shadow-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-text-primary">
                          {b.label.split(', ')[1]} · {b.customer}{' '}
                          <span className="text-sm font-normal text-text-muted">{b.orderNumber}</span>
                        </p>
                        <p className="text-sm text-text-secondary">{b.address}</p>
                        <p className="mt-0.5 text-xs text-text-muted">
                          {b.phone} · {rm(b.orderTotal)} ·{' '}
                          <span className={b.paymentStatus === 'PAID' ? 'text-green-700' : 'text-amber-700'}>
                            {b.paymentStatus}
                          </span>
                          {b.notes ? ` · ${b.notes}` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          disabled={!!busy}
                          onClick={() => act(`done-${b.id}`, () => adminUpdateDeliveryStatus(token, b.id, { status: 'COMPLETED' }))}
                          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-green-700 transition-colors hover:bg-green-50 active:scale-[0.97] disabled:opacity-50"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Delivered
                        </button>
                        <button
                          disabled={!!busy}
                          onClick={() => act(`fail-${b.id}`, () => adminUpdateDeliveryStatus(token, b.id, { status: 'FAILED' }))}
                          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-elevated active:scale-[0.97] disabled:opacity-50"
                        >
                          <XCircle className="h-3.5 w-3.5" /> Failed
                        </button>
                        <button
                          disabled={!!busy}
                          onClick={() => {
                            if (!confirm(`Cancel the delivery for ${b.orderNumber}? The slot will be freed.`)) return;
                            act(`cancel-${b.id}`, () => adminCancelDelivery(token, b.id));
                          }}
                          className="rounded border border-border p-1.5 text-danger transition-colors hover:bg-red-50 active:scale-[0.95] disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {!upcoming.length && (
            <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-text-muted">
              Nothing scheduled. Book an order into a slot below.
            </p>
          )}
        </div>
      </section>

      </Animate>

      {/* ---- Orders waiting for a slot ---- */}
      <Animate variant="fadeUp" delay={0.05}>
      <section className="rounded-xl border border-border bg-surface p-6">
        <h2 className="flex items-center gap-2 text-lg font-medium text-text-primary">
          <Clock className="h-5 w-5" /> Waiting for a slot
        </h2>
        <p className="mt-1 text-sm text-text-secondary">Live orders with no delivery booked yet.</p>

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
                onClick={() => openPicker(o)}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-all hover:opacity-90 active:scale-[0.97]"
              >
                Book a slot
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

      {/* ---- Slot picker — the Calendly layout: details on the left, month
           grid in the middle, that day's times sliding in beside it ---- */}
      {assigning && (
        <div
          className="dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setAssigning(null)}
        >
          <div
            className="dialog-panel flex max-h-[86vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-surface shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Left rail — what is being booked. */}
            <div className="hidden w-64 shrink-0 border-r border-border bg-surface-elevated/50 p-6 sm:block">
              <p className="text-sm text-text-muted">{assigning.orderNumber}</p>
              <h3 className="mt-1 font-display text-lg font-semibold text-text-primary">
                {assigning.customerName}
              </h3>

              <div className="mt-5 space-y-3 text-sm text-text-secondary">
                <p className="flex items-start gap-2">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
                  <span>60 min delivery slot</span>
                </p>
                <p className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
                  <span>
                    {assigning.city}, {assigning.state}
                  </span>
                </p>
                <p className="flex items-start gap-2">
                  <User className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
                  <span>{assigning.phone}</span>
                </p>
                <p className="flex items-start gap-2">
                  <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
                  <span>Malaysia time (UTC+8)</span>
                </p>
              </div>

              <p className="mt-6 border-t border-border pt-4 text-xs text-text-muted">
                {rm(assigning.total)} · {assigning.paymentStatus}
              </p>
            </div>

            {/* Calendar + times */}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-6 py-4">
                <h3 className="font-medium text-text-primary">Select a date &amp; time</h3>
                <button
                  onClick={() => setAssigning(null)}
                  className="rounded-lg p-1 text-text-muted transition-colors hover:bg-surface-elevated hover:text-text-primary"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <div className="flex min-h-0 flex-1 gap-6 overflow-y-auto p-6">
                <div className="min-w-0 flex-1">
                  <DeliveryCalendar
                    bookingsByDate={bookingsByDate}
                    month={month}
                    onMonthChange={(m) => {
                      setMonth(m);
                      setPickedDate(null);
                    }}
                    selectedDate={pickedDate}
                    onSelectDate={setPickedDate}
                    today={today}
                  />
                </div>

                {/* Time for the chosen day. Free text plus a few common
                    times — there are no fixed slots to choose from. */}
                {pickedDate && (
                  <div key={pickedDate} className="slot-column w-44 shrink-0 border-l border-border pl-5">
                    <p className="mb-3 text-sm font-medium text-text-primary">
                      {new Date(`${pickedDate}T00:00:00`).toLocaleDateString('en-MY', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'short',
                      })}
                    </p>

                    <label className="block text-xs text-text-muted">Time</label>
                    <input
                      type="time"
                      value={pickedTime}
                      onChange={(e) => setPickedTime(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
                    />

                    <div className="mt-3 grid grid-cols-3 gap-1.5">
                      {['10:00', '12:00', '14:00', '16:00', '18:00', '20:00'].map((t, i) => (
                        <button
                          key={t}
                          type="button"
                          style={{ animationDelay: `${i * 25}ms` }}
                          onClick={() => setPickedTime(t)}
                          className={`row-rise rounded-md border py-1.5 text-xs transition-all active:scale-95 ${
                            pickedTime === t
                              ? 'border-accent bg-accent text-white'
                              : 'border-border text-text-secondary hover:bg-surface-elevated'
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>

                    <button
                      disabled={!!busy || !pickedTime}
                      onClick={() =>
                        act('assign', async () => {
                          await adminScheduleDelivery(token, {
                            orderId: assigning.id,
                            scheduledFor: `${pickedDate}T${pickedTime}:00+08:00`,
                          });
                          setAssigning(null);
                          setPickedDate(null);
                        })
                      }
                      className="mt-4 w-full rounded-lg bg-accent py-2.5 text-sm font-medium text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-40"
                    >
                      {busy === 'assign' ? 'Booking…' : 'Book delivery'}
                    </button>
                  </div>
                )}
              </div>

              {!pickedDate && (
                <p className="border-t border-border px-6 py-3 text-xs text-text-muted">
                  Pick a day to set a delivery time.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
