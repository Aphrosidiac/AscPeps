export function OrganizationJsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'ASCEND',
    url: 'https://ascendpeptides.my',
    logo: 'https://ascendpeptides.my/images/pill-icon-512.png',
    description: 'Malaysia\'s #1 premium research peptides provider. Lab-grade Retatrutide, GHK-Cu, BPC-157, Tesamorelin and more with fast nationwide shipping.',
    address: {
      '@type': 'PostalAddress',
      addressCountry: 'MY',
    },
    contactPoint: {
      '@type': 'ContactPoint',
      telephone: '+60-11-6109-2723',
      contactType: 'customer service',
      availableLanguage: ['English', 'Malay'],
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
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
