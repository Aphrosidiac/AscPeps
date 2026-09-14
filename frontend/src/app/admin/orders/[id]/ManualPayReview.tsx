'use client';

import { useEffect, useState } from 'react';
import { ProofReview } from 'manualpaygate/ui';
import type { CheckoutSession, PaymentProof } from 'manualpaygate/core';
import 'manualpaygate/styles.css';
import { useAuth } from '@/hooks/useAuth';
import { adminApprovePaySession, adminFetchPayProofUrl, adminGetPaySession, adminRejectPaySession, type ManualPaySessionWire } from '@/lib/api';

/**
 * The review panel for a hosted-checkout order: the customer's screenshot
 * next to the facts to check it against, and Confirm / Reject. Approving
 * runs the gateway's onPaid hook on the server, which is the same guarded
 * UNPAID → PAID path every gateway uses — so the Payment Status select above
 * flips to Paid by itself once the parent reloads.
 */
export function ManualPayReview({ sessionId, onDecided }: { sessionId: string; onDecided: () => void }) {
  const { token } = useAuth();
  const [session, setSession] = useState<CheckoutSession | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  // Same shape as OrderDetail's loader: a plain function, promise-chained,
  // so the effect below contains no direct setState for the compiler lint.
  const load = () => {
    if (!token) return Promise.resolve();
    return adminGetPaySession(token, sessionId)
      .then(async (wire) => {
        setSession(revive(wire));
        // One object URL per proof, fetched with the bearer token. Revoked on
        // the next load and on unmount.
        const entries = await Promise.all(wire.proofs.map(async (p) => [p.id, await adminFetchPayProofUrl(token, p.id).catch(() => '')] as const));
        setUrls((prev) => {
          Object.values(prev).forEach((u) => u && URL.revokeObjectURL(u));
          return Object.fromEntries(entries);
        });
      })
      .catch((err) => setError(apiErrorMessage(err) ?? 'Could not load the payment session.'));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps -- load closes over token/sessionId, which are the deps
  useEffect(() => { load(); }, [token, sessionId]);
  useEffect(() => () => Object.values(urls).forEach((u) => u && URL.revokeObjectURL(u)), [urls]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!session) return <p className="text-sm text-text-muted">Loading payment session…</p>;

  return (
    <div className="mpg-admin">
      <ProofReview
        session={session}
        proofUrl={(p: PaymentProof) => urls[p.id] ?? ''}
        onApprove={async () => {
          if (!token) return;
          await adminApprovePaySession(token, session.id).catch((err) => { throw new Error(apiErrorMessage(err) ?? 'Could not confirm'); });
          await load();
          onDecided();
        }}
        onReject={async (reason) => {
          if (!token) return;
          await adminRejectPaySession(token, session.id, reason).catch((err) => { throw new Error(apiErrorMessage(err) ?? 'Could not reject'); });
          await load();
          onDecided();
        }}
      />
      <p className="text-xs text-text-muted mt-3">
        Session {session.id} · expires {session.expiresAt.toLocaleString()} ·{' '}
        <a href={`/pay/${session.id}`} target="_blank" rel="noreferrer" className="text-primary-light hover:underline">
          open the customer&apos;s page ↗
        </a>
      </p>
    </div>
  );
}

function apiErrorMessage(err: unknown): string | null {
  if (err && typeof err === 'object' && 'response' in err) {
    const data = (err as { response?: { data?: { message?: string; error?: string } } }).response?.data;
    return data?.message ?? data?.error ?? null;
  }
  return null;
}

function revive(w: ManualPaySessionWire): CheckoutSession {
  return {
    ...w,
    status: w.status as CheckoutSession['status'],
    expiresAt: new Date(w.expiresAt),
    createdAt: new Date(w.createdAt),
    updatedAt: new Date(w.updatedAt),
    paidAt: w.paidAt ? new Date(w.paidAt) : undefined,
    cancelledAt: w.cancelledAt ? new Date(w.cancelledAt) : undefined,
    proofs: w.proofs.map((p) => ({
      ...p,
      status: p.status as PaymentProof['status'],
      submittedAt: new Date(p.submittedAt),
      reviewedAt: p.reviewedAt ? new Date(p.reviewedAt) : undefined,
    })),
  };
}
