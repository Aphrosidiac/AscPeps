import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Disclaimer & Waiver',
  description: 'ASCEND product disclaimer and liability waiver. All products are sold exclusively for research and laboratory use.',
  alternates: { canonical: 'https://ascendpeptides.my/disclaimer' },
};

export default function DisclaimerPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <h1 className="font-display text-3xl font-bold mb-2">Disclaimer & Waiver</h1>
      <p className="text-sm text-text-muted mb-10">Last updated: May 2026</p>

      <div className="prose-custom">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 mb-8">
          <h2 className="text-red-900 mt-0">Important Notice</h2>
          <p className="text-red-800 mb-0">
            All products sold by ASCEND are intended <strong>strictly for laboratory and research purposes only</strong>. By purchasing from ASCEND, you acknowledge and agree to the terms outlined in this disclaimer.
          </p>
        </div>

        <h2>1. Research Use Only</h2>
        <p>
          All products available on ASCEND (ascendpeptides.my) are sold exclusively for legitimate research and laboratory use. Purchasers must be qualified researchers or individuals purchasing for legitimate research purposes.
        </p>

        <h2>2. No Medical Claims</h2>
        <p>
          The statements made on this website have not been evaluated by any Food and Drug Administration, Ministry of Health, or equivalent regulatory body. Our products are not intended to diagnose, treat, cure, or prevent any disease or medical condition. Any information provided on our website, including product descriptions and educational content, is for informational and research reference purposes only.
        </p>

        <h2>3. Assumption of Risk</h2>
        <p>
          By purchasing products from ASCEND, you assume full responsibility for the proper handling, storage, and use of all products in accordance with applicable laws and regulations. You acknowledge that:
        </p>
        <ul>
          <li>You are purchasing products solely for research and laboratory purposes</li>
          <li>You understand the nature of research chemicals and peptides</li>
          <li>You will handle products in accordance with proper laboratory safety protocols</li>
          <li>You will comply with all applicable local, state, and federal laws</li>
        </ul>

        <h2>4. Limitation of Liability</h2>
        <p>
          ASCEND, its owners, employees, and affiliates shall not be held responsible or liable for any damages, injuries, adverse effects, or consequences arising from the use or misuse of any products purchased from our website. This includes but is not limited to:
        </p>
        <ul>
          <li>Direct, indirect, incidental, or consequential damages</li>
          <li>Personal injury or health complications</li>
          <li>Property damage</li>
          <li>Loss of profits or data</li>
          <li>Any unauthorized use of our products</li>
        </ul>

        <h2>5. Indemnification</h2>
        <p>
          You agree to indemnify and hold harmless ASCEND, its owners, employees, and affiliates from any claims, damages, losses, or expenses (including legal fees) arising from your purchase, use, or misuse of our products, or your violation of these terms.
        </p>

        <h2>6. Product Purity and Testing</h2>
        <p>
          ASCEND strives to provide products of the highest quality with 99%+ purity. All products undergo third-party testing and are research-grade certified. However, we make no guarantees regarding the suitability of products for any specific research application. Certificates of analysis are available upon request.
        </p>

        <h2>7. Regulatory Compliance</h2>
        <p>
          It is the buyer&apos;s sole responsibility to ensure compliance with all local laws and regulations regarding the purchase, possession, and use of research peptides and chemicals in their jurisdiction. ASCEND does not provide legal advice regarding the legality of products in your area.
        </p>

        <h2>8. Website Accuracy</h2>
        <p>
          While we strive to keep information on our website accurate and up-to-date, ASCEND makes no warranties or representations regarding the completeness, accuracy, or reliability of any content. Information is subject to change without notice.
        </p>

        <h2>9. Acceptance</h2>
        <p>
          By placing an order with ASCEND, you acknowledge that you have read, understood, and agree to be bound by this Disclaimer & Waiver in its entirety. If you do not agree, do not purchase products from our website.
        </p>

        <p className="text-sm text-text-muted mt-8">
          This disclaimer should be read in conjunction with our <Link href="/terms" className="underline">Terms & Conditions</Link> and <Link href="/privacy" className="underline">Privacy Policy</Link>.
        </p>
      </div>
    </div>
  );
}
