import type { Metadata } from 'next';
import Link from 'next/link';
import { Animate } from '@/components/ui/Animate';
import { FaqJsonLd } from '@/components/JsonLd';

export const metadata: Metadata = {
  title: 'FAQ — Frequently Asked Questions About Peptides',
  description: 'Frequently asked questions about buying research peptides in Malaysia. Purity, storage, shipping, ordering, and more. ASCEND peptides FAQ.',
  keywords: ['peptides FAQ', 'peptides questions malaysia', 'how to buy peptides malaysia', 'peptide storage', 'peptide purity'],
  alternates: { canonical: 'https://ascendpeptides.my/faq' },
};

const faqs = [
  {
    category: 'Products & Quality',
    items: [
      {
        q: 'What are research peptides?',
        a: 'Research peptides are short chains of amino acids used in scientific and laboratory research. They are synthesized to study biological processes, protein interactions, and potential therapeutic targets. All products sold by ASCEND are strictly for research purposes only.',
      },
      {
        q: 'What is the purity of your peptides?',
        a: 'All ASCEND peptides are manufactured to 99%+ purity standards. Every batch undergoes third-party testing and is research-grade certified. Certificates of Analysis (COA) are available upon request.',
      },
      {
        q: 'Are your peptides third-party tested?',
        a: 'Yes. Every batch is independently tested by third-party laboratories to verify purity, identity, and quality. We believe in full transparency from synthesis to delivery.',
      },
      {
        q: 'Can I request a Certificate of Analysis (COA)?',
        a: 'Absolutely. Contact us via WhatsApp with your order number or the specific product code, and we will provide the corresponding COA.',
      },
      {
        q: 'Are these peptides for human consumption?',
        a: 'No. All products sold by ASCEND are intended strictly for laboratory and research purposes only. They are not for human consumption, veterinary use, or any unauthorized application.',
      },
    ],
  },
  {
    category: 'Ordering & Payment',
    items: [
      {
        q: 'How do I place an order?',
        a: 'Browse our products, add items to your cart, and proceed to checkout. You can choose to pay via WhatsApp (bank transfer) or online payment. No account registration is needed.',
      },
      {
        q: 'What payment methods do you accept?',
        a: 'We accept bank transfer (via WhatsApp checkout) and online payment through FPX and credit/debit cards. For WhatsApp checkout, you will receive our bank account details and can send proof of payment directly.',
      },
      {
        q: 'Do I need to create an account?',
        a: 'No. ASCEND does not require account registration. You can place orders and track them using just your phone number.',
      },
      {
        q: 'Can I cancel or modify my order?',
        a: 'Orders can be cancelled or modified before they are processed. Contact us via WhatsApp as soon as possible. Once an order has been shipped, cancellation is not possible.',
      },
      {
        q: 'Is there a minimum order amount?',
        a: 'No. There is no minimum order requirement, and all orders ship free within Malaysia.',
      },
    ],
  },
  {
    category: 'Shipping & Delivery',
    items: [
      {
        q: 'Do you offer free shipping?',
        a: 'Yes. All orders within Malaysia ship free, with no minimum order required.',
      },
      {
        q: 'How long does delivery take?',
        a: 'Peninsular Malaysia (Klang Valley): 1-2 business days. Other Peninsular states: 2-4 business days. Sabah & Sarawak: 3-7 business days. Orders are processed within 1-2 business days after payment confirmation.',
      },
      {
        q: 'How is my order packaged?',
        a: 'All orders are shipped in discreet, plain packaging with no external branding or indication of contents. Temperature-sensitive products are packed with appropriate cold chain precautions.',
      },
      {
        q: 'Can I track my order?',
        a: 'Yes. Once shipped, you will receive tracking information via WhatsApp. You can also track your order on our Track Order page using your phone number.',
      },
      {
        q: 'Do you ship internationally?',
        a: 'Currently, we only ship within Malaysia. We are exploring international shipping options for the future.',
      },
    ],
  },
  {
    category: 'Storage & Handling',
    items: [
      {
        q: 'How should I store my peptides?',
        a: 'Unreconstituted (lyophilized) peptides should be stored in the refrigerator (2-8°C) for short-term storage or freezer (-20°C) for long-term storage. Keep away from direct sunlight and moisture. Once reconstituted, peptides should be refrigerated and used within the timeframe specified in our Peptide Guide.',
      },
      {
        q: 'What is the shelf life of peptides?',
        a: 'Lyophilized (freeze-dried) peptides typically have a shelf life of 12-24 months when stored properly in a freezer. Reconstituted peptides have a shorter shelf life and should be refrigerated.',
      },
      {
        q: 'What is BAC water and do I need it?',
        a: 'Bacteriostatic water (BAC water) is sterile water containing 0.9% benzyl alcohol, used as a solvent for reconstituting lyophilized peptides. It inhibits bacterial growth, extending the shelf life of reconstituted peptides. We offer Acetic Acid as a reconstitution supply in our store.',
      },
    ],
  },
];

export default function FaqPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <FaqJsonLd items={faqs.flatMap((s) => s.items)} />
      <Animate variant="fadeUp">
        <h1 className="font-display text-3xl font-bold mb-2">Frequently Asked Questions</h1>
        <p className="text-text-secondary mb-10">Everything you need to know about ordering research peptides from ASCEND.</p>
      </Animate>

      <div className="space-y-10">
        {faqs.map((section, si) => (
          <Animate key={section.category} variant="fadeUp" delay={si * 0.08}>
            <div>
              <h2 className="font-display font-semibold text-xl mb-4 text-text-primary">{section.category}</h2>
              <div className="space-y-4">
                {section.items.map((faq) => (
                  <details key={faq.q} className="group bg-surface rounded-xl border border-border">
                    <summary className="flex items-center justify-between px-5 py-4 cursor-pointer font-medium text-sm hover:bg-surface-elevated/50 transition-colors rounded-xl list-none">
                      {faq.q}
                      <span className="text-text-muted ml-4 shrink-0 group-open:rotate-45 transition-transform text-lg">+</span>
                    </summary>
                    <div className="px-5 pb-4 text-sm text-text-secondary leading-relaxed">
                      {faq.a}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          </Animate>
        ))}
      </div>

      <Animate variant="fadeUp" delay={0.3}>
        <div className="mt-12 bg-surface rounded-xl border border-border p-6 text-center">
          <h3 className="font-display font-semibold mb-2">Still have questions?</h3>
          <p className="text-sm text-text-secondary mb-4">Our team is happy to help with any questions about our products or ordering process.</p>
          <a
            href="https://wa.me/601161092723"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-primary-light transition-colors"
          >
            WhatsApp Us
          </a>
        </div>
      </Animate>
    </div>
  );
}
