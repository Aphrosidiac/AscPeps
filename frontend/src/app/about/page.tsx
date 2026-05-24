import { FlaskConical, Shield, Truck, Clock } from 'lucide-react';

export default function AboutPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <div className="text-center mb-12">
        <h1 className="font-display text-4xl font-bold mb-4">About ASCEND</h1>
        <p className="text-lg text-text-secondary max-w-2xl mx-auto">
          We are a Malaysian-based provider of premium research peptides, committed to delivering lab-grade quality products with integrity and transparency.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-8 mb-16">
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
          <p className="text-text-secondary text-sm leading-relaxed">
            Have questions? Reach out to us via WhatsApp for quick, knowledgeable support from our team.
          </p>
        </div>
      </div>

      <div className="bg-primary text-white rounded-xl p-8 text-center">
        <h2 className="font-display text-2xl font-bold mb-3">Ready to get started?</h2>
        <p className="text-neutral-300 mb-6">Browse our full range of premium research peptides.</p>
        <a href="/products" className="inline-flex items-center gap-2 bg-white text-primary font-medium px-6 py-3 rounded-lg hover:bg-neutral-100 transition-colors">
          Browse Products
        </a>
      </div>
    </div>
  );
}
