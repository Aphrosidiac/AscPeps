import Link from 'next/link';
import { NewsletterForm } from '@/components/newsletter/NewsletterForm';

export function Footer() {
  return (
    <footer className="mt-auto w-full">
      {/* Research Disclaimer Banner */}
      <div className="bg-neutral-900 border-t border-neutral-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <p className="text-xs text-neutral-500 text-center leading-relaxed">
            All products sold by ASCEND are intended strictly for <strong className="text-neutral-400">laboratory and research purposes only</strong>. By purchasing from ASCEND, you agree to our{' '}
            <Link href="/terms" className="underline hover:text-neutral-300">Terms</Link>,{' '}
            <Link href="/disclaimer" className="underline hover:text-neutral-300">Disclaimer</Link>, and{' '}
            <Link href="/privacy" className="underline hover:text-neutral-300">Privacy Policy</Link>.
          </p>
        </div>
      </div>

      {/* Main Footer */}
      <div className="bg-primary text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
            <div className="col-span-2 md:col-span-1">
              <h3 className="font-display font-bold text-lg mb-3">ASCEND</h3>
              <p className="text-sm text-neutral-400 max-w-xs">
                Malaysia&apos;s trusted source for premium research peptides. 99%+ purity, third-party tested.
              </p>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-3 uppercase tracking-wider text-neutral-400">Shop</h4>
              <div className="space-y-2">
                <Link href="/products" className="block text-sm text-neutral-300 hover:text-white transition-colors">Products</Link>
                <Link href="/track" className="block text-sm text-neutral-300 hover:text-white transition-colors">Track Order</Link>
                <Link href="/about" className="block text-sm text-neutral-300 hover:text-white transition-colors">About</Link>
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-3 uppercase tracking-wider text-neutral-400">Resources</h4>
              <div className="space-y-2">
                <Link href="/faq" className="block text-sm text-neutral-300 hover:text-white transition-colors">FAQ</Link>
                <Link href="/guide" className="block text-sm text-neutral-300 hover:text-white transition-colors">Peptide Guide</Link>
                <Link href="/calculator" className="block text-sm text-neutral-300 hover:text-white transition-colors">Reconstitution Calculator</Link>
                <Link href="/coa" className="block text-sm text-neutral-300 hover:text-white transition-colors">Certificates of Analysis</Link>
                <Link href="/shipping" className="block text-sm text-neutral-300 hover:text-white transition-colors">Shipping Policy</Link>
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-3 uppercase tracking-wider text-neutral-400">Legal</h4>
              <div className="space-y-2">
                <Link href="/terms" className="block text-sm text-neutral-300 hover:text-white transition-colors">Terms & Conditions</Link>
                <Link href="/privacy" className="block text-sm text-neutral-300 hover:text-white transition-colors">Privacy Policy</Link>
                <Link href="/disclaimer" className="block text-sm text-neutral-300 hover:text-white transition-colors">Disclaimer</Link>
                <Link href="/return-policy" className="block text-sm text-neutral-300 hover:text-white transition-colors">Return Policy</Link>
                <a href="https://wa.me/601161092723" target="_blank" rel="noopener noreferrer" className="block text-sm text-neutral-300 hover:text-white transition-colors">WhatsApp &rarr;</a>
              </div>
            </div>
          </div>

          {/* The always-available capture point. The popup can be switched
              off, dismissed for a month, or blocked outright — this is the one
              a returning visitor can still find on purpose. */}
          <div
            id="newsletter"
            className="border-t border-neutral-800 mt-8 pt-8 grid gap-4 md:grid-cols-2 md:items-center scroll-mt-24"
          >
            <div>
              <h4 className="font-semibold text-sm uppercase tracking-wider text-neutral-400">
                Restock &amp; research updates
              </h4>
              <p className="mt-1 text-sm text-neutral-400 max-w-sm">
                New batch COAs, restocks, and the occasional piece worth reading. No spam.
              </p>
            </div>
            <NewsletterForm source="FOOTER" ctaLabel="Subscribe" tone="dark" />
          </div>

          <div className="border-t border-neutral-800 mt-8 pt-8 text-center text-sm text-neutral-500">
            &copy; {new Date().getFullYear()} ASCEND. All rights reserved.
          </div>
        </div>
      </div>
    </footer>
  );
}
