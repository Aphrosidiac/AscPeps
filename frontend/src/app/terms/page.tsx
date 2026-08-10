import type { Metadata } from 'next';
import Link from 'next/link';
import { RETURN_POLICY_STATEMENT } from '@/data/return-policy';

export const metadata: Metadata = {
  title: 'Terms & Conditions',
  description: 'Terms and conditions for purchasing research peptides from ASCEND Malaysia. Read before placing an order.',
  alternates: { canonical: 'https://ascendpeptides.my/terms' },
};

export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <h1 className="font-display text-3xl font-bold mb-2">Terms & Conditions</h1>
      <p className="text-sm text-text-muted mb-10">Last updated: May 2026</p>

      <div className="prose-custom">
        <p>
          By accessing and using the ASCEND website (ascendpeptides.my) and purchasing products from us, you agree to be bound by these Terms & Conditions. If you do not agree, please do not use our website or purchase our products.
        </p>

        <h2>1. Research Use Only</h2>
        <p>
          All products sold by ASCEND are intended strictly for <strong>laboratory and research purposes only</strong>. By purchasing, you confirm that you understand and agree to this condition.
        </p>

        <h2>2. Age Requirement</h2>
        <p>
          You must be at least 18 years of age to purchase products from ASCEND. By placing an order, you represent and warrant that you are at least 18 years old.
        </p>

        <h2>3. Product Information</h2>
        <p>
          Product descriptions, specifications, and images are provided for informational purposes. While we strive for accuracy, we do not warrant that product descriptions or other content on this site are complete, reliable, current, or error-free. All products are sold as-is for research purposes.
        </p>

        <h2>4. Pricing and Payment</h2>
        <p>
          All prices are displayed in Malaysian Ringgit (MYR). We reserve the right to modify prices at any time without prior notice. Payment must be completed before orders are processed. We accept payment via bank transfer (WhatsApp checkout) and online payment methods as displayed at checkout.
        </p>

        <h2>5. Orders and Cancellations</h2>
        <p>
          Once an order has been confirmed and payment received, cancellations may not be possible if the order has already been processed or shipped. Please contact us via WhatsApp as soon as possible if you need to cancel or modify an order.
        </p>

        <h2>6. Shipping and Delivery</h2>
        <p>
          We ship across Peninsular Malaysia. We do not currently ship to Sabah or Sarawak. Delivery times may vary depending on your location. Please refer to our <Link href="/shipping" className="underline">Shipping Policy</Link> for full details. ASCEND is not responsible for delays caused by courier services or circumstances beyond our control.
        </p>

        <h2>7. Returns and Refunds</h2>
        <p>
          {RETURN_POLICY_STATEMENT} See our <Link href="/return-policy" className="underline">Return Policy</Link> for how to raise a claim.
        </p>

        <h2>8. Limitation of Liability</h2>
        <p>
          ASCEND shall not be held liable for any damages, injuries, or adverse effects arising from the misuse of our products. All products are sold for research use only. Please refer to our <Link href="/disclaimer" className="underline">Disclaimer & Waiver</Link> for full details.
        </p>

        <h2>9. Intellectual Property</h2>
        <p>
          All content on this website, including text, graphics, logos, and images, is the property of ASCEND and is protected by applicable intellectual property laws. Unauthorized use or reproduction is prohibited.
        </p>

        <h2>10. Privacy</h2>
        <p>
          Your personal information is handled in accordance with our <Link href="/privacy" className="underline">Privacy Policy</Link>. By using our website, you consent to the collection and use of your information as described therein.
        </p>

        <h2>11. Amendments</h2>
        <p>
          ASCEND reserves the right to update or modify these Terms & Conditions at any time. Changes will be effective immediately upon posting on this page. Continued use of the website constitutes acceptance of the updated terms.
        </p>

        <h2>12. Governing Law</h2>
        <p>
          These terms shall be governed by and construed in accordance with the laws of Malaysia. Any disputes shall be subject to the exclusive jurisdiction of the courts of Malaysia.
        </p>

        <h2>Contact</h2>
        <p>
          For questions regarding these terms, contact us via <a href="https://wa.me/601161092723" target="_blank" rel="noopener noreferrer" className="underline">WhatsApp</a>.
        </p>
      </div>
    </div>
  );
}
