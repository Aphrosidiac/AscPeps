'use client';

import { Suspense, useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { XCircle } from 'lucide-react';
import posthog from 'posthog-js';
import { Button } from '@/components/ui/Button';
import { Animate } from '@/components/ui/Animate';
import { getSettings } from '@/lib/api';

// The backend puts the still-open bill on this page's URL so the customer can
// finish the payment they abandoned instead of rebuilding the order. It arrives
// as a query param, so treat it as untrusted: only ever render it as a link if
// it's an https URL on a known gateway host, otherwise drop it. Without this
// check the param would be an open redirect pointed straight at customers who
// have just been told something went wrong with their money.
const GATEWAY_HOSTS = new Set([
  'toyyibpay.com',
  'dev.toyyibpay.com',
  'www.billplz.com',
  'www.billplz-sandbox.com',
]);

function safeRetryUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    return GATEWAY_HOSTS.has(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

function CheckoutFailedContent() {
  const searchParams = useSearchParams();
  const [whatsappNumber, setWhatsappNumber] = useState('601161092723');
  const retryUrl = safeRetryUrl(searchParams.get('retry'));

  useEffect(() => {
    posthog.capture('checkout_payment_failed', { resumable: !!retryUrl });
    getSettings().then((s) => {
      if (s.whatsapp_number) setWhatsappNumber(s.whatsapp_number);
    }).catch(() => {});
  }, [retryUrl]);

  return (
    <div className="max-w-lg mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
      <Animate variant="scale" duration={0.5}>
        <XCircle className="w-16 h-16 text-danger mx-auto mb-4" />
        <h1 className="font-display text-2xl font-bold mb-2">Payment Not Completed</h1>
        <p className="text-text-secondary mb-6">
          {retryUrl
            ? 'No charges were made. Your order is still reserved for a short while — you can pick up where you left off, or pay by bank transfer over WhatsApp.'
            : 'Your payment could not be completed. No charges were made. Your cart has been kept, so you can try again or choose WhatsApp checkout for manual bank transfer.'}
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          {retryUrl ? (
            <a href={retryUrl}>
              <Button variant="primary">Continue Payment</Button>
            </a>
          ) : (
            <Link href="/cart"><Button variant="primary">Try Again</Button></Link>
          )}
          <a href={`https://wa.me/${whatsappNumber}`} target="_blank" rel="noopener noreferrer">
            <Button variant="outline">WhatsApp Us</Button>
          </a>
        </div>

        {retryUrl && (
          <p className="text-xs text-text-muted mt-4">
            Changed your mind about the items? <Link href="/cart" className="text-primary-light hover:underline">Go back to your cart</Link> — it&apos;s still there.
          </p>
        )}
      </Animate>
    </div>
  );
}

export default function CheckoutFailedPage() {
  // useSearchParams opts the subtree into client-side rendering; the Suspense
  // boundary is what keeps the rest of the route statically prerenderable.
  return (
    <Suspense fallback={null}>
      <CheckoutFailedContent />
    </Suspense>
  );
}
