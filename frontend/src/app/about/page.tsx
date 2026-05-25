import { FlaskConical, Shield, Truck, Clock } from 'lucide-react';
import { Animate, Stagger } from '@/components/ui/Animate';

export default function AboutPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <Animate variant="fadeUp" duration={0.6}>
        <div className="text-center mb-12">
          <h1 className="font-display text-4xl font-bold mb-4">About ASCEND</h1>
          <p className="text-lg text-text-secondary max-w-2xl mx-auto">
            We are a Malaysian-based provider of premium research peptides, committed to delivering lab-grade quality products with integrity and transparency.
          </p>
        </div>
      </Animate>

      <Stagger className="grid md:grid-cols-2 gap-8 mb-16" stagger={0.1}>
        <div className="bg-surface rounded-xl border border-border p-8">
          <FlaskConical className="w-8 h-8 mb-4 text-text-primary" />
          <h3 className="font-display font-semibold text-lg mb-2">Quality Assurance</h3>
          <p className="text-text-secondary text-sm leading-relaxed">
            Every product undergoes rigorous testing to ensure purity and potency. We source from verified manufacturers with established quality control processes.
          </p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-8">
          <Shield className="w-8 h-8 mb-4 text-text-primary" />
          <h3 className="font-display font-semibold text-lg mb-2">Discreet Packaging</h3>
          <p className="text-text-secondary text-sm leading-relaxed">
            Your privacy matters. All orders are shipped in plain, unmarked packaging with no indication of the contents.
          </p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-8">
          <Truck className="w-8 h-8 mb-4 text-text-primary" />
          <h3 className="font-display font-semibold text-lg mb-2">Nationwide Delivery</h3>
          <p className="text-text-secondary text-sm leading-relaxed">
            We ship across all states in Malaysia including Sabah and Sarawak. Track your order in real-time with your phone number.
          </p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-8">
          <Clock className="w-8 h-8 mb-4 text-text-primary" />
          <h3 className="font-display font-semibold text-lg mb-2">Responsive Support</h3>
          <p className="text-text-secondary text-sm leading-relaxed mb-3">
            Have questions? Reach out to us via WhatsApp for quick, knowledgeable support from our team.
          </p>
          <a
            href="https://wa.me/601161092723"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm font-medium text-green-700 hover:text-green-800 transition-colors"
          >
            +60 11-6109 2723
          </a>
        </div>
      </Stagger>

      <Animate variant="scale" duration={0.6}>
      <div className="bg-primary text-white rounded-xl p-8 text-center">
        <h2 className="font-display text-2xl font-bold mb-3">Ready to get started?</h2>
        <p className="text-neutral-300 mb-6">Browse our full range of premium research peptides.</p>
        <a href="/products" className="inline-flex items-center gap-2 bg-white text-primary font-medium px-6 py-3 rounded-lg hover:bg-neutral-100 transition-colors">
          Browse Products
        </a>
      </div>
      </Animate>
    </div>
  );
}
