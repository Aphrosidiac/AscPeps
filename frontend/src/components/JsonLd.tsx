import { absoluteImageUrl } from '@/lib/utils';

function JsonLdScript({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

interface OrganizationJsonLdProps {
  // Real "RM10 - RM420"-style range computed from live catalog min/max.
  // Previously hardcoded to the bare string "RM", which conveys no actual
  // range — omit the field entirely rather than ship a malformed value if
  // the caller doesn't have current price data.
  priceRange?: string;
}

export function OrganizationJsonLd({ priceRange }: OrganizationJsonLdProps = {}) {
  const data = {
    '@context': 'https://schema.org',
    '@type': ['Organization', 'OnlineStore'],
    '@id': 'https://ascendpeptides.my/#organization',
    name: 'ASCEND',
    alternateName: 'ASCEND Peptides Malaysia',
    url: 'https://ascendpeptides.my',
    logo: 'https://ascendpeptides.my/images/pill-icon-512.png',
    image: 'https://ascendpeptides.my/images/pill-icon-512.png',
    description: 'Malaysia\'s #1 premium research peptides provider. Lab-grade Retatrutide, GHK-Cu, BPC-157, Tesamorelin and more with fast, free nationwide shipping.',
    sameAs: [
      'https://www.tiktok.com/@ascendpeptidesmy',
    ],
    areaServed: {
      '@type': 'Country',
      name: 'Malaysia',
    },
    currenciesAccepted: 'MYR',
    paymentAccepted: 'Bank Transfer, FPX, Credit Card, Debit Card',
    ...(priceRange ? { priceRange } : {}),
    address: {
      '@type': 'PostalAddress',
      addressCountry: 'MY',
    },
    contactPoint: {
      '@type': 'ContactPoint',
      telephone: '+60-11-6109-2723',
      contactType: 'customer service',
      availableLanguage: ['English', 'Malay'],
      areaServed: 'MY',
    },
  };

  return <JsonLdScript data={data} />;
}

export function WebSiteJsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': 'https://ascendpeptides.my/#website',
    name: 'ASCEND Peptides Malaysia',
    url: 'https://ascendpeptides.my',
    inLanguage: 'en-MY',
    publisher: { '@id': 'https://ascendpeptides.my/#organization' },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: 'https://ascendpeptides.my/products?search={search_term_string}',
      },
      'query-input': 'required name=search_term_string',
    },
  };

  return <JsonLdScript data={data} />;
}

export function FaqJsonLd({ items }: { items: { q: string; a: string }[] }) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.a,
      },
    })),
  };

  return <JsonLdScript data={data} />;
}

export function BreadcrumbJsonLd({ items }: { items: { name: string; url: string }[] }) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };

  return <JsonLdScript data={data} />;
}

interface ProductJsonLdProps {
  name: string;
  description: string;
  price: number;
  code: string;
  slug: string;
  imageUrl?: string | null;
  inStock: boolean;
  category: string;
  size?: string | null;
  updatedAt: string;
  // Flat shipping fee in whole MYR (e.g. "10.0"), or empty/"0" for free —
  // mirrors the settings.shipping_fee value already used on-page.
  shippingFee: string;
}

export function ProductJsonLd({
  name,
  description,
  price,
  code,
  slug,
  imageUrl,
  inStock,
  category,
  size,
  updatedAt,
  shippingFee,
}: ProductJsonLdProps) {
  const additionalProperty = [
    ...(size ? [{ '@type': 'PropertyValue', name: 'Size', value: size }] : []),
    { '@type': 'PropertyValue', name: 'Intended Use', value: 'Laboratory and research use only' },
    { '@type': 'PropertyValue', name: 'Third-party tested', value: 'Yes — Certificate of Analysis available' },
  ];

  const freeShipping = !shippingFee || shippingFee === '0';

  // Google-recommended (not required) price-freshness signal — a rolling
  // 90-day window from render time, refreshed on every ISR revalidation.
  const priceValidUntil = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const data = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    description,
    sku: code,
    mpn: code,
    url: `https://ascendpeptides.my/products/${slug}`,
    // Relative uploaded-image paths must be absolute here — JSON-LD has no
    // base-URL resolution the way <img>/<Image> tags do. Falls back to the
    // brand icon until every SKU has real photography (tracked separately).
    image: absoluteImageUrl(imageUrl) || 'https://ascendpeptides.my/images/pill-icon-512.png',
    category,
    dateModified: updatedAt,
    brand: {
      '@type': 'Brand',
      name: 'ASCEND',
    },
    additionalProperty,
    offers: {
      '@type': 'Offer',
      price: (price / 100).toFixed(2),
      priceCurrency: 'MYR',
      priceValidUntil,
      itemCondition: 'https://schema.org/NewCondition',
      availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: `https://ascendpeptides.my/products/${slug}`,
      areaServed: { '@type': 'Country', name: 'Malaysia' },
      seller: {
        '@type': 'Organization',
        name: 'ASCEND',
      },
      // Matches Terms & Conditions §7: no returns/refunds once shipped,
      // except transit damage or wrong item — that's a fulfillment-error
      // guarantee, not a general buyer's-remorse return window, so
      // NotPermitted is the accurate category rather than a fabricated
      // return-days figure.
      hasMerchantReturnPolicy: {
        '@type': 'MerchantReturnPolicy',
        applicableCountry: 'MY',
        returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted',
      },
      shippingDetails: {
        '@type': 'OfferShippingDetails',
        shippingRate: {
          '@type': 'MonetaryAmount',
          value: freeShipping ? '0' : shippingFee,
          currency: 'MYR',
        },
        shippingDestination: {
          '@type': 'DefinedRegion',
          addressCountry: 'MY',
        },
        deliveryTime: {
          '@type': 'ShippingDeliveryTime',
          handlingTime: {
            '@type': 'QuantitativeValue',
            minValue: 1,
            maxValue: 2,
            unitCode: 'DAY',
          },
          // Sitewide conservative range covering all three documented
          // regional bands (Klang Valley 1-2d, other Peninsular 2-4d,
          // Sabah/Sarawak 3-7d) — see /shipping.
          transitTime: {
            '@type': 'QuantitativeValue',
            minValue: 1,
            maxValue: 7,
            unitCode: 'DAY',
          },
        },
      },
    },
  };

  return <JsonLdScript data={data} />;
}
