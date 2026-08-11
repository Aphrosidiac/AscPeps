import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Certificates of Analysis & Third-Party Testing',
  description: 'How Ascend MY verifies the purity and identity of every research peptide batch through independent third-party laboratory testing, and how to request a Certificate of Analysis.',
  keywords: ['peptide COA malaysia', 'certificate of analysis peptides', 'third-party tested peptides malaysia', 'peptide purity testing'],
  alternates: { canonical: 'https://ascendpeptides.my/coa' },
};

export default function CoaPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <h1 className="font-display text-3xl font-bold mb-2">Certificates of Analysis &amp; Third-Party Testing</h1>
      <p className="text-sm text-text-muted mb-10">How we verify what's in every vial.</p>

      <div className="prose-custom">
        <h2>Why third-party testing matters</h2>
        <p>
          Research peptides are only useful to a researcher if the compound in the vial actually matches what's on the label — correct identity, correct purity, no undisclosed contaminants. Because peptide synthesis is a chemical manufacturing process with real batch-to-batch variance, we don't ask researchers to take purity claims on faith. Every batch we sell is independently tested before it reaches a customer.
        </p>

        <h2>Who tests our products</h2>
        <p>
          Ascend MY uses independent, accredited third-party laboratories — not in-house or manufacturer-supplied testing — to verify identity and purity. Independent testing means the lab has no commercial stake in the result, which is the point: a manufacturer's own purity claim isn't independent verification, and we don't think it should be treated as one.
        </p>

        <h2>What a Certificate of Analysis actually shows</h2>
        <p>
          A COA is a lab report for a specific batch, typically covering:
        </p>
        <ul>
          <li>Identity confirmation (the compound is what it claims to be)</li>
          <li>Purity percentage (commonly via HPLC — high-performance liquid chromatography)</li>
          <li>Mass spectrometry data confirming molecular weight</li>
        </ul>
        <p>
          Every product we list is manufactured to a 99%+ purity standard, and that figure is meant to reflect the batch testing, not a manufacturer's marketing claim.
        </p>

        <h2>How to get a COA for your order</h2>
        <p>
          Batch-specific Certificates of Analysis are available on request. Contact us via <a href="https://wa.me/601161092723" target="_blank" rel="noopener noreferrer" className="underline">WhatsApp</a> with your order number or the product code, and we'll send the corresponding COA for the batch you received. We're working on making batch-specific COAs available directly on every product page — for now, WhatsApp is the fastest way to get one.
        </p>

        <h2>A note on transparency</h2>
        <p>
          We'd rather a customer double-check a COA and find nothing wrong than take a purity claim on faith. If anything in a report you receive doesn't look right, tell us — that's exactly what independent testing is for.
        </p>

        <h2>Questions</h2>
        <p>
          See our <a href="/faq" className="underline">FAQ</a> for more on purity, testing, and ordering, or reach us directly via <a href="https://wa.me/601161092723" target="_blank" rel="noopener noreferrer" className="underline">WhatsApp</a>.
        </p>
      </div>
    </div>
  );
}
