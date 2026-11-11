import type { OrderEmail } from '@/types';

// Shared between the admin Orders page (per-order Emails block) and the
// admin Emails ops page — keep labels/status text identical in both.
// Keyed by string: the outbox also carries types the order page can't resend
// (payment reminder, pre-order update), and the Emails list shows them all.
export const EMAIL_TYPE_LABELS: Record<string, string> = {
  ORDER_CONFIRMATION: 'Confirmation',
  PAYMENT_RECEIPT: 'Receipt',
  ABANDONED_CHECKOUT: 'Payment reminder',
  PREORDER_UPDATE: 'Pre-order update',
};

export function emailStatusText(email?: OrderEmail): { text: string; className: string } {
  if (!email) return { text: 'not queued', className: 'text-text-muted' };
  if (email.status === 'DELIVERED') return { text: 'delivered ✓', className: 'text-success' };
  if (email.status === 'SENT') return { text: 'sent ✓', className: 'text-success' };
  if (email.status === 'BOUNCED') return { text: 'bounced', className: 'text-danger' };
  if (email.status === 'COMPLAINED') return { text: 'marked as spam', className: 'text-danger' };
  if (email.status === 'FAILED') return { text: `failed (${email.attempts} attempt${email.attempts !== 1 ? 's' : ''})`, className: 'text-danger' };
  return { text: email.attempts > 0 ? `retrying (${email.attempts} attempt${email.attempts !== 1 ? 's' : ''})` : 'pending', className: 'text-warning' };
}
