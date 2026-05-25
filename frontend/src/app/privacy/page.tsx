import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'ASCEND privacy policy. How we collect, use, and protect your personal information when you shop for research peptides.',
  alternates: { canonical: 'https://ascend.apdevotion.my/privacy' },
};

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <h1 className="font-display text-3xl font-bold mb-2">Privacy Policy</h1>
      <p className="text-sm text-text-muted mb-10">Last updated: May 2026</p>

      <div className="prose-custom">
        <p>
          ASCEND (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) respects your privacy. This Privacy Policy explains how we collect, use, and protect your personal information when you visit our website (ascend.apdevotion.my) or make a purchase.
        </p>

        <h2>1. Information We Collect</h2>
        <p>When you place an order, we collect:</p>
        <ul>
          <li>Full name</li>
          <li>Phone number</li>
          <li>Email address (optional)</li>
          <li>Shipping address (street, city, state, postcode)</li>
          <li>Order details and payment method</li>
        </ul>
        <p>We do not collect sensitive financial information such as credit card numbers. Online payments are processed through third-party payment gateways (Billplz) which have their own privacy policies.</p>

        <h2>2. How We Use Your Information</h2>
        <p>Your information is used to:</p>
        <ul>
          <li>Process and fulfill your orders</li>
          <li>Communicate order status and shipping updates</li>
          <li>Provide customer support via WhatsApp</li>
          <li>Improve our products and services</li>
        </ul>

        <h2>3. Information Sharing</h2>
        <p>
          We do not sell, trade, or rent your personal information to third parties. We may share your information with:
        </p>
        <ul>
          <li>Courier services for order delivery</li>
          <li>Payment processors for transaction processing</li>
          <li>Law enforcement if required by law</li>
        </ul>

        <h2>4. Data Security</h2>
        <p>
          We implement reasonable security measures to protect your personal information, including encrypted connections (SSL/TLS), secure database storage, and access controls. However, no method of transmission over the internet is 100% secure.
        </p>

        <h2>5. Cookies</h2>
        <p>
          Our website uses essential cookies and local storage to maintain your shopping cart and admin session. We do not use tracking cookies or third-party advertising cookies.
        </p>

        <h2>6. Data Retention</h2>
        <p>
          We retain order information for record-keeping and customer support purposes. You may request deletion of your personal data by contacting us via WhatsApp.
        </p>

        <h2>7. Your Rights</h2>
        <p>You have the right to:</p>
        <ul>
          <li>Access the personal data we hold about you</li>
          <li>Request correction of inaccurate data</li>
          <li>Request deletion of your data</li>
          <li>Withdraw consent for data processing</li>
        </ul>

        <h2>8. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated revision date.
        </p>

        <h2>Contact</h2>
        <p>
          For privacy-related inquiries, contact us via <a href="https://wa.me/601161092723" target="_blank" rel="noopener noreferrer" className="underline">WhatsApp</a>.
        </p>
      </div>
    </div>
  );
}
