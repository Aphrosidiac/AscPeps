'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Dialog } from '@/components/admin/Dialog';
import { Field, TextInput } from '@/components/admin/ui';
import { formatPrice, cn } from '@/lib/utils';
import {
  DETAIL_LABEL,
  STATE_LABEL,
  STATUS_LABEL,
  adminDecideAffiliateChange,
  adminMarkAffiliatePayoutPaid,
  apiError,
  type ChangeRequest,
  type DetailField,
  type AffiliateStatus,
  type OrderState,
  type PayoutStatus,
} from '@/lib/affiliate-api';

/** Shared bits of Admin → Affiliates (list, payouts, one affiliate). */

export const signed = (sen: number) => (sen < 0 ? `−${formatPrice(-sen)}` : formatPrice(sen));

export function myt(iso: string, withTime = false) {
  return new Date(iso).toLocaleString('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    day: 'numeric',
    month: 'short',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : { year: 'numeric' }),
  });
}

const STATUS_TONE: Record<AffiliateStatus, string> = {
  APPLIED: 'bg-amber-100 text-amber-800',
  ACTIVE: 'bg-green-100 text-green-800',
  PAUSED: 'bg-surface-elevated text-text-secondary',
  REJECTED: 'bg-red-100 text-red-800',
};
export function StatusBadge({ status }: { status: AffiliateStatus }) {
  return <Badge className={STATUS_TONE[status]}>{status === 'APPLIED' ? 'To approve' : STATUS_LABEL[status]}</Badge>;
}

const STATE_TONE: Record<OrderState, string> = {
  AWAITING_PAYMENT: 'bg-amber-100 text-amber-800',
  EARNED: 'bg-green-100 text-green-800',
  PART_REFUNDED: 'bg-blue-100 text-blue-800',
  REFUNDED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-surface-elevated text-text-secondary',
  NOT_PAID: 'bg-surface-elevated text-text-secondary',
};
export function StateBadge({ state }: { state: OrderState }) {
  return <Badge className={STATE_TONE[state]}>{STATE_LABEL[state]}</Badge>;
}

const PAYOUT_TONE: Record<PayoutStatus, string> = {
  REQUESTED: 'bg-amber-100 text-amber-800',
  PAID: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-surface-elevated text-text-secondary',
};
export function PayoutBadge({ status, ready }: { status: PayoutStatus; ready?: boolean }) {
  const label = status === 'REQUESTED' ? (ready ? 'Ready to pay' : 'In hold') : status === 'PAID' ? 'Paid' : 'Cancelled';
  return <Badge className={cn(status === 'REQUESTED' && ready ? 'bg-primary text-white' : PAYOUT_TONE[status])}>{label}</Badge>;
}

/**
 * "We transferred it." Records the payout against the affiliate's balance and
 * as money out of Ascend's bank; pays the smaller of the ask and today's
 * balance (a refund in the hold comes off).
 */
