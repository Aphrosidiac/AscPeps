import type { Metadata } from 'next';
import { ProductJsonLd, BreadcrumbJsonLd } from '@/components/JsonLd';

// Server-side fetch needs an absolute URL. NEXT_PUBLIC_API_URL is empty in prod
// (the browser uses the nginx-proxied relative /api), so fall back to the internal
// API origin — otherwise this fetch throws server-side and every product page
// inherits the parent /products canonical + generic title (breaks indexing).
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3105';
const BASE_URL = 'https://ascendpeptides.my';

interface ProductData {
  name: string;
  size?: string | null;
  description?: string | null;
  price: number;
  code: string;
  slug: string;
  imageUrl?: string | null;
  stock?: number;
  category?: { name?: string } | null;
}

interface Props {
  params: Promise<{ slug: string }>;
  children: React.ReactNode;
}

async function fetchProduct(slug: string): Promise<ProductData | null> {
  try {
    const res = await fetch(`${API_URL}/api/v1/products/${slug}`, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    return (await res.json()) as ProductData;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = await fetchProduct(slug);

  // Even on failure, never let a product page canonicalize to /products.
  if (!product) return { alternates: { canonical: `${BASE_URL}/products/${slug}` } };

  const title = `${product.name} ${product.size || ''} — Buy in Malaysia`.trim();
  const description = product.description || `Buy ${product.name} ${product.size || ''} online in Malaysia. Lab-grade quality from ASCEND. RM${(product.price / 100).toFixed(2)}. Fast nationwide shipping.`;

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
      title: `${product.name} ${product.size || ''} | ASCEND Peptides Malaysia`,
      description,
      url: `${BASE_URL}/products/${slug}`,
      images: product.imageUrl ? [{ url: product.imageUrl, alt: product.name }] : undefined,
      type: 'website',
    },
    twitter: {
      card: 'summary',
      title: `${product.name} ${product.size || ''} | ASCEND`,
      description,
    },
  };
}

export default async function ProductLayout({ params, children }: Props) {
  const { slug } = await params;
  const product = await fetchProduct(slug);
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
