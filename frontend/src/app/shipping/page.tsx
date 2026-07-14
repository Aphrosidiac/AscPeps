import type { Metadata } from 'next';
import { getSettingsServer } from '@/lib/server-api';

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettingsServer();
  const shippingFee = settings.shipping_fee || '';
  const freeShipping = !shippingFee || shippingFee === '0';

  return {
    title: 'Shipping Policy',
    description: freeShipping
      ? 'ASCEND shipping policy for research peptides in Malaysia. Free shipping, delivery times, packaging details, and tracking information.'
      : 'ASCEND shipping policy for research peptides in Malaysia. Delivery times, shipping fees, packaging details, and tracking information.',
    keywords: freeShipping
      ? ['peptide shipping malaysia', 'free shipping peptides', 'peptide delivery malaysia']
      : ['peptide shipping malaysia', 'peptide delivery malaysia'],
    alternates: { canonical: 'https://ascendpeptides.my/shipping' },
  };
}

export default async function ShippingPage() {
  const settings = await getSettingsServer();
  const shippingFee = settings.shipping_fee || '';
  const freeShipping = !shippingFee || shippingFee === '0';

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <h1 className="font-display text-3xl font-bold mb-2">Shipping Policy</h1>
      <p className="text-sm text-text-muted mb-10">Last updated: May 2026</p>

      <div className="prose-custom">
        <h2>Shipping Coverage</h2>
        <p>
          ASCEND ships to all states across Malaysia, including Sabah and Sarawak. We currently ship domestically within Malaysia only.
        </p>

        <h2>Shipping Fees</h2>
        <p>
          {freeShipping ? (
            <>We offer <strong>free shipping</strong> on all orders within Malaysia. No minimum order required.</>
          ) : (
            <>A flat shipping fee of <strong>RM{shippingFee}</strong> applies to all orders within Malaysia. No minimum order required.</>
          )}
        </p>

        <h2>Processing Time</h2>
        <p>
          Orders are processed within <strong>1-2 business days</strong> after payment confirmation. Orders placed on weekends or public holidays will be processed on the next business day.
        </p>

        <h2>Delivery Time</h2>
        <div className="overflow-x-auto -mx-4 px-4">
        <table>
          <thead>
            <tr><th>Region</th><th>Estimated Delivery</th></tr>
          </thead>
          <tbody>
            <tr><td>Peninsular Malaysia (Klang Valley)</td><td>1-2 business days</td></tr>
            <tr><td>Peninsular Malaysia (Other states)</td><td>2-4 business days</td></tr>
            <tr><td>East Malaysia (Sabah & Sarawak)</td><td>3-7 business days</td></tr>
          </tbody>
        </table>
        </div>
        <p className="text-sm text-text-muted">
          Delivery times are estimates and may vary due to courier capacity, weather conditions, or public holidays.
        </p>

        <h2>Order Tracking</h2>
        <p>
          Once your order has been shipped, you will receive tracking information via WhatsApp. You can also track your order anytime using your phone number on our <a href="/track" className="underline">Track Order</a> page.
        </p>

        <h2>Packaging</h2>
        <p>
          All orders are shipped in <strong>discreet, plain packaging</strong> with no external branding or indication of contents. Products are carefully packed to maintain integrity during transit, including insulated packaging for temperature-sensitive items.
        </p>

        <h2>Cold Chain Handling</h2>
        <p>
          Peptides are sensitive to temperature. We ship with appropriate cold chain precautions to maintain product integrity. Upon receiving your order, we recommend storing peptides in the refrigerator (2-8°C) or freezer (-20°C) for long-term storage.
        </p>

        <h2>Lost or Damaged Packages</h2>
        <p>
          If your package is lost in transit or arrives damaged, please contact us via WhatsApp within <strong>48 hours</strong> of the expected delivery date with your order number and any photos of damaged packaging. We will work with the courier to resolve the issue and arrange a replacement if necessary.
        </p>

        <h2>Failed Delivery</h2>
        <p>
          If delivery fails due to an incorrect address provided by the customer, additional shipping fees may apply for re-delivery. Please double-check your shipping address before completing your order.
        </p>

        <h2>Contact</h2>
        <p>
          For shipping inquiries, contact us via <a href="https://wa.me/601161092723" target="_blank" rel="noopener noreferrer" className="underline">WhatsApp</a>.
        </p>
      </div>
    </div>
  );
}