export function MarkPaidDialog({
  token,
  payout,
  onDone,
  onClose,
}: {
  token: string;
  payout: { id: string; name: string; code: string; amount: number; payableNow: number | null; bankName: string; bankAccountName: string; bankAccountNumber: string };
  onDone: (note: string | null) => void;
  onClose: () => void;
}) {
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pay = payout.payableNow ?? payout.amount;
  return (
    <Dialog
      title={`Mark ${payout.name}'s payout paid`}
      description="Only after the transfer has gone out from Ascend's bank."
      onClose={onClose}
      footer={(close) => (
        <>
          <Button type="button" variant="ghost" size="sm" onClick={close} disabled={busy}>Cancel</Button>
          <Button
            type="button"
            size="sm"
            data-autofocus
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                const r = await adminMarkAffiliatePayoutPaid(token, payout.id, { reference: reference.trim() || null, expectedAmount: pay });
                onDone(r.status === 'CANCELLED' ? r.note : r.note ? r.note : null);
                close();
              } catch (err) {
                setError(apiError(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Saving…' : `Mark ${formatPrice(pay)} paid`}
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="rounded-lg bg-surface-elevated px-4 py-3 text-sm">
          <p className="font-medium text-text-primary">{payout.bankName} · {payout.bankAccountNumber}</p>
          <p className="text-text-secondary">{payout.bankAccountName} · code {payout.code}</p>
          <p className="mt-2 text-text-primary">
            Transfer <span className="font-semibold">{formatPrice(pay)}</span>
            {pay < payout.amount ? <span className="text-text-secondary"> (asked {formatPrice(payout.amount)}; refunds since came off)</span> : null}
          </p>
        </div>
        <Field label="Transfer reference" help="Optional — shown to the affiliate.">
          <TextInput value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. M2U 8812 3345" />
        </Field>
        {error ? <p className="text-[13px] text-danger">{error}</p> : null}
      </div>
    </Dialog>
  );
}

/** A change request's before → after, one line per field. Full account numbers: the team checks them. */
export function ChangeDiff({ change }: { change: Pick<ChangeRequest, 'changes' | 'previous'> }) {
  return (
    <dl className="grid gap-1.5 text-[13px]">
      {(Object.keys(change.changes) as DetailField[]).map((k) => (
        <div key={k} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
          <dt className="text-text-secondary">{DETAIL_LABEL[k]}</dt>
          <dd className="min-w-0 break-words">
            <span className="text-text-muted line-through">{change.previous[k] ?? 'none'}</span>
            <span className="mx-1.5 text-text-muted">→</span>
            <span className="font-medium text-text-primary">{change.changes[k] ?? 'none'}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Approve or reject a waiting change. Approving applies it (and moves a payout
 * still waiting to the new account); rejecting needs a reason they will see.
 */
export function DecideChange({ token, change, name, onDone }: { token: string; change: ChangeRequest; name: string; onDone: (note: string) => void }) {
  const [mode, setMode] = useState<'approve' | 'reject' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bank = (['bankName', 'bankAccountName', 'bankAccountNumber'] as DetailField[]).some((k) => k in change.changes);

  const decide = async (body: { decision: 'approve' } | { decision: 'reject'; reason: string }) => {
    setBusy(true);
    setError(null);
    try {
      await adminDecideAffiliateChange(token, change.id, body);
      onDone(body.decision === 'approve' ? `${name}'s change is approved.` : `${name}'s change was rejected; they see why.`);
      return true;
    } catch (err) {
      setError(apiError(err, 'Could not save that.'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={() => (setMode('reject'), setError(null))}>Reject</Button>
        <Button size="sm" onClick={() => (setMode('approve'), setError(null))}>Approve</Button>
      </div>
      {mode === 'approve' ? (
        <ConfirmDialog
          title={`Approve ${name}'s change?`}
          body={bank ? 'Their bank details change now. A payout still waiting will go to the new account.' : 'Their details change now.'}
          confirmLabel="Approve"
          busy={busy}
          error={error}
          onConfirm={() => decide({ decision: 'approve' }).then((ok) => (ok ? undefined : false))}
          onClose={() => setMode(null)}
        />
      ) : null}
      {mode === 'reject' ? (
        <Dialog
          title={`Reject ${name}'s change?`}
          description="Nothing changes. They see your reason on their Settings page."
          onClose={() => setMode(null)}
          footer={(close) => (
            <>
              <Button type="button" variant="ghost" size="sm" onClick={close} disabled={busy}>Keep it</Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={busy || reason.trim().length < 2}
                onClick={async () => {
                  if (await decide({ decision: 'reject', reason: reason.trim() })) close();
                }}
              >
                Reject
              </Button>
            </>
          )}
        >
          <Field label="Why" help="Shown to the affiliate.">
            <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The account name doesn't match yours" data-autofocus />
          </Field>
          {error ? <p className="mt-3 text-[13px] text-danger">{error}</p> : null}
        </Dialog>
      ) : null}
    </>
  );
}
