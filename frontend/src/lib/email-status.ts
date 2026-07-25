import type { OrderEmail } from '@/types';

// Shared between the admin Orders page (per-order Emails block) and the
// admin Emails ops page — keep labels/status text identical in both.
export const EMAIL_TYPE_LABELS: Record<OrderEmail['type'], string> = {
  ORDER_CONFIRMATION: 'Confirmation',
  PAYMENT_RECEIPT: 'Receipt',
};

export function emailStatusText(email?: OrderEmail): { text: string; className: string } {
  if (!email) return { text: 'not queued', className: 'text-text-muted' };
  if (email.status === 'SENT') return { text: 'sent ✓', className: 'text-success' };
  if (email.status === 'FAILED') return { text: `failed (${email.attempts} attempt${email.attempts !== 1 ? 's' : ''})`, className: 'text-danger' };
  return { text: email.attempts > 0 ? `retrying (${email.attempts} attempt${email.attempts !== 1 ? 's' : ''})` : 'pending', className: 'text-warning' };
}
