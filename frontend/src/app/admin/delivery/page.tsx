'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { CalendarDays, CalendarOff, CheckCircle2, Clock, Loader2, Plus, RefreshCw, Trash2, Truck, XCircle } from 'lucide-react';
import {
  adminCancelDelivery,
  adminCreateDeliveryBlackout,
  adminDeleteDeliveryBlackout,
  adminDeleteDeliveryWindow,
  adminDeliveryBookings,
  adminDeliverySlots,
  adminDeliveryWindows,
  adminSaveDeliveryWindow,
  adminScheduleDelivery,
  adminUnscheduledOrders,
  adminUpdateDeliveryStatus,
} from '@/lib/api';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface Window {
  id: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  slotMinutes: number;
  capacity: number;
  active: boolean;
  notes: string | null;
}
interface Blackout {
  id: string;
  date: string;
  startMinute: number | null;
  endMinute: number | null;
  reason: string;
}
interface Slot {
  startsAt: string;
  localDate: string;
  localTime: string;
  label: string;
  booked: number;
  capacity: number;
  open: boolean;
}
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

const fmtMinute = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const rm = (cents: number) => `RM ${(cents / 100).toFixed(2)}`;

export default function DeliveryPage() {
  const { token } = useAuth();
  const [windows, setWindows] = useState<Window[]>([]);
  const [blackouts, setBlackouts] = useState<Blackout[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [unscheduled, setUnscheduled] = useState<UnscheduledOrder[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const [newWindow, setNewWindow] = useState({ day: 1, from: '10:00', to: '13:00', slotMinutes: 60, capacity: 1 });
  const [newBlackout, setNewBlackout] = useState({ date: '', reason: '' });
  const [assigning, setAssigning] = useState<UnscheduledOrder | null>(null);

  const refresh = useCallback(() => {
    if (!token) return;
    adminDeliveryWindows(token)
      .then((d) => {
        setWindows(d.windows ?? []);
        setBlackouts(d.blackouts ?? []);
      })
      .catch(() => {});
    adminDeliveryBookings(token, { limit: '100' }).then(setBookings).catch(() => {});
    adminDeliverySlots(token).then(setSlots).catch(() => {});
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

  const upcoming = bookings.filter((b) => b.status === 'SCHEDULED');
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
            Asywa&apos;s delivery diary. Set the windows she can deliver in, then book orders into the slots. All times
            are Malaysia time.
          </p>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-secondary hover:bg-surface-elevated"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </header>

      {/* ---- Run sheet ---- */}
      <section className="rounded-xl border border-border bg-surface p-6">
        <h2 className="flex items-center gap-2 text-lg font-medium text-text-primary">
          <CalendarDays className="h-5 w-5" /> Upcoming deliveries
        </h2>
        <p className="mt-1 text-sm text-text-secondary">{upcoming.length} scheduled.</p>

        <div className="mt-4 space-y-5">
          {Object.entries(byDate).map(([date, list]) => (
            <div key={date}>
              <p className="mb-2 text-sm font-medium text-text-primary">
                {new Date(`${date}T00:00:00`).toLocaleDateString('en-MY', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}
              </p>
              <div className="space-y-2">
                {list.map((b) => (
                  <div key={b.id} className="rounded-lg border border-border bg-surface-elevated px-4 py-3">
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
                          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-green-700 hover:bg-green-50 disabled:opacity-50"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Delivered
                        </button>
                        <button
                          disabled={!!busy}
                          onClick={() => act(`fail-${b.id}`, () => adminUpdateDeliveryStatus(token, b.id, { status: 'FAILED' }))}
                          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface-elevated disabled:opacity-50"
                        >
                          <XCircle className="h-3.5 w-3.5" /> Failed
                        </button>
                        <button
                          disabled={!!busy}
                          onClick={() => {
                            if (!confirm(`Cancel the delivery for ${b.orderNumber}? The slot will be freed.`)) return;
                            act(`cancel-${b.id}`, () => adminCancelDelivery(token, b.id));
                          }}
                          className="rounded border border-border p-1.5 text-danger hover:bg-red-50 disabled:opacity-50"
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

      {/* ---- Orders waiting for a slot ---- */}
      <section className="rounded-xl border border-border bg-surface p-6">
        <h2 className="flex items-center gap-2 text-lg font-medium text-text-primary">
          <Clock className="h-5 w-5" /> Waiting for a slot
        </h2>
        <p className="mt-1 text-sm text-text-secondary">Live orders with no delivery booked yet.</p>

        <div className="mt-4 space-y-2">
          {unscheduled.map((o) => (
            <div
              key={o.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-elevated px-4 py-3"
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
                onClick={() => setAssigning(o)}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
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

      {/* ---- Weekly availability ---- */}
      <section className="rounded-xl border border-border bg-surface p-6">
        <h2 className="flex items-center gap-2 text-lg font-medium text-text-primary">
          <CalendarDays className="h-5 w-5" /> Weekly delivery windows
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          When deliveries are possible. Slots are generated inside these — a 10:00–13:00 window with 60-minute slots
          gives 10:00, 11:00 and 12:00.
        </p>

        <div className="mt-4 space-y-2">
          {windows.map((w) => (
            <div
              key={w.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-elevated px-4 py-3"
            >
              <div>
                <p className="font-medium text-text-primary">
                  {DAYS[w.dayOfWeek]} · {fmtMinute(w.startMinute)}–{fmtMinute(w.endMinute)}
                </p>
                <p className="text-xs text-text-muted">
                  {w.slotMinutes}-minute slots · {w.capacity} {w.capacity === 1 ? 'delivery' : 'deliveries'} per slot ·{' '}
                  {Math.floor((w.endMinute - w.startMinute) / w.slotMinutes) * w.capacity} per week
                  {w.notes ? ` · ${w.notes}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-1 text-xs ${w.active ? 'bg-green-50 text-green-700' : 'bg-surface-elevated text-text-muted'}`}
                >
                  {w.active ? 'active' : 'paused'}
                </span>
                <button
                  disabled={!!busy}
                  onClick={() =>
                    act(`w-${w.id}`, () =>
                      adminSaveDeliveryWindow(
                        token,
                        {
                          dayOfWeek: w.dayOfWeek,
                          startMinute: w.startMinute,
                          endMinute: w.endMinute,
                          slotMinutes: w.slotMinutes,
                          capacity: w.capacity,
                          active: !w.active,
                        },
                        w.id
                      )
                    )
                  }
                  className="rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface-elevated"
                >
                  {w.active ? 'Pause' : 'Resume'}
                </button>
                <button
                  disabled={!!busy}
                  onClick={() => {
                    if (!confirm('Remove this window? Deliveries already booked keep their times.')) return;
                    act(`w-${w.id}`, () => adminDeleteDeliveryWindow(token, w.id));
                  }}
                  className="rounded border border-border p-1.5 text-danger hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
          {!windows.length && (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">
              No windows yet — nothing can be booked until you add one.
            </p>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-4">
          <div>
            <label className="block text-xs text-text-muted">Day</label>
            <select
              value={newWindow.day}
              onChange={(e) => setNewWindow({ ...newWindow, day: Number(e.target.value) })}
              className="mt-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
            >
              {DAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-text-muted">From</label>
            <input
              type="time"
              value={newWindow.from}
              onChange={(e) => setNewWindow({ ...newWindow, from: e.target.value })}
              className="mt-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted">To</label>
            <input
              type="time"
              value={newWindow.to}
              onChange={(e) => setNewWindow({ ...newWindow, to: e.target.value })}
              className="mt-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted">Slot (min)</label>
            <input
              type="number"
              min={15}
              step={15}
              value={newWindow.slotMinutes}
              onChange={(e) => setNewWindow({ ...newWindow, slotMinutes: Number(e.target.value) })}
              className="mt-1 w-24 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted">Per slot</label>
            <input
              type="number"
              min={1}
              value={newWindow.capacity}
              onChange={(e) => setNewWindow({ ...newWindow, capacity: Number(e.target.value) })}
              className="mt-1 w-20 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
            />
          </div>
          <button
            disabled={!!busy}
            onClick={() => {
              const [fh, fm] = newWindow.from.split(':').map(Number);
              const [th, tm] = newWindow.to.split(':').map(Number);
              act('add-window', () =>
                adminSaveDeliveryWindow(token, {
                  dayOfWeek: newWindow.day,
                  startMinute: fh * 60 + fm,
                  endMinute: th * 60 + tm,
                  slotMinutes: newWindow.slotMinutes,
                  capacity: newWindow.capacity,
                  active: true,
                })
              );
            }}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            {busy === 'add-window' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
            window
          </button>
        </div>
      </section>

      {/* ---- Blocked dates ---- */}
      <section className="rounded-xl border border-border bg-surface p-6">
        <h2 className="flex items-center gap-2 text-lg font-medium text-text-primary">
          <CalendarOff className="h-5 w-5" /> Blocked dates
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          Holidays and days off. Nothing can be booked on these. Deliveries already booked are not moved automatically.
        </p>

        <div className="mt-4 space-y-2">
          {blackouts.map((b) => (
            <div
              key={b.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-elevated px-4 py-2.5"
            >
              <p className="text-sm text-text-primary">
                {new Date(b.date).toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short' })}
                {b.startMinute != null && b.endMinute != null
                  ? ` · ${fmtMinute(b.startMinute)}–${fmtMinute(b.endMinute)}`
                  : ' · all day'}
                <span className="ml-2 text-text-muted">{b.reason}</span>
              </p>
              <button
                onClick={() => act(`b-${b.id}`, () => adminDeleteDeliveryBlackout(token, b.id))}
                className="rounded border border-border p-1.5 text-danger hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {!blackouts.length && <p className="text-sm text-text-muted">No blocked dates coming up.</p>}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-4">
          <div>
            <label className="block text-xs text-text-muted">Date</label>
            <input
              type="date"
              value={newBlackout.date}
              onChange={(e) => setNewBlackout({ ...newBlackout, date: e.target.value })}
              className="mt-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-text-muted">Reason</label>
            <input
              value={newBlackout.reason}
              onChange={(e) => setNewBlackout({ ...newBlackout, reason: e.target.value })}
              placeholder="Public holiday"
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
            />
          </div>
          <button
            disabled={!newBlackout.date || !newBlackout.reason || !!busy}
            onClick={() =>
              act('add-blackout', async () => {
                await adminCreateDeliveryBlackout(token, {
                  date: `${newBlackout.date}T00:00:00+08:00`,
                  reason: newBlackout.reason,
                });
                setNewBlackout({ date: '', reason: '' });
              })
            }
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            Block date
          </button>
        </div>
      </section>

      {/* ---- Slot picker ---- */}
      {assigning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAssigning(null)}>
          <div
            className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-surface p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center justify-between">
              <h3 className="font-medium text-text-primary">Book a delivery slot</h3>
              <button onClick={() => setAssigning(null)} className="text-text-muted hover:text-text-primary">
                ✕
              </button>
            </div>
            <p className="mb-4 text-sm text-text-secondary">
              {assigning.customerName} · {assigning.orderNumber} · {assigning.city}, {assigning.state}
            </p>

            <div className="space-y-1.5">
              {slots
                .filter((s) => s.open)
                .slice(0, 40)
                .map((s) => (
                  <button
                    key={s.startsAt}
                    disabled={!!busy}
                    onClick={() =>
                      act('assign', async () => {
                        await adminScheduleDelivery(token, { orderId: assigning.id, scheduledFor: s.startsAt });
                        setAssigning(null);
                      })
                    }
                    className="flex w-full items-center justify-between rounded-lg border border-border px-4 py-2.5 text-left text-sm hover:bg-surface-elevated disabled:opacity-50"
                  >
                    <span className="text-text-primary">{s.label}</span>
                    <span className="text-xs text-text-muted">{s.capacity - s.booked} free</span>
                  </button>
                ))}
              {!slots.filter((s) => s.open).length && (
                <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">
                  No open slots in the next two weeks. Add a delivery window or free one up.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
