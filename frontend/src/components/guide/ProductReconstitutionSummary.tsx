import Link from 'next/link';
import { Droplets } from 'lucide-react';
import { StorageGuidelines } from './StorageGuidelines';

interface ProductReconstitutionSummaryProps {
  solvent: 'acetic-acid' | 'bac-water';
}

const SOLVENT_COPY = {
  'bac-water': {
    label: 'Bacteriostatic (BAC) water',
    href: '/products/bac-water',
    note: 'the standard solvent for most peptides on this site',
  },
  'acetic-acid': {
    label: '0.6% Acetic Acid',
    href: '/products/acetic-acid',
    note: 'recommended for peptides with solubility issues, such as GHK-Cu',
  },
} as const;

export function ProductReconstitutionSummary({ solvent }: ProductReconstitutionSummaryProps) {
  const { label, href, note } = SOLVENT_COPY[solvent];

  return (
    <div className="mt-6 bg-surface rounded-xl border border-border p-6">
      <h2 className="font-display font-semibold text-lg mb-3">How to Reconstitute</h2>

      <div className="flex items-start gap-3 mb-4 bg-surface-elevated rounded-lg p-3.5">
        <Droplets className="w-4 h-4 text-text-muted mt-0.5 shrink-0" />
        <p className="text-sm text-text-secondary">
          Recommended solvent: <Link href={href} className="font-medium text-text-primary hover:underline">{label}</Link> — {note}.
        </p>
      </div>

      <ol className="space-y-2.5 text-sm text-text-secondary mb-5">
        <li className="flex gap-2.5">
          <span className="font-semibold text-text-primary">1.</span>
          Clean the vial top with an alcohol swab, then slowly release solvent along the inside wall of the vial — don&apos;t squirt directly onto the powder.
        </li>
        <li className="flex gap-2.5">
          <span className="font-semibold text-text-primary">2.</span>
          Let it dissolve on its own for a few minutes. Swirl gently if needed — do not shake.
        </li>
        <li className="flex gap-2.5">
          <span className="font-semibold text-text-primary">3.</span>
          Refrigerate (2-8°C) once reconstituted.
        </li>
      </ol>

      <StorageGuidelines />

      <p className="text-sm text-text-muted mt-4">
        Full walkthrough and the concentration calculator: <Link href="/guide" className="underline">Peptide Guide →</Link>
      </p>
    </div>
  );
}
