import type { Metadata } from 'next';
import Script from 'next/script';
import { Inter, Outfit } from 'next/font/google';
import { CartProvider } from '@/lib/cart';
import { AnnouncementBar } from '@/components/layout/AnnouncementBar';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { WhatsAppButton } from '@/components/layout/WhatsAppButton';
import { OrganizationJsonLd, WebSiteJsonLd } from '@/components/JsonLd';
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
  metadataBase: new URL('https://ascendpeptides.my'),
  title: {
    default: 'ASCEND — #1 Premium Peptides Malaysia | Retatrutide, GHK-Cu, BPC-157',
    template: '%s | ASCEND Peptides Malaysia',
  },
  description: 'Malaysia\'s trusted source for premium research peptides. Buy Retatrutide, GHK-Cu, BPC-157, Tesamorelin, MOTS-c and more. Lab-grade quality, fast nationwide shipping. Number 1 peptides provider in Malaysia.',
  keywords: [
    'peptides malaysia',
    'buy peptides malaysia',
    'retatrutide malaysia',
    'reta malaysia',
    'reta peptides malaysia',
    'GHK-Cu malaysia',
    'BPC-157 malaysia',
    'tesamorelin malaysia',
    'MOTS-c malaysia',
    'research peptides malaysia',
    'peptide supplier malaysia',
    'premium peptides',
    'fat loss peptides malaysia',
    'anti aging peptides malaysia',
    'muscle growth peptides',
    'peptide shop malaysia',
    'buy reta malaysia',
    'AOD9604 malaysia',
    'HGH peptides malaysia',
    'IGF-1 malaysia',
  ],
  authors: [{ name: 'ASCEND' }],
  creator: 'ASCEND',
  publisher: 'ASCEND',
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'en_MY',
    url: 'https://ascendpeptides.my',
    siteName: 'ASCEND',
    title: 'ASCEND — #1 Premium Peptides Malaysia',
    description: 'Malaysia\'s trusted source for premium research peptides. Retatrutide, GHK-Cu, BPC-157 and more. Lab-grade quality with fast nationwide shipping.',
    images: [
      {
        url: '/images/pill-icon-512.png',
        width: 512,
        height: 512,
        alt: 'ASCEND Peptides Malaysia',
      },
    ],
  },
  twitter: {
    card: 'summary',
    title: 'ASCEND — #1 Premium Peptides Malaysia',
    description: 'Malaysia\'s trusted source for premium research peptides. Lab-grade quality with fast nationwide shipping.',
    images: ['/images/pill-icon-512.png'],
  },
  alternates: {
    canonical: 'https://ascendpeptides.my',
  },
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '48x48' },
      { url: '/favicon.png', sizes: '48x48', type: 'image/png' },
      { url: '/images/pill-icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/images/pill-icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/images/pill-icon-192.png',
  },
  verification: {},
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-MY" className={`${inter.variable} ${outfit.variable} h-full antialiased overflow-x-hidden`}>
      <body className="min-h-full flex flex-col bg-background text-text-primary font-body overflow-x-hidden">
        <OrganizationJsonLd />
        <WebSiteJsonLd />
        {/* Google Analytics 4 */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-4PHY1Z9BHD"
          strategy="afterInteractive"
        />
        <Script id="ga4" strategy="afterInteractive">
          {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'G-4PHY1Z9BHD');`}
        </Script>
        <CartProvider>
          <AnnouncementBar />
          <Navbar />
          <main className="flex-1">{children}</main>
          <Footer />
          <WhatsAppButton />
        </CartProvider>
      </body>
    </html>
  );
}
