'use client';

/**
 * Recording money against Ascend's bank.
 *
 * Most of the bank records itself — paid orders, payouts, repayments, company
 * expenses. These are for what it cannot see: the opening balance, money a
 * partner puts in, a supplier paid, a bill paid, and the odd bank charge or
 * transfer. Each choice writes to the record it really is (a funding row, an
 * expense, a bank entry) so the ledger and the books never hold the same money
 * twice.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import {
  adminCreateBankCheck, adminCreateBankEntry, adminCreateExpense, adminCreateFunding, adminGetExpenses, adminGetMoneyOverview,
} from '@/lib/api';
import { cn, formatPrice } from '@/lib/utils';
import { Dialog } from '@/components/admin/Dialog';
import { Affixed, Field, SelectInput, TextInput } from '@/components/admin/ui';
import { Button } from '@/components/ui/Button';
import type { PartnerBalance } from '@/types';
import { apiError, mytDayOrNow, mytDayStart, parseRinggit, signedPrice, todayIso } from './money-ui';

/* ------------------------------------------------------------ opening */

/** Inline, in the bank card — the first thing the bank needs, not a modal over it. */
export function OpeningBalanceForm({ onSaved }: { onSaved: () => void }) {
  const { token } = useAuth();
  const [day, setDay] = useState('2026-10-21');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cents = parseRinggit(amount);

  const save = async () => {
    if (!token || cents === null || cents < 0) return;
    setBusy(true);
    setError(null);
    try {
      await adminCreateBankEntry(token, { kind: 'OPENING', occurredAt: mytDayStart(day), amount: cents, description: 'Opening balance' });
      onSaved();
    } catch (err) {
      setError(apiError(err, 'Could not save the opening balance.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="text-[14px] text-text-primary font-medium">Start the bank</p>
      <p className="text-[13px] text-text-secondary mb-3">
        What was in the account at the start of the day it began. Every order paid from that day lands here on its own.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Day" htmlFor="opening-day" className="w-[170px]">
          <TextInput id="opening-day" type="date" value={day} max={todayIso()} onChange={(e) => setDay(e.target.value)} />
        </Field>
        <Field label="Balance that morning" htmlFor="opening-amount" className="w-[200px]">
          <Affixed prefix="RM">
            <input id="opening-amount" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Affixed>
        </Field>
        <Button size="sm" className="h-[38px]" disabled={busy || cents === null || cents < 0} onClick={save}>
          {busy ? 'Saving…' : 'Start tracking'}
        </Button>
      </div>
      {error && <p className="mt-2 text-[13px] text-danger">{error}</p>}
    </div>
  );
}

/* ------------------------------------------------------------ in / out */

type InKind = 'capital' | 'other_in';
type OutKind = 'supplier' | 'expense' | 'other_out';

const IN_KINDS: { key: InKind; label: string; blurb: string }[] = [
  { key: 'capital', label: 'Partner puts money in', blurb: 'Capital into Ascend — say whether it is ever paid back.' },
  { key: 'other_in', label: 'Something else', blurb: 'Crypto cashed in, interest, a transfer back. Customer payments are added for you.' },
];
const OUT_KINDS: { key: OutKind; label: string; blurb: string }[] = [
  { key: 'supplier', label: 'Paid a supplier', blurb: 'Stock. Becomes a cost as the goods sell, not today.' },
  { key: 'expense', label: 'Paid a bill', blurb: 'Ads, software, courier top-up, packaging — a cost today.' },
  { key: 'other_out', label: 'Something else', blurb: 'Bank charges, a transfer out, a correction. Payouts are recorded on Profit sharing.' },
];

export function BankEntryDialog({
  direction,
  partners: given,
  onClose,
  onSaved,
}: {
  direction: 'in' | 'out';
  partners?: PartnerBalance[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { token } = useAuth();
  const [kind, setKind] = useState<InKind | OutKind>(direction === 'in' ? 'capital' : 'supplier');
  const [partners, setPartners] = useState<PartnerBalance[]>(given ?? []);
  const [categories, setCategories] = useState<string[]>([]);
  const [partnerId, setPartnerId] = useState('');
  const [fundingType, setFundingType] = useState<'CONTRIBUTION' | 'ADVANCE'>('CONTRIBUTION');
  const [day, setDay] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    if (!given && direction === 'in') adminGetMoneyOverview(token).then((d) => setPartners(d.partners)).catch(() => {});
    if (direction === 'out') adminGetExpenses(token).then((d) => setCategories(d.categories)).catch(() => {});
  }, [token, given, direction]);

  const active = partners.filter((p) => p.active);
  // Until someone picks, the first active partner — derived, not stored, so it
  // follows the list arriving after the dialog opens.
  const chosenPartner = partnerId || active[0]?.partnerId || '';

  const cents = parseRinggit(amount);
  const valid =
    cents !== null && cents > 0 && description.trim() !== '' &&
    (kind !== 'capital' || chosenPartner !== '') &&
    (kind !== 'expense' || category.trim() !== '');

  const save = async (close: () => void) => {
    if (!token || !valid || cents === null) return;
    setBusy(true);
    setError(null);
    const occurredAt = mytDayOrNow(day);
    try {
      if (kind === 'capital') {
        await adminCreateFunding(token, { partnerId: chosenPartner, type: fundingType, amount: cents, occurredAt, description: description.trim() });
      } else if (kind === 'supplier' || kind === 'expense') {
        await adminCreateExpense(token, {
          occurredAt,
          amount: cents,
          description: description.trim(),
          category: kind === 'supplier' ? 'Stock' : category.trim(),
          kind: kind === 'supplier' ? 'INVENTORY' : 'OPERATING',
          paidByPartnerId: null,
        });
      } else {
        await adminCreateBankEntry(token, {
          kind: direction === 'in' ? 'MONEY_IN' : 'MONEY_OUT',
          occurredAt,
          amount: cents,
          description: description.trim(),
        });
      }
      onSaved();
      close();
    } catch (err) {
      setError(apiError(err, 'Could not save.'));
    } finally {
      setBusy(false);
    }
  };

  const kinds = direction === 'in' ? IN_KINDS : OUT_KINDS;

  return (
    <Dialog
      title={direction === 'in' ? 'Money into the bank' : 'Money out of the bank'}
      onClose={onClose}
      size="md"
      footer={(close) => (
        <>
          <Button type="button" variant="ghost" size="sm" onClick={close} disabled={busy}>Cancel</Button>
          <Button type="button" size="sm" disabled={busy || !valid} onClick={() => save(close)}>
            {busy ? 'Saving…' : 'Record'}
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        <div role="radiogroup" aria-label="What was it" className="grid gap-2">
          {kinds.map((k) => (
            <button
              key={k.key}
              type="button"
              role="radio"
              aria-checked={kind === k.key}
              onClick={() => setKind(k.key)}
              className={cn(
                'rounded-lg border px-3 py-2.5 text-left transition-colors cursor-pointer',
                kind === k.key ? 'border-primary bg-primary/5' : 'border-border hover:bg-surface-elevated'
              )}
            >
              <span className="block text-[14px] font-medium">{k.label}</span>
              <span className="block text-[13px] text-text-secondary">{k.blurb}</span>
            </button>
          ))}
        </div>

        {kind === 'capital' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Who" htmlFor="bank-partner">
              <SelectInput id="bank-partner" value={chosenPartner} onChange={(e) => setPartnerId(e.target.value)}>
                {active.map((p) => <option key={p.partnerId} value={p.partnerId}>{p.name}</option>)}
              </SelectInput>
            </Field>
            <Field label="Paid back?" htmlFor="bank-funding" help={fundingType === 'ADVANCE' ? 'Ascend owes it back — repay it in parts any time.' : 'Their investment in Ascend. Never owed back.'}>
              <SelectInput id="bank-funding" value={fundingType} onChange={(e) => setFundingType(e.target.value as 'CONTRIBUTION' | 'ADVANCE')}>
                <option value="CONTRIBUTION">No — an investment</option>
                <option value="ADVANCE">Yes — a loan to Ascend</option>
              </SelectInput>
            </Field>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount" htmlFor="bank-amount">
            <Affixed prefix="RM">
              <input id="bank-amount" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </Affixed>
          </Field>
          <Field label="Day" htmlFor="bank-day">
            <TextInput id="bank-day" type="date" value={day} max={todayIso()} onChange={(e) => setDay(e.target.value)} />
          </Field>
        </div>

        {kind === 'expense' && (
          <Field label="Category" htmlFor="bank-category" help="Reuse one already in use so totals stay together.">
            <TextInput id="bank-category" list="bank-categories" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Ads" />
            <datalist id="bank-categories">
              {categories.filter((c) => c !== 'Stock').map((c) => <option key={c} value={c} />)}
            </datalist>
          </Field>
        )}

        <Field label={kind === 'supplier' ? 'Supplier and what for' : 'What for'} htmlFor="bank-description">
          <TextInput
            id="bank-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={300}
            placeholder={
              kind === 'supplier' ? 'e.g. YL,C — 20× Retatrutide 30mg'
                : kind === 'capital' ? 'e.g. Capital for November stock'
                  : kind === 'expense' ? 'e.g. Meta ads, October'
                    : direction === 'in' ? 'e.g. BTC cashed in' : 'e.g. Bank charges'
            }
          />
        </Field>

        {error && <p className="text-[13px] text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------ statement check */

export function CheckBalanceDialog({ bookBalance, onClose, onSaved }: { bookBalance: number; onClose: () => void; onSaved: () => void }) {
  const { token } = useAuth();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cents = parseRinggit(amount);
  const difference = cents === null ? null : cents - bookBalance;

  const save = async (close: () => void) => {
    if (!token || cents === null) return;
    setBusy(true);
    setError(null);
    try {
      await adminCreateBankCheck(token, { statementBalance: cents, note: note.trim() || null });
      onSaved();
      close();
    } catch (err) {
      setError(apiError(err, 'Could not save.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Check against the bank"
      description="Open the bank app and type the balance it shows right now."
      onClose={onClose}
      footer={(close) => (
        <>
          <Button type="button" variant="ghost" size="sm" onClick={close} disabled={busy}>Cancel</Button>
          <Button type="button" size="sm" disabled={busy || cents === null} onClick={() => save(close)}>
            {busy ? 'Saving…' : 'Save check'}
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="flex items-baseline justify-between rounded-lg bg-surface-elevated px-4 py-3">
          <span className="text-[14px] text-text-secondary">Ascend Money says</span>
          <span className="font-display text-[18px] font-bold tabular-nums">{signedPrice(bookBalance)}</span>
        </div>
        <Field label="The bank says" htmlFor="check-amount">
          <Affixed prefix="RM">
            <input id="check-amount" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </Affixed>
        </Field>
        {difference !== null && (
          <p className={cn('text-[14px]', difference === 0 ? 'text-success' : 'text-warning')}>
            {difference === 0
              ? 'Matches to the sen.'
              : difference > 0
                ? `The bank has ${formatPrice(difference)} more — money came in that isn’t recorded (or a Billplz settlement is still on its way).`
                : `The bank has ${formatPrice(-difference)} less — something went out that isn’t recorded, or a settlement hasn’t landed yet.`}
          </p>
        )}
        <Field label="Note (optional)" htmlFor="check-note">
          <TextInput id="check-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. Billplz for the 21st not in yet" />
        </Field>
        {error && <p className="text-[13px] text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}
