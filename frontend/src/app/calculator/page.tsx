import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { getProductsServer } from '@/lib/server-api';
import { Animate, Stagger } from '@/components/ui/Animate';
import { ProductCard } from '@/components/products/ProductCard';
import { FaqJsonLd } from '@/components/JsonLd';
import { CalculatorClient } from './CalculatorClient';

export const metadata: Metadata = {
  title: 'Peptide Reconstitution Calculator — Dosage & Concentration',
  description: 'Free peptide reconstitution calculator. Work out draw volume, concentration, and doses per vial for research peptides. ASCEND Malaysia calculator.',
  keywords: ['peptide calculator', 'peptide reconstitution calculator', 'peptide dosage calculator', 'peptide concentration calculator', 'how much bac water peptides', 'peptide calculator malaysia'],
  alternates: { canonical: 'https://ascendpeptides.my/calculator' },
};

const faqs = [
  {
    q: 'How do I use the peptide reconstitution calculator?',
    a: 'Select the target dose per use, the total peptide strength in your vial, and the amount of bacteriostatic water you added. The calculator works out the resulting concentration, how many doses the vial yields, and the equivalent draw line on a standard U-100 insulin syringe.',
  },
  {
    q: 'What syringe does the draw line assume?',
    a: 'The syringe gauge assumes a standard U-100 insulin syringe, where 100 units equals 1mL. If you use a different syringe size, convert using the concentration (mg/mL) figure instead.',
  },
  {
    q: 'How is concentration calculated?',
    a: 'Concentration (mg/mL) is the total peptide strength in the vial divided by the volume of water added. For example, a 5mg vial reconstituted with 2mL of water gives a concentration of 2.5mg/mL.',
  },
  {
    q: 'Why does more water mean a bigger draw volume for the same dose?',
    a: 'Adding more water dilutes the peptide, lowering the concentration. A lower concentration means a larger volume is needed to reach the same target dose — which shows up as a longer draw line on the syringe.',
  },
  {
    q: 'What if my exact vial strength or dose isn’t listed?',
    a: 'Use the custom input field under each column to enter any value directly — the calculator isn’t limited to the preset options.',
  },
  {
    q: 'Is this calculator a substitute for professional guidance?',
    a: 'No. This tool is provided for research and laboratory reference only, to help estimate reconstitution math. It does not replace protocols established by a qualified professional or your organization’s research procedures.',
  },
];

export default async function CalculatorPage() {
  const { data: products } = await getProductsServer({ limit: 4 });

  return (
    <div className="py-8">
      <FaqJsonLd items={faqs} />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <Animate variant="fadeUp">
          <h1 className="font-display text-3xl font-bold mb-2">Peptide Reconstitution Calculator</h1>
          <p className="text-text-secondary mb-6">
            Work out concentration, draw volume, and doses per vial for research peptides.
          </p>
        </Animate>

        <Animate variant="fadeUp" delay={0.05}>
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-5 mb-8">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5 shrink-0" />
              <p className="text-sm text-yellow-800">
                <strong>Research Use Only.</strong>
              </p>
            </div>
          </div>
        </Animate>

        <Animate variant="fadeUp" delay={0.1}>
          <CalculatorClient />
        </Animate>
      </div>

      {products.length > 0 && (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 mt-16">
          <Animate variant="fadeUp">
            <h2 className="font-display text-2xl font-bold mb-6">Shop Research Peptides</h2>
          </Animate>
          <Stagger className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </Stagger>
        </div>
      )}

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 mt-16">
        <Animate variant="fadeUp">
          <h2 className="font-display text-2xl font-bold mb-6">How the Calculation Works</h2>
        </Animate>

        <div className="prose-custom space-y-6">
          <Animate variant="fadeUp" delay={0.05}>
            <div>
              <h3>Step 1: Set the Target Dose</h3>
              <p>Choose the amount of peptide, in milligrams (mg), for a single use. Enter this into the calculator, or use the custom field for an exact value.</p>
            </div>
          </Animate>
          <Animate variant="fadeUp" delay={0.1}>
            <div>
              <h3>Step 2: Enter Vial Strength</h3>
              <p>Enter the total amount of peptide in the vial. Common strengths include 1mg, 5mg, 10mg, and 15mg — or enter a specific amount if it isn&apos;t listed.</p>
            </div>
          </Animate>
          <Animate variant="fadeUp" delay={0.15}>
            <div>
              <h3>Step 3: Enter Water Added</h3>
              <p>Enter the volume of bacteriostatic water used to reconstitute the vial, in millilitres (mL). This determines the resulting concentration.</p>
            </div>
          </Animate>
          <Animate variant="fadeUp" delay={0.2}>
            <div>
              <h3>Step 4: Read the Draw Line</h3>
              <p>The calculator shows the concentration, doses per vial, and the equivalent draw line on a standard U-100 insulin syringe.</p>
            </div>
          </Animate>
        </div>

        <Animate variant="fadeUp" delay={0.25}>
          <p className="text-sm text-text-secondary mt-8">
            For full guidance on reconstituting and storing lyophilized peptides, see our{' '}
            <Link href="/guide" className="underline hover:text-text-primary">Peptide Guide</Link>.
          </p>
        </Animate>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 mt-16">
        <Animate variant="fadeUp">
          <h2 className="font-display text-2xl font-bold mb-6">Frequently Asked Questions</h2>
        </Animate>
        <div className="space-y-4">
          {faqs.map((faq, i) => (
            <Animate key={faq.q} variant="fadeUp" delay={i * 0.05}>
              <details className="group bg-surface rounded-xl border border-border">
                <summary className="flex items-center justify-between px-5 py-4 cursor-pointer font-medium text-sm hover:bg-surface-elevated/50 transition-colors rounded-xl list-none">
                  {faq.q}
                  <span className="text-text-muted ml-4 shrink-0 group-open:rotate-45 transition-transform text-lg">+</span>
                </summary>
                <div className="px-5 pb-4 text-sm text-text-secondary leading-relaxed">{faq.a}</div>
              </details>
            </Animate>
          ))}
        </div>
      </div>
    </div>
  );
}
