'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { adminCreateSplitRule } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Dialog } from '@/components/admin/Dialog';
import { Affixed, Field, TextInput } from '@/components/admin/ui';
import { Button } from '@/components/ui/Button';
import type { PartnerKind, SplitRule } from '@/types';
import { apiError, mytDayStart, SplitBar, todayIso } from './money-ui';

/**
 * A new version of the default split, from a day. It never touches an order
 * that already has a split — only paid orders from that day on that have none.
 * Anyone can change it (Fakhrul, 2026-10-21); every version says who did.
 */
export function SplitRuleDialog({
  current,
  partners,
  onClose,
  onSaved,
}: {
  current: SplitRule | null;
  partners: { partnerId: string; name: string; kind: PartnerKind }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { token } = useAuth();
  const startPct = (id: string) => {
    const s = current?.shares.find((x) => x.partnerId === id);
    return s ? String(s.shareBps / 100) : '0';
  };
  const [pcts, setPcts] = useState<Record<string, string>>(() => Object.fromEntries(partners.map((p) => [p.partnerId, startPct(p.partnerId)])));
  const [day, setDay] = useState(todayIso());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bps = (id: string) => {
    const n = Number(pcts[id]);
    return Number.isFinite(n) ? Math.round(n * 100) : NaN;
  };
  const total = partners.reduce((s, p) => s + (bps(p.partnerId) || 0), 0);
  const valid = partners.every((p) => !Number.isNaN(bps(p.partnerId)) && bps(p.partnerId) >= 0) && total === 10_000;
  const preview = partners
    .map((p) => ({ name: p.name, kind: p.kind, shareBps: bps(p.partnerId) || 0 }))
    .filter((s) => s.shareBps > 0);

  const save = async (close: () => void) => {
    if (!token || !valid) return;
    setBusy(true);
    setError(null);
    try {
      await adminCreateSplitRule(token, {
        effectiveFrom: mytDayStart(day),
        note: note.trim() || null,
        shares: partners.map((p) => ({ partnerId: p.partnerId, shareBps: bps(p.partnerId) })),
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
          <Button type="button" size="sm" disabled={busy || !valid} onClick={() => save(close)}>
            {busy ? 'Saving…' : 'Save split'}
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="space-y-2.5">
          {partners.map((p) => (
            <div key={p.partnerId} className="flex items-center gap-3">
              <label htmlFor={`pct-${p.partnerId}`} className="flex-1 text-[15px]">
                {p.name}
                {p.kind === 'COMPANY' && <span className="ml-1.5 text-[12px] text-text-secondary">stays in the bank</span>}
              </label>
              <Affixed suffix="%" className="w-[120px]">
                <input
                  id={`pct-${p.partnerId}`}
                  inputMode="decimal"
                  value={pcts[p.partnerId]}
                  onChange={(e) => setPcts((prev) => ({ ...prev, [p.partnerId]: e.target.value }))}
                  className="text-right"
                />
              </Affixed>
            </div>
          ))}
        </div>
        <SplitBar shares={preview} />
        <p className={cn('text-[13px]', total === 10_000 ? 'text-text-secondary' : 'text-warning')}>
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
      </div>
    </Dialog>
  );
}
