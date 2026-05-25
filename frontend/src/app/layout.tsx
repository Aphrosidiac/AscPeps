import type { Metadata } from 'next';
import { Inter, Outfit } from 'next/font/google';
import { CartProvider } from '@/lib/cart';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import './globals.css';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

const outfit = Outfit({
  variable: '--font-outfit',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: {
    default: 'ASCEND — Premium Peptides Malaysia',
    template: '%s | ASCEND',
  },
  description: 'Premium research peptides in Malaysia. GHK-Cu, Retatrutide, BPC-157, and more. Lab-grade quality with fast shipping.',
  openGraph: {
    type: 'website',
    siteName: 'ASCEND',
    title: 'ASCEND — Premium Peptides Malaysia',
    description: 'Premium research peptides in Malaysia. Lab-grade quality with fast shipping.',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${outfit.variable} h-full antialiased overflow-x-hidden`}>
      <body className="min-h-full flex flex-col bg-background text-text-primary font-body overflow-x-hidden">
        <CartProvider>
          <Navbar />
          <main className="flex-1">{children}</main>
          <Footer />
        </CartProvider>
      </body>
    </html>
  );
}
