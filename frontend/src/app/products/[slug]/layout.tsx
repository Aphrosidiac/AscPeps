import type { Metadata } from 'next';
import { ProductJsonLd, BreadcrumbJsonLd } from '@/components/JsonLd';
import { getProductServer } from '@/lib/server-api';

const BASE_URL = 'https://ascendpeptides.my';

interface Props {
  params: Promise<{ slug: string }>;
  children: React.ReactNode;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductServer(slug);

  // Even on failure, never let a product page canonicalize to /products.
  if (!product) return { alternates: { canonical: `${BASE_URL}/products/${slug}` } };

  const sizePart = product.size ? ` ${product.size}` : '';
  const priceMyr = `RM${(product.price / 100).toFixed(2)}`;
  const title = `${product.name}${sizePart} — Buy in Malaysia`;

  // Build a rich description (target ~120-160 chars). Use the product's own copy as the
  // lead when it's substantial; otherwise compose one with name + locale + price + shipping.
  const lead = product.description?.trim();
  const composed = `${lead && lead.length < 110 ? lead + ' ' : ''}Buy ${product.name}${sizePart} in Malaysia from ASCEND — lab-grade 99%+ purity, ${priceMyr}, free fast nationwide shipping.`;
  const full = lead && lead.length >= 110 ? lead : composed;
  const description = full.length > 160 ? full.slice(0, 157).trimEnd() + '…' : full;

  return {
    title,
    description,
    keywords: [
      `${product.name} malaysia`,
      `buy ${product.name} malaysia`,
      `${product.code} peptide`,
      `${product.name} peptide`,
      'peptides malaysia',
      'research peptides',
    ],
    alternates: { canonical: `${BASE_URL}/products/${slug}` },
    openGraph: {
      title: `${product.name}${sizePart} | ASCEND Peptides Malaysia`,
      description,
      url: `${BASE_URL}/products/${slug}`,
      images: product.imageUrl ? [{ url: product.imageUrl, alt: product.name }] : undefined,
      type: 'website',
    },
    twitter: {
      card: 'summary',
      title: `${product.name}${sizePart} | ASCEND`,
      description,
    },
  };
}

export default async function ProductLayout({ params, children }: Props) {
  const { slug } = await params;
  const product = await getProductServer(slug);
  const fullName = product ? `${product.name}${product.size ? ` ${product.size}` : ''}` : '';

  return (
    <>
      {product && (
        <>
          <ProductJsonLd
            name={fullName}
            description={product.description || `Premium ${product.name} research peptide from ASCEND Malaysia.`}
            price={product.price}
            code={product.code}
            slug={product.slug}
            imageUrl={product.imageUrl}
            inStock={(product.stock ?? 0) > 0}
            category={product.category?.name || 'Research Peptides'}
          />
          <BreadcrumbJsonLd
            items={[
              { name: 'Home', url: BASE_URL },
              { name: 'Products', url: `${BASE_URL}/products` },
              { name: product.name, url: `${BASE_URL}/products/${product.slug}` },
            ]}
          />
        </>
      )}
      {children}
    </>
  );
}
