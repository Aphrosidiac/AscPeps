'use client';

import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminCreateFunding, adminCreatePayout } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { PartnerBalance } from '@/types';

/**
 * One dialog for the three ways money moves between a partner and the company.
 * They share a shape (partner, amount, date, note), and keeping them together
 * is what makes the difference between them legible at the moment of entry —
 * which is the only moment anyone actually remembers it.
 */
const MOVEMENTS = [
  {
    key: 'CONTRIBUTION',
    label: 'Contribution',
    blurb: 'Money in that is never paid back. Becomes capital and never appears in what they are owed.',
  },
  {
    key: 'ADVANCE',
    label: 'Advance',
    blurb: 'Money in that the company owes back. Stays outstanding until repaid, whole or in parts.',
  },
  {
    key: 'PAYOUT',
    label: 'Profit payout',
    blurb: 'Paying out profit they have already earned. Reduces what they are owed.',
  },
] as const;

type MovementKey = (typeof MOVEMENTS)[number]['key'];

const todayIso = () => new Date().toISOString().slice(0, 10);

export function RecordMoneyDialog({
  partners, onClose, onSaved, defaultPartnerId,
}: {
  partners: PartnerBalance[];
  onClose: () => void;
  onSaved: () => void;
  defaultPartnerId?: string;
}) {
  const { token } = useAuth();
  const active = partners.filter((p) => p.active);

  const [kind, setKind] = useState<MovementKey>('CONTRIBUTION');
  const [partnerId, setPartnerId] = useState(defaultPartnerId ?? active[0]?.partnerId ?? '');
  const [amount, setAmount] = useState('');
  const [occurredAt, setOccurredAt] = useState(todayIso());
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [closing, setClosing] = useState(false);

  // Play the exit animation before unmounting. Without this the dialog would
  // vanish instantly on close, which reads as a glitch next to a panel that
  // animated its way in.
  const EXIT_MS = 150;
  const dismiss = useCallback((after: () => void) => {
    setClosing(true);
    setTimeout(after, EXIT_MS);
  }, []);
  const requestClose = useCallback(() => dismiss(onClose), [dismiss, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    // The page behind must not scroll while a modal is open — closing it and
    // finding yourself somewhere else in the list is disorienting.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [requestClose]);

  const cents = Math.round(Number(amount) * 100);
  const valid = partnerId && Number.isFinite(cents) && cents > 0 &&
    (kind === 'PAYOUT' || description.trim() !== '');

  const submit = async () => {
    if (!token || !valid) return;
    setError('');
    setSaving(true);
    try {
      if (kind === 'PAYOUT') {
        await adminCreatePayout(token, {
          partnerId, amount: cents, occurredAt, note: description.trim() || null,
        });
      } else {
        await adminCreateFunding(token, {
          partnerId, type: kind, amount: cents, occurredAt, description: description.trim(),
        });
      }
      dismiss(onSaved);
    } catch (err) {
      const message = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      setError(message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={cn('dialog-backdrop fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4', closing && 'is-closing')}
      onClick={requestClose}
      role="dialog"
      aria-modal="true"
      aria-label="Record money"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn('dialog-panel bg-surface rounded-xl border border-border w-full max-w-lg max-h-[90vh] overflow-y-auto', closing && 'is-closing')}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-surface">
          <h2 className="font-display font-semibold">Record money</h2>
          <button onClick={requestClose} aria-label="Close" className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div className="space-y-2">
            {MOVEMENTS.map((m, i) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setKind(m.key)}
                style={{ animationDelay: `${60 + i * 45}ms` }}
                className={cn(
                  'row-rise w-full text-left px-4 py-3 rounded-lg border transition-colors cursor-pointer',
                  kind === m.key ? 'border-primary bg-primary/5' : 'border-border hover:bg-surface-elevated'
                )}
              >
                <span className="text-sm font-medium block">{m.label}</span>
                <span className="text-xs text-text-muted block mt-0.5">{m.blurb}</span>
              </button>
            ))}
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="rm-partner" className="text-xs font-medium text-text-muted uppercase tracking-wider block mb-1.5">Partner</label>
              <select
                id="rm-partner"
                value={partnerId}
                onChange={(e) => setPartnerId(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface"
              >
                {active.map((p) => <option key={p.partnerId} value={p.partnerId}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="rm-date" className="text-xs font-medium text-text-muted uppercase tracking-wider block mb-1.5">Date</label>
              <input
                id="rm-date"
                type="date"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface"
              />
            </div>
          </div>

          <div>
            <label htmlFor="rm-amount" className="text-xs font-medium text-text-muted uppercase tracking-wider block mb-1.5">Amount</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-muted">RM</span>
              <input
                id="rm-amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full pl-10 pr-3 py-2 border border-border rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
          </div>

          <div>
            <label htmlFor="rm-desc" className="text-xs font-medium text-text-muted uppercase tracking-wider block mb-1.5">
              {kind === 'PAYOUT' ? 'Note (optional)' : 'What for'}
            </label>
            <input
              id="rm-desc"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={kind === 'PAYOUT' ? 'e.g. July payout' : 'e.g. Startup capital'}
              maxLength={300}
              className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border sticky bottom-0 bg-surface">
          <button onClick={requestClose} className="px-3 py-2 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors cursor-pointer">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!valid || saving}
            className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {saving ? 'Saving…' : 'Record'}
          </button>
        </div>
      </div>
    </div>
  );
}
