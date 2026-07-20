import { absoluteImageUrl, isSaleActive, getEffectivePrice } from '@/lib/utils';

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
    description: 'Malaysia\'s #1 premium research peptides provider. Lab-grade Retatrutide, GHK-Cu, BPC-157, Tesamorelin and more with fast, free shipping across Peninsular Malaysia.',
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

interface ProductGroupVariantJsonLd {
  code: string;
  size?: string | null;
  price: number;
  salePrice?: number | null;
  saleStartsAt?: string | null;
  saleEndsAt?: string | null;
  imageUrl?: string | null;
  inStock: boolean;
}

interface ProductGroupJsonLdProps {
  name: string;
  description: string;
  slug: string;
  category: string;
  updatedAt: string;
  // Flat shipping fee in whole MYR (e.g. "10.0"), or empty/"0" for free —
  // mirrors the settings.shipping_fee value already used on-page.
  shippingFee: string;
  // One entry per active variant (size) — each becomes its own nested
  // Product/Offer under `hasVariant`, per Google's documented pattern for a
  // single product line sold in multiple sizes (variesBy: size).
  variants: ProductGroupVariantJsonLd[];
}

export function ProductGroupJsonLd({
  name,
  description,
  slug,
  category,
  updatedAt,
  shippingFee,
  variants,
}: ProductGroupJsonLdProps) {
  const url = `https://ascendpeptides.my/products/${slug}`;
  const freeShipping = !shippingFee || shippingFee === '0';

  const hasVariant = variants.map((v) => {
    // validFrom/priceValidUntil are Google's sale-duration markers (per their
    // own structured-data docs: validFrom "marks when a sale price becomes
    // active", priceValidUntil "marks when the sale price stops applying") —
    // not a general price-freshness signal. Both are recommended, not
    // required, so they're only emitted when a real sale is genuinely active,
    // using the real stored dates. No sale → omitted entirely rather than
    // fabricated, per Google's own guidance that omission has no eligibility
    // cost.
    const saleProduct = { price: v.price, salePrice: v.salePrice ?? null, saleStartsAt: v.saleStartsAt ?? null, saleEndsAt: v.saleEndsAt ?? null };
    const onSale = isSaleActive(saleProduct);
    const effectivePrice = getEffectivePrice(saleProduct);

    return {
      '@type': 'Product',
      sku: v.code,
      mpn: v.code,
      name: v.size ? `${name} ${v.size}` : name,
      // Relative uploaded-image paths must be absolute here — JSON-LD has no
      // base-URL resolution the way <img>/<Image> tags do. Falls back to the
      // brand icon until every SKU has real photography (tracked separately).
      image: absoluteImageUrl(v.imageUrl) || 'https://ascendpeptides.my/images/pill-icon-512.png',
      additionalProperty: v.size ? [{ '@type': 'PropertyValue', name: 'Size', value: v.size }] : [],
      offers: {
        '@type': 'Offer',
        price: (effectivePrice / 100).toFixed(2),
        priceCurrency: 'MYR',
        ...(onSale ? { validFrom: v.saleStartsAt, priceValidUntil: v.saleEndsAt } : {}),
        itemCondition: 'https://schema.org/NewCondition',
        availability: v.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        url,
        areaServed: { '@type': 'Country', name: 'Malaysia' },
        seller: { '@type': 'Organization', name: 'ASCEND' },
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
            // We don't ship to Sabah or Sarawak — see /shipping. Everything
            // else in MALAYSIAN_STATES (lib/constants.ts) is listed here.
            addressRegion: [
              'Johor', 'Kedah', 'Kelantan', 'Kuala Lumpur', 'Labuan', 'Melaka',
              'Negeri Sembilan', 'Pahang', 'Penang', 'Perak', 'Perlis',
              'Putrajaya', 'Selangor', 'Terengganu',
            ],
          },
          deliveryTime: {
            '@type': 'ShippingDeliveryTime',
            handlingTime: {
              '@type': 'QuantitativeValue',
              minValue: 1,
              maxValue: 2,
              unitCode: 'DAY',
            },
            // Sitewide conservative range covering both documented regional
            // bands (Klang Valley 1-2d, other Peninsular 2-4d) — see /shipping.
            // We don't ship to Sabah/Sarawak, so their 3-7d band isn't included.
            transitTime: {
              '@type': 'QuantitativeValue',
              minValue: 1,
              maxValue: 4,
              unitCode: 'DAY',
            },
          },
        },
      },
    };
  });

  const data = {
    '@context': 'https://schema.org',
    '@type': 'ProductGroup',
    name,
    description,
    url,
    productGroupID: slug,
    variesBy: ['https://schema.org/size'],
    category,
    dateModified: updatedAt,
    brand: {
      '@type': 'Brand',
      name: 'ASCEND',
    },
    additionalProperty: [
      { '@type': 'PropertyValue', name: 'Intended Use', value: 'Laboratory and research use only' },
      { '@type': 'PropertyValue', name: 'Third-party tested', value: 'Yes — Certificate of Analysis available' },
    ],
    hasVariant,
  };

  return <JsonLdScript data={data} />;
}
