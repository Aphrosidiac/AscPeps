import type { Metadata } from 'next';
import { FlaskConical, Thermometer, Clock, AlertTriangle, Droplets, Snowflake } from 'lucide-react';
import { Animate, Stagger } from '@/components/ui/Animate';

export const metadata: Metadata = {
  title: 'Peptide Guide — Reconstitution, Storage & Handling',
  description: 'Complete guide to handling research peptides. Learn how to reconstitute, store, and handle lyophilized peptides properly. ASCEND Malaysia peptide guide.',
  keywords: ['how to reconstitute peptides', 'peptide reconstitution guide', 'peptide storage guide', 'how to mix peptides', 'peptide handling malaysia', 'BAC water peptides'],
  alternates: { canonical: 'https://ascend.apdevotion.my/guide' },
};

export default function GuidePage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <Animate variant="fadeUp">
        <h1 className="font-display text-3xl font-bold mb-2">Peptide Guide</h1>
        <p className="text-text-secondary mb-10">
          A comprehensive guide to reconstituting, storing, and handling research peptides for laboratory use.
        </p>
      </Animate>

      <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-5 mb-10">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5 shrink-0" />
          <p className="text-sm text-yellow-800">
            <strong>Research Use Only.</strong> This guide is provided for educational and laboratory reference purposes. All ASCEND products are intended strictly for research use and are not for human consumption.
          </p>
        </div>
      </div>

      <div className="prose-custom">
        <Animate variant="fadeUp" delay={0.05}>
          <h2>Understanding Lyophilized Peptides</h2>
          <p>
            Most research peptides are supplied in <strong>lyophilized (freeze-dried) form</strong> — a dry powder in a sealed vial. Lyophilization preserves the peptide&apos;s stability and extends shelf life. Before use in research, the peptide must be reconstituted (dissolved) in an appropriate solvent.
          </p>
        </Animate>

        <Animate variant="fadeUp" delay={0.1}>
          <h2>What You Need</h2>
        </Animate>
        <Stagger className="grid sm:grid-cols-2 gap-4 my-6" stagger={0.06}>
          <div className="bg-surface rounded-xl border border-border p-4 flex items-start gap-3">
            <FlaskConical className="w-5 h-5 text-text-muted mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-sm">Lyophilized Peptide Vial</p>
              <p className="text-xs text-text-muted">Your ASCEND research peptide</p>
            </div>
          </div>
          <div className="bg-surface rounded-xl border border-border p-4 flex items-start gap-3">
            <Droplets className="w-5 h-5 text-text-muted mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-sm">Reconstitution Solvent</p>
              <p className="text-xs text-text-muted">BAC water or sterile water</p>
            </div>
          </div>
          <div className="bg-surface rounded-xl border border-border p-4 flex items-start gap-3">
            <div className="w-5 h-5 flex items-center justify-center text-text-muted mt-0.5 shrink-0">
              <span className="text-sm font-bold">💉</span>
            </div>
            <div>
              <p className="font-medium text-sm">Insulin Syringes</p>
              <p className="text-xs text-text-muted">For precise measurement</p>
            </div>
          </div>
          <div className="bg-surface rounded-xl border border-border p-4 flex items-start gap-3">
            <div className="w-5 h-5 flex items-center justify-center text-text-muted mt-0.5 shrink-0">
              <span className="text-sm font-bold">🧴</span>
            </div>
            <div>
              <p className="font-medium text-sm">Alcohol Swabs</p>
              <p className="text-xs text-text-muted">For sterilizing vial tops</p>
            </div>
          </div>
        </Stagger>

        <Animate variant="fadeUp" delay={0.15}>
          <h2>Reconstitution Steps</h2>
          <div className="space-y-4 my-6">
            <div className="flex gap-4 items-start">
              <span className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center text-sm font-bold shrink-0">1</span>
              <div>
                <p className="font-medium">Clean the vial top</p>
                <p className="text-sm text-text-secondary">Wipe the rubber stopper of both the peptide vial and solvent with an alcohol swab. Allow to dry.</p>
              </div>
            </div>
            <div className="flex gap-4 items-start">
              <span className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center text-sm font-bold shrink-0">2</span>
              <div>
                <p className="font-medium">Draw the solvent</p>
                <p className="text-sm text-text-secondary">Using a syringe, draw the desired amount of bacteriostatic water (BAC water) or sterile water. A common amount is 1-2ml, depending on the desired concentration.</p>
              </div>
            </div>
            <div className="flex gap-4 items-start">
              <span className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center text-sm font-bold shrink-0">3</span>
              <div>
                <p className="font-medium">Add solvent to the peptide vial</p>
                <p className="text-sm text-text-secondary">Insert the needle into the peptide vial and <strong>slowly release the water along the inside wall</strong> of the vial. Do not squirt directly onto the powder — this can damage the peptide. Let the water trickle down gently.</p>
              </div>
            </div>
            <div className="flex gap-4 items-start">
              <span className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center text-sm font-bold shrink-0">4</span>
              <div>
                <p className="font-medium">Allow to dissolve</p>
                <p className="text-sm text-text-secondary">Let the vial sit for a few minutes. The peptide should dissolve on its own. <strong>Do not shake</strong> — gentle swirling is acceptable if needed. Shaking can denature the peptide and reduce its effectiveness.</p>
              </div>
            </div>
            <div className="flex gap-4 items-start">
              <span className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center text-sm font-bold shrink-0">5</span>
              <div>
                <p className="font-medium">Store properly</p>
                <p className="text-sm text-text-secondary">Once reconstituted, store the vial in the refrigerator (2-8°C). The solution is now ready for research use.</p>
              </div>
            </div>
          </div>
        </Animate>

        <Animate variant="fadeUp" delay={0.2}>
          <h2>Reconstitution Calculator</h2>
          <p>To calculate concentration after reconstitution:</p>
          <div className="bg-surface-elevated rounded-xl p-5 my-4 font-mono text-sm text-center">
            <strong>Concentration (mcg/unit)</strong> = Peptide Amount (mcg) &divide; Water Added (units)
          </div>
          <p className="text-sm text-text-secondary">
            <strong>Example:</strong> A 10mg (10,000mcg) peptide reconstituted with 2ml (200 units) of BAC water = 10,000 &divide; 200 = <strong>50mcg per unit</strong>.
          </p>
        </Animate>

        <Animate variant="fadeUp" delay={0.25}>
          <h2>Storage Guidelines</h2>
        </Animate>
        <Stagger className="grid sm:grid-cols-2 gap-4 my-6" stagger={0.06}>
          <div className="bg-surface rounded-xl border border-border p-5">
            <Snowflake className="w-5 h-5 text-blue-500 mb-3" />
            <h3 className="font-medium text-sm mb-1">Unreconstituted (Powder)</h3>
            <ul className="text-sm text-text-secondary space-y-1">
              <li>Freezer (-20°C): up to 24 months</li>
              <li>Refrigerator (2-8°C): up to 6 months</li>
              <li>Room temperature: up to 30 days</li>
            </ul>
          </div>
          <div className="bg-surface rounded-xl border border-border p-5">
            <Thermometer className="w-5 h-5 text-orange-500 mb-3" />
            <h3 className="font-medium text-sm mb-1">Reconstituted (Solution)</h3>
            <ul className="text-sm text-text-secondary space-y-1">
              <li>Refrigerator (2-8°C): up to 30 days (BAC water)</li>
              <li>Refrigerator (2-8°C): up to 48 hours (sterile water)</li>
              <li>Do not freeze reconstituted peptides</li>
            </ul>
          </div>
        </Stagger>

        <Animate variant="fadeUp" delay={0.3}>
          <h2>Best Practices</h2>
          <ul>
            <li>Always use sterile equipment and clean technique</li>
            <li>Avoid repeated freeze-thaw cycles for reconstituted peptides</li>
            <li>Keep peptides away from direct sunlight and heat</li>
            <li>Use BAC water over sterile water if the peptide will be used over multiple days</li>
            <li>Label reconstituted vials with the date and concentration</li>
            <li>Do not use a peptide solution that appears cloudy or discolored</li>
          </ul>
        </Animate>

        <Animate variant="fadeUp" delay={0.35}>
          <h2>Choosing a Solvent</h2>
          <table>
            <thead>
              <tr><th>Solvent</th><th>Best For</th><th>Shelf Life</th></tr>
            </thead>
            <tbody>
              <tr><td><strong>Bacteriostatic Water (BAC)</strong></td><td>Most peptides, multi-use vials</td><td>~30 days refrigerated</td></tr>
              <tr><td><strong>Sterile Water</strong></td><td>Single-use applications</td><td>~48 hours refrigerated</td></tr>
              <tr><td><strong>Acetic Acid (0.6%)</strong></td><td>Peptides with solubility issues (e.g., GHK-Cu)</td><td>~30 days refrigerated</td></tr>
            </tbody>
          </table>
          <p className="text-sm text-text-muted">
            ASCEND offers Acetic Acid in our <a href="/products" className="underline">store</a> for peptides that require it.
          </p>
        </Animate>
      </div>

      <Animate variant="fadeUp" delay={0.4}>
        <div className="mt-12 bg-surface rounded-xl border border-border p-6 text-center">
          <h3 className="font-display font-semibold mb-2">Need help?</h3>
          <p className="text-sm text-text-secondary mb-4">If you have questions about reconstitution or handling, our team is happy to help.</p>
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
