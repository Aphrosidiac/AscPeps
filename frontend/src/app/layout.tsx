import type { Metadata } from 'next';
import Script from 'next/script';
import { Inter, Outfit } from 'next/font/google';
import { CartProvider } from '@/lib/cart';
import { SiteChrome } from '@/components/layout/SiteChrome';
import { OrganizationJsonLd, WebSiteJsonLd } from '@/components/JsonLd';
import { PostHogPageView } from '@/components/PostHogPageView';
import { getSettingsServer, getProductsServer } from '@/lib/server-api';
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
  description: 'Malaysia\'s trusted source for premium research peptides. Buy Retatrutide, GHK-Cu, BPC-157, Tesamorelin, MOTS-c and more. Lab-grade quality, fast shipping across Peninsular Malaysia. Number 1 peptides provider in Malaysia.',
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
    description: 'Malaysia\'s trusted source for premium research peptides. Retatrutide, GHK-Cu, BPC-157 and more. Lab-grade quality with fast shipping across Peninsular Malaysia.',
    images: [
      {
        url: '/images/og-image.png',
        width: 1200,
        height: 630,
        alt: 'ASCEND — Premium Research Peptides in Malaysia',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ASCEND — #1 Premium Peptides Malaysia',
    description: 'Malaysia\'s trusted source for premium research peptides. Lab-grade quality with fast shipping across Peninsular Malaysia.',
    images: ['/images/og-image.png'],
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [settings, catalog] = await Promise.all([getSettingsServer(), getProductsServer({ limit: 100 })]);
  const announcementEnabled = settings.announcement_enabled === 'true' && !!settings.announcement_text;

  // Real min-max price range for Organization.priceRange, computed from the
  // live catalog rather than a hardcoded placeholder.
  const prices = catalog.data.flatMap((p) => p.variants.filter((v) => v.active).map((v) => v.price));
  const priceRange =
    prices.length > 0
      ? `RM${Math.min(...prices) / 100} - RM${Math.max(...prices) / 100}`
      : undefined;

  return (
    <html lang="en-MY" className={`${inter.variable} ${outfit.variable} h-full antialiased overflow-x-hidden`}>
      <body className="min-h-full flex flex-col bg-background text-text-primary font-body overflow-x-hidden">
        <OrganizationJsonLd priceRange={priceRange} />
        <WebSiteJsonLd />
        {/* Preconnect to GA4's origins — cuts DNS+TCP+TLS handshake time off
            the critical path for a request that fires on every page load. */}
        <link rel="preconnect" href="https://www.googletagmanager.com" />
        <link rel="preconnect" href="https://www.google-analytics.com" />
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
        {/* PostHog's automatic $pageview is suppressed by this project's
            remote config — see the component. Renders nothing. */}
        <PostHogPageView />
        <CartProvider>
          <SiteChrome
            announcementEnabled={announcementEnabled}
            announcementText={settings.announcement_text || ''}
            newsletterPopupEnabled={settings.newsletter_popup_enabled === 'true'}
            newsletterPopupHeading={settings.newsletter_popup_heading || 'Reconstitution reference, free'}
            newsletterPopupBody={
              settings.newsletter_popup_body ||
              'Dosing calculator, storage and handling guide, and batch COAs — plus a note when something is back in stock.'
            }
          >
            {children}
          </SiteChrome>
        </CartProvider>
      </body>
    </html>
  );
}
