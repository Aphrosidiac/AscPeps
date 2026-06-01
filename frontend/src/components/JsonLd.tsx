function JsonLdScript({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export function OrganizationJsonLd() {
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
    areaServed: {
      '@type': 'Country',
      name: 'Malaysia',
    },
    currenciesAccepted: 'MYR',
    paymentAccepted: 'Bank Transfer, FPX, Credit Card, Debit Card',
    priceRange: 'RM',
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
}

export function ProductJsonLd({ name, description, price, code, slug, imageUrl, inStock, category }: ProductJsonLdProps) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    description,
    sku: code,
    url: `https://ascendpeptides.my/products/${slug}`,
    image: imageUrl || 'https://ascendpeptides.my/images/pill-icon-512.png',
    category,
    brand: {
      '@type': 'Brand',
      name: 'ASCEND',
    },
    offers: {
      '@type': 'Offer',
      price: (price / 100).toFixed(2),
      priceCurrency: 'MYR',
      availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: `https://ascendpeptides.my/products/${slug}`,
      seller: {
        '@type': 'Organization',
        name: 'ASCEND',
      },
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
