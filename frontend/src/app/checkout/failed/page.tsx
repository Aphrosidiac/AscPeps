'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { XCircle } from 'lucide-react';
import posthog from 'posthog-js';
import { Button } from '@/components/ui/Button';
import { Animate } from '@/components/ui/Animate';
import { getSettings } from '@/lib/api';

export default function CheckoutFailedPage() {
  const [whatsappNumber, setWhatsappNumber] = useState('601161092723');

  useEffect(() => {
    posthog.capture('checkout_payment_failed');
    getSettings().then((s) => {
      if (s.whatsapp_number) setWhatsappNumber(s.whatsapp_number);
    }).catch(() => {});
  }, []);

  return (
    <div className="max-w-lg mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
      <Animate variant="scale" duration={0.5}>
        <XCircle className="w-16 h-16 text-danger mx-auto mb-4" />
        <h1 className="font-display text-2xl font-bold mb-2">Payment Failed</h1>
        <p className="text-text-secondary mb-6">
          Your payment could not be completed. No charges were made. Please try again or choose WhatsApp checkout for manual bank transfer.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/cart"><Button variant="primary">Try Again</Button></Link>
          <a href={`https://wa.me/${whatsappNumber}`} target="_blank" rel="noopener noreferrer">
            <Button variant="outline">WhatsApp Us</Button>
          </a>
        </div>
      </Animate>
    </div>
  );
}
