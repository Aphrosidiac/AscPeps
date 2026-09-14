'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import posthog from 'posthog-js';
import { CheckoutPage, createCheckoutClient } from 'manualpaygate/ui';
import type { CheckoutConfig, PublicSession } from 'manualpaygate/core';

export function PayClient({ session: initial, config }: { session: PublicSession; config: CheckoutConfig }) {
  const router = useRouter();
  const [session, setSession] = useState(initial);
  // Browser-side calls use the same relative /api base as lib/api.ts, which
  // nginx proxies to the backend in production.
  const client = useMemo(() => createCheckoutClient({ baseUrl: `${process.env.NEXT_PUBLIC_API_URL ?? ''}/api/v1/pay` }), []);

  return (
    <CheckoutPage
      session={session}
      config={config}
      navigate={(url) => router.push(url)}
      onSubmitProof={async (file, note, email) => {
        const updated = await client.submitProof(session.id, file, note, email);
        setSession(updated);
        posthog.capture('manual_payment_proof_submitted', { order_number: updated.reference, retry: initial.status === 'REJECTED' });
        return updated;
      }}
    />
  );
}
