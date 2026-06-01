import type { Metadata } from 'next';

// Server-side fetch needs an absolute URL. NEXT_PUBLIC_API_URL is empty in prod
// (the browser uses the nginx-proxied relative /api), so fall back to the internal
// API origin — otherwise this fetch throws server-side and every product page
// inherits the parent /products canonical + generic title (breaks indexing).
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3105';
const BASE_URL = 'https://ascendpeptides.my';

interface Props {
  params: Promise<{ slug: string }>;
  children: React.ReactNode;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;

  try {
    const res = await fetch(`${API_URL}/api/v1/products/${slug}`, { next: { revalidate: 3600 } });
    // Even on failure, never let a product page canonicalize to /products.
    if (!res.ok) return { alternates: { canonical: `${BASE_URL}/products/${slug}` } };
    const product = await res.json();

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
  } catch {
    return { alternates: { canonical: `${BASE_URL}/products/${slug}` } };
  }
}

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
