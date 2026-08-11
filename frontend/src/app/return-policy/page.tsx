import type { Metadata } from 'next';
import Link from 'next/link';
import { getSettingsServer } from '@/lib/server-api';
import {
  RETURN_POLICY_STATEMENT,
  RETURN_POLICY_ELIGIBLE,
  RETURN_POLICY_CLAIM_REQUIREMENTS,
  RETURN_POLICY_LAST_UPDATED,
} from '@/data/return-policy';

export const metadata: Metadata = {
  title: 'Return Policy',
  description:
    'Ascend MY return and refund policy for research peptides in Malaysia. What can be claimed, the 48-hour claim window, and how to raise a claim.',
  keywords: ['peptide return policy malaysia', 'ascend refund policy', 'research peptide returns'],
  alternates: { canonical: 'https://ascendpeptides.my/return-policy' },
};

export default async function ReturnPolicyPage() {
  const settings = await getSettingsServer();
  const whatsapp = settings.whatsapp_number || '601161092723';

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <h1 className="font-display text-3xl font-bold mb-2">Return Policy</h1>
      <p className="text-sm text-text-muted mb-10">Last updated: {RETURN_POLICY_LAST_UPDATED}</p>

      <div className="prose-custom">
        {/* The governing wording, verbatim and first, so the restrictive part
            is the first thing read rather than something found later. */}
        <p className="font-medium">{RETURN_POLICY_STATEMENT}</p>

        <h2>What can be claimed</h2>
        <p>A claim can be raised in these situations only:</p>
        <ul>
          {RETURN_POLICY_ELIGIBLE.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p>
          Outside of these, orders cannot be returned or refunded once shipped. This is because the products are
          research compounds whose storage conditions cannot be verified once they have left us, so a returned vial
          can never go back into stock.
        </p>

        <h2>How to raise a claim</h2>
        <ul>
          {RETURN_POLICY_CLAIM_REQUIREMENTS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p>
          Message us on{' '}
          <a
            href={`https://wa.me/${whatsapp}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            WhatsApp
          </a>{' '}
          to start a claim. You can find your order number on the{' '}
          <Link href="/track" className="underline">
            Track Order
          </Link>{' '}
          page.
        </p>

        {/* Mirrors clause 5 of the Terms, not a looser paraphrase of it: the
            cutoff there is "processed OR shipped", and processed comes first. */}
        <h2>Cancellations</h2>
        <p>
          Once an order has been confirmed and payment received, cancellation may not be possible if the order has
          already been processed or shipped. Contact us as soon as possible if you need to cancel or modify an order.
        </p>

        <h2>Governing terms</h2>
        <p>
          This page restates clause 7 of our{' '}
          <Link href="/terms" className="underline">
            Terms &amp; Conditions
          </Link>
          , which remain the governing document. See also our{' '}
          <Link href="/shipping" className="underline">
            Shipping Policy
          </Link>{' '}
          for delivery coverage and times.
        </p>
      </div>
    </div>
  );
}
