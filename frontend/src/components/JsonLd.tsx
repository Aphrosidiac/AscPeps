import { absoluteImageUrl, isSaleActive, getEffectivePrice } from '@/lib/utils';
import { eastFeeDiffers } from '@/lib/shipping-region';

// Shared single escaping point for every JSON-LD emission on the site.
// JSON.stringify alone is NOT safe inside a <script> tag: a stored value
// containing "</script>" would terminate the block and inject markup
// (stored XSS). Escaping "<" as < is valid JSON and defuses it.
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
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
    name: 'Ascend MY',
    alternateName: 'Ascend Peptides Malaysia',
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

  return <JsonLd data={data} />;
}

export function WebSiteJsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': 'https://ascendpeptides.my/#website',
    name: 'Ascend Peptides Malaysia',
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

  return <JsonLd data={data} />;
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

  return <JsonLd data={data} />;
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

  return <JsonLd data={data} />;
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
  // Absolute URL of the default variant's image — gives the ProductGroup
  // itself an image instead of leaving that only on the nested variants.
  image?: string | null;
  // Flat shipping fee in whole MYR (e.g. "10.0"), or empty/"0" for free —
  // mirrors the settings.shipping_fee value already used on-page. Applies to
  // Peninsular Malaysia.
  shippingFee: string;
  // Shipping fee in whole MYR for Sabah, Sarawak and Labuan. Empty means those
  // states pay `shippingFee` — the same fallback the checkout and the server
  // use — in which case no separate shipping entry is emitted for them.
  eastShippingFee?: string;
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
  image,
  shippingFee,
  eastShippingFee,
  variants,
}: ProductGroupJsonLdProps) {
  const url = `https://ascendpeptides.my/products/${slug}`;
  const freeShipping = !shippingFee || shippingFee === '0';

  // Peninsular Malaysia and East Malaysia are declared as two separate
  // OfferShippingDetails rather than one widened entry. They genuinely differ
  // on both axes — rate and transit time — and merging them would have to
  // publish the worse of each: East Malaysia's fee on Klang Valley orders, or
  // a 1-7 day band that makes Peninsular delivery look slower than it is.
  // Both are what /shipping states in prose; keep the two in step.
  const EAST_REGIONS = ['Sabah', 'Sarawak', 'Labuan'];
  const PENINSULAR_REGIONS = [
    'Johor', 'Kedah', 'Kelantan', 'Kuala Lumpur', 'Melaka', 'Negeri Sembilan',
    'Pahang', 'Penang', 'Perak', 'Perlis', 'Putrajaya', 'Selangor', 'Terengganu',
  ];
  const shippingEntry = (rate: string, regions: string[], minTransit: number, maxTransit: number) => ({
    '@type': 'OfferShippingDetails',
    shippingRate: { '@type': 'MonetaryAmount', value: rate, currency: 'MYR' },
    shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'MY', addressRegion: regions },
    deliveryTime: {
      '@type': 'ShippingDeliveryTime',
      handlingTime: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 2, unitCode: 'DAY' },
      transitTime: { '@type': 'QuantitativeValue', minValue: minTransit, maxValue: maxTransit, unitCode: 'DAY' },
    },
  });
  // A blank East fee means those states pay the standard rate, so they simply
  // join the Peninsular entry rather than getting one of their own. The
  // RM600 minimum is deliberately not expressed here: schema.org has no field
  // for a region-scoped minimum order, and inventing one would be noise.
  const shippingDetails = eastFeeDiffers(shippingFee, eastShippingFee)
    ? [
        shippingEntry(freeShipping ? '0' : shippingFee, PENINSULAR_REGIONS, 1, 4),
        shippingEntry(eastShippingFee!, EAST_REGIONS, 3, 7),
      ]
    : shippingEntry(freeShipping ? '0' : shippingFee, [...PENINSULAR_REGIONS, ...EAST_REGIONS], 1, 7);

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
        seller: { '@type': 'Organization', name: 'Ascend MY' },
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
        shippingDetails,
      },
    };
  });

  const data = {
    '@context': 'https://schema.org',
    '@type': 'ProductGroup',
    name,
    description,
    // Same fallback chain as the nested variants: real photo, else brand icon.
    image: image || 'https://ascendpeptides.my/images/pill-icon-512.png',
    url,
    productGroupID: slug,
    variesBy: ['https://schema.org/size'],
    category,
    dateModified: updatedAt,
    brand: {
      '@type': 'Brand',
      name: 'Ascend MY',
    },
    additionalProperty: [
      { '@type': 'PropertyValue', name: 'Intended Use', value: 'Laboratory and research use only' },
      { '@type': 'PropertyValue', name: 'Third-party tested', value: 'Yes — Certificate of Analysis available' },
    ],
    hasVariant,
  };

  return <JsonLd data={data} />;
}
