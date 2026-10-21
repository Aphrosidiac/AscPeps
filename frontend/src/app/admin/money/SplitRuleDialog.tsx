'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminCreateSplitRule } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Dialog } from '@/components/admin/Dialog';
import { Affixed, Field, TextInput } from '@/components/admin/ui';
import { Button } from '@/components/ui/Button';
import type { PartnerKind, SplitRule } from '@/types';
import { apiError, mytDayStart, SplitBar, todayIso } from './money-ui';

type Pickable = { partnerId: string; name: string; kind: PartnerKind };

/**
 * A new version of the default split, from a day. It never touches an order
 * that already has a split — only paid orders from that day on that have none.
 * Anyone can change it (Fakhrul, 2026-10-21); every version says who did.
 *
 * Starts from the people in the current split, not every partner at 0% — a
 * list of zeroes for stray partners buried the three rows that matter.
 */
export function SplitRuleDialog({
  current,
  partners,
  onClose,
  onSaved,
}: {
  current: SplitRule | null;
  partners: Pickable[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { token } = useAuth();
  const [rows, setRows] = useState<(Pickable & { pct: string })[]>(() => {
    const start = (current?.shares ?? [])
      .map((s) => {
        const p = partners.find((x) => x.partnerId === s.partnerId);
        return p ? { ...p, pct: String(s.shareBps / 100) } : null;
      })
      .filter(Boolean) as (Pickable & { pct: string })[];
    return start.length ? start : partners.slice(0, 1).map((p) => ({ ...p, pct: '100' }));
  });
  const [day, setDay] = useState(todayIso());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bps = (pct: string) => {
    const n = Number(pct);
    return Number.isFinite(n) && pct.trim() !== '' ? Math.round(n * 100) : NaN;
  };
  const total = rows.reduce((s, r) => s + (bps(r.pct) || 0), 0);
  const valid = rows.length > 0 && rows.every((r) => !Number.isNaN(bps(r.pct)) && bps(r.pct) >= 0) && total === 10_000;
  const preview = rows.map((r) => ({ name: r.name, kind: r.kind, shareBps: bps(r.pct) || 0 })).filter((s) => s.shareBps > 0);
  const addable = partners.filter((p) => !rows.some((r) => r.partnerId === p.partnerId));

  const save = async (close: () => void) => {
    if (!token || !valid) return;
    setBusy(true);
    setError(null);
    try {
      await adminCreateSplitRule(token, {
        effectiveFrom: mytDayStart(day),
        note: note.trim() || null,
        shares: rows.map((r) => ({ partnerId: r.partnerId, shareBps: bps(r.pct) })),
      });
      onSaved();
      close();
    } catch (err) {
      setError(apiError(err, 'Could not save the split.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Change the default split"
      description="Orders that already have a split keep it."
      onClose={onClose}
      footer={(close) => (
        <>
          <Button type="button" variant="ghost" size="sm" onClick={close} disabled={busy}>Cancel</Button>
          <Button type="submit" form="split-rule-form" size="sm" disabled={busy || !valid}>
            {busy ? 'Saving…' : 'Save split'}
          </Button>
        </>
      )}
    >
      {(close) => (
        <form id="split-rule-form" className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(close); }}>
          <div className="space-y-2.5">
            {rows.map((r, i) => (
              <div key={r.partnerId} className="flex items-center gap-3">
                <label htmlFor={`pct-${r.partnerId}`} className="flex-1 min-w-0 text-[15px]">
                  {r.name}
                  {r.kind === 'COMPANY' && <span className="ml-1.5 text-[12px] text-text-secondary">stays in the bank</span>}
                </label>
                <Affixed suffix="%" className="w-[120px]">
                  <input
                    id={`pct-${r.partnerId}`}
                    inputMode="decimal"
                    value={r.pct}
                    onChange={(e) => setRows((prev) => prev.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))}
                    className="text-right"
                    {...(i === 0 ? { 'data-autofocus': true } : {})}
                  />
                </Affixed>
                <button
                  type="button"
                  onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                  aria-label={`Take ${r.name} out of the split`}
                  className="p-1.5 rounded-md text-text-muted hover:text-danger hover:bg-danger/10 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          {addable.length > 0 && (
            <div className="flex items-center gap-2">
              <Plus className="w-4 h-4 text-text-secondary" />
              <select
                value=""
                aria-label="Add a person to the split"
                onChange={(e) => {
                  const p = addable.find((x) => x.partnerId === e.target.value);
                  if (p) setRows((prev) => [...prev, { ...p, pct: '0' }]);
                }}
                className="h-[34px] rounded-[6px] border border-border bg-surface px-2 text-[14px] text-text-secondary cursor-pointer"
              >
                <option value="">Add person…</option>
                {addable.map((p) => <option key={p.partnerId} value={p.partnerId}>{p.name}</option>)}
              </select>
            </div>
          )}

          <SplitBar shares={preview} />
          <p className={cn('text-[13px]', total === 10_000 ? 'text-text-secondary' : 'text-amber-700')}>
            {total === 10_000 ? 'Adds up to 100%.' : `Adds up to ${(total / 100).toFixed(2).replace(/\.00$/, '')}% — it has to be 100%.`}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From" htmlFor="rule-day" help="Orders paid from this day on.">
              <TextInput id="rule-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            </Field>
            <Field label="Why (optional)" htmlFor="rule-note">
              <TextInput id="rule-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. Agreed 1 Dec" />
            </Field>
          </div>
          {error && <p className="text-[13px] text-danger">{error}</p>}
        </form>
      )}
    </Dialog>
  );
}
