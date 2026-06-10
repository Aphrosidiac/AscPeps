import type { Metadata } from 'next';
import Link from 'next/link';
import { FlaskConical, Shield, Truck, Clock, CheckCircle, Award, ArrowRight } from 'lucide-react';
import { Animate, Stagger } from '@/components/ui/Animate';

export const metadata: Metadata = {
  title: 'About ASCEND — Malaysia\'s Trusted Peptides Provider',
  description: 'ASCEND is Malaysia\'s trusted source for premium lab-grade research peptides. Quality assurance, discreet packaging, fast nationwide delivery, and responsive WhatsApp support.',
  keywords: ['about ASCEND', 'peptides provider malaysia', 'trusted peptides malaysia', 'lab grade peptides'],
  alternates: { canonical: 'https://ascendpeptides.my/about' },
  openGraph: {
    title: 'About ASCEND — Malaysia\'s Trusted Peptides Provider',
    description: 'Quality assurance, discreet packaging, fast nationwide delivery. Malaysia\'s trusted peptides source.',
    url: 'https://ascendpeptides.my/about',
  },
};

export default function AboutPage() {
  return (
    <div>
      {/* Hero */}
      <section className="bg-primary text-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
          <Animate variant="fadeUp" duration={0.6}>
            <p className="text-sm font-medium uppercase tracking-widest text-neutral-400 mb-4">About Us</p>
            <h1 className="font-display text-4xl md:text-5xl font-bold mb-6">
              Malaysia&apos;s Trusted Source for Research Peptides
            </h1>
            <p className="text-lg text-neutral-300 max-w-2xl mx-auto">
              We provide premium, lab-grade research peptides with 99%+ purity. Every batch is third-party tested and certified — because transparency isn&apos;t optional.
            </p>
          </Animate>
        </div>
      </section>

      {/* Stats */}
      <section className="border-b border-border">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <Stagger className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center" stagger={0.08}>
            <div>
              <p className="font-display text-3xl font-bold">99%+</p>
              <p className="text-sm text-text-secondary mt-1">Purity Guaranteed</p>
            </div>
            <div>
              <p className="font-display text-3xl font-bold">21+</p>
              <p className="text-sm text-text-secondary mt-1">Research Compounds</p>
            </div>
            <div>
              <p className="font-display text-3xl font-bold">Fast</p>
              <p className="text-sm text-text-secondary mt-1">Nationwide Delivery</p>
            </div>
            <div>
              <p className="font-display text-3xl font-bold">3rd Party</p>
              <p className="text-sm text-text-secondary mt-1">Verified & Tested</p>
            </div>
          </Stagger>
        </div>
      </section>

      {/* Why ASCEND */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <Animate variant="fadeUp">
          <h2 className="font-display text-2xl md:text-3xl font-bold text-center mb-4">Why ASCEND</h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-12">
            We built ASCEND because researchers in Malaysia deserve access to high-quality peptides without the guesswork.
          </p>
        </Animate>

        <Stagger className="grid md:grid-cols-2 gap-6" stagger={0.08}>
          <div className="icon-animate bg-surface rounded-xl border border-border p-7 hover:border-border-hover hover:shadow-sm transition-all duration-300">
            <FlaskConical className="w-7 h-7 mb-4 text-text-primary" />
            <h3 className="font-display font-semibold text-lg mb-2">Lab-Grade Quality</h3>
            <p className="text-text-secondary text-sm leading-relaxed">
              Every product undergoes rigorous testing to ensure purity and potency. We source exclusively from verified manufacturers with established quality control processes.
            </p>
          </div>
          <div className="icon-animate bg-surface rounded-xl border border-border p-7 hover:border-border-hover hover:shadow-sm transition-all duration-300">
            <Award className="w-7 h-7 mb-4 text-text-primary" />
            <h3 className="font-display font-semibold text-lg mb-2">Third-Party Verified</h3>
            <p className="text-text-secondary text-sm leading-relaxed">
              Every batch is independently tested by accredited laboratories. Certificates of Analysis are available for all products — full transparency from synthesis to delivery.
            </p>
          </div>
          <div className="icon-animate-shake bg-surface rounded-xl border border-border p-7 hover:border-border-hover hover:shadow-sm transition-all duration-300">
            <Shield className="w-7 h-7 mb-4 text-text-primary" />
            <h3 className="font-display font-semibold text-lg mb-2">Discreet Packaging</h3>
            <p className="text-text-secondary text-sm leading-relaxed">
              Your privacy matters. All orders are shipped in plain, unmarked packaging with no external branding or indication of contents.
            </p>
          </div>
          <div className="icon-animate-bounce bg-surface rounded-xl border border-border p-7 hover:border-border-hover hover:shadow-sm transition-all duration-300">
            <Truck className="w-7 h-7 mb-4 text-text-primary" />
            <h3 className="font-display font-semibold text-lg mb-2">Fast Nationwide Delivery</h3>
            <p className="text-text-secondary text-sm leading-relaxed">
              We ship across all states in Malaysia including Sabah and Sarawak. Track your order in real-time using your phone number.
            </p>
          </div>
        </Stagger>
      </section>

      {/* Our Promise */}
      <section className="bg-surface-elevated">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <Animate variant="fadeUp">
            <h2 className="font-display text-2xl md:text-3xl font-bold text-center mb-12">Our Promise</h2>
          </Animate>
          <Stagger className="grid sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6 md:gap-8" stagger={0.08}>
            <div className="text-center">
              <CheckCircle className="w-6 h-6 mx-auto mb-3 text-success" />
              <h3 className="font-semibold text-sm mb-1">Purity You Can Verify</h3>
              <p className="text-xs text-text-secondary">Every product comes with COA access so you never have to take our word for it.</p>
            </div>
            <div className="text-center">
              <CheckCircle className="w-6 h-6 mx-auto mb-3 text-success" />
              <h3 className="font-semibold text-sm mb-1">No Hidden Fees</h3>
              <p className="text-xs text-text-secondary">The price you see is the price you pay. No hidden fees, no surprises.</p>
            </div>
            <div className="text-center">
              <CheckCircle className="w-6 h-6 mx-auto mb-3 text-success" />
              <h3 className="font-semibold text-sm mb-1">Responsive Support</h3>
              <p className="text-xs text-text-secondary">Questions? Our team responds quickly via <a href="https://wa.me/601161092723" target="_blank" rel="noopener noreferrer" className="underline hover:text-text-primary">WhatsApp</a>.</p>
            </div>
            <div className="text-center">
              <CheckCircle className="w-6 h-6 mx-auto mb-3 text-success" />
              <h3 className="font-semibold text-sm mb-1">Cold Chain Shipping</h3>
              <p className="text-xs text-text-secondary">Temperature-sensitive products are packed with proper insulation to maintain integrity.</p>
            </div>
            <div className="text-center">
              <CheckCircle className="w-6 h-6 mx-auto mb-3 text-success" />
              <h3 className="font-semibold text-sm mb-1">Research-Grade Only</h3>
              <p className="text-xs text-text-secondary">All products are intended strictly for laboratory and research purposes only.</p>
            </div>
            <div className="text-center">
              <CheckCircle className="w-6 h-6 mx-auto mb-3 text-success" />
              <h3 className="font-semibold text-sm mb-1">Malaysia-Based</h3>
              <p className="text-xs text-text-secondary">Local team, local delivery, local support. No international shipping delays.</p>
            </div>
          </Stagger>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <Animate variant="scale" duration={0.6}>
          <div className="bg-primary text-white rounded-2xl p-10 text-center">
            <Clock className="w-8 h-8 mx-auto mb-4 text-neutral-400" />
            <h2 className="font-display text-2xl font-bold mb-3">Ready to get started?</h2>
            <p className="text-neutral-300 mb-8 max-w-md mx-auto">Browse our full catalog of premium research peptides or reach out to our team for guidance.</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/products" className="inline-flex items-center justify-center gap-2 bg-white text-primary font-medium px-6 py-3 rounded-lg hover:bg-neutral-100 transition-colors">
                Browse Products <ArrowRight className="w-4 h-4" />
              </Link>
              <a href="https://wa.me/601161092723" target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 border border-neutral-600 text-white font-medium px-6 py-3 rounded-lg hover:bg-white/10 transition-colors">
                WhatsApp Us
              </a>
            </div>
          </div>
        </Animate>
      </section>
    </div>
  );
}
