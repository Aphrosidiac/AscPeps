import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isSessionId, type CheckoutConfig, type PublicSession } from 'manualpaygate/core';
import { PayClient } from './PayClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Complete your payment — Ascend MY',
  // A payment page is personal and single-use: never indexed, never cached by
  // a crawler that followed a shared link.
  robots: { index: false, follow: false },
  // The session URL is the credential: it must not leak to Wise/Stripe/
  // WhatsApp through the referrer when the customer follows a link out.
  referrer: 'same-origin',
};

// Server-side reads go straight to the backend origin, the same way
// lib/server-api.ts does — the nginx-relative /api path only exists in the
// browser.
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3105';

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSessionId(id)) notFound();
  const [session, config] = await Promise.all([
    getJson<PublicSession>(`/api/v1/pay/sessions/${id}`),
    getJson<CheckoutConfig>('/api/v1/pay/config'),
  ]);
  if (!session || !config) notFound();
  return <PayClient session={session} config={config} />;
}
