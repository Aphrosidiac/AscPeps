import Link from 'next/link';

export function Footer() {
  return (
    <footer className="bg-primary text-white mt-auto w-full">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-8">
          <div className="col-span-2 md:col-span-1">
            <h3 className="font-display font-bold text-lg mb-3">ASCEND</h3>
            <p className="text-sm text-neutral-400 max-w-xs">
              Premium research peptides in Malaysia. Lab-grade quality with fast nationwide shipping.
            </p>
          </div>

          <div>
            <h4 className="font-semibold text-sm mb-3 uppercase tracking-wider text-neutral-400">Quick Links</h4>
            <div className="space-y-2">
              <Link href="/products" className="block text-sm text-neutral-300 hover:text-white transition-colors">Products</Link>
              <Link href="/track" className="block text-sm text-neutral-300 hover:text-white transition-colors">Track Order</Link>
              <Link href="/about" className="block text-sm text-neutral-300 hover:text-white transition-colors">About</Link>
            </div>
          </div>

          <div>
            <h4 className="font-semibold text-sm mb-3 uppercase tracking-wider text-neutral-400">Contact</h4>
            <p className="text-sm text-neutral-300 mb-3">
              WhatsApp us for inquiries and support.
            </p>
            <a
              href="https://wa.me/601161092723"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-white bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg transition-colors"
            >
              +60 11-6109 2723
            </a>
          </div>
        </div>

        <div className="border-t border-neutral-800 mt-8 pt-8 text-center text-sm text-neutral-500">
          &copy; {new Date().getFullYear()} ASCEND. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
