import type { Metadata } from 'next';
import { ProductGroupJsonLd, BreadcrumbJsonLd } from '@/components/JsonLd';
import { getProductServer, getSettingsServer } from '@/lib/server-api';
import { absoluteImageUrl, getVariantDisplayName, getDefaultVariant, getEffectivePrice } from '@/lib/utils';

const BASE_URL = 'https://ascendpeptides.my';

interface Props {
  params: Promise<{ slug: string }>;
  children: React.ReactNode;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const [product, settings] = await Promise.all([getProductServer(slug), getSettingsServer()]);

  // Even on failure, never let a product page canonicalize to /products.
  if (!product) return { alternates: { canonical: `${BASE_URL}/products/${slug}` } };

  const variant = getDefaultVariant(product);
  // Multi-size pages get a "Name (10mg–30mg)" range title instead of being
  // named after just the lowest size — the page sells the whole line, and a
  // single-size title under-represents it in search results. Variants come
  // ordered cheapest-first from getDefaultVariant's price rule.
  const activeVariants = product.variants.filter((v) => v.active && v.size);
  const distinctSizes = [...new Set(activeVariants.slice().sort((a, b) => a.price - b.price).map((v) => v.size as string))];
  const fullName = distinctSizes.length > 1
    ? `${product.name} (${distinctSizes[0]}–${distinctSizes[distinctSizes.length - 1]})`
    : variant ? getVariantDisplayName(product, variant) : product.name;
  // With a size-range name the single price shown is the cheapest size's —
  // say "from RMx" so it doesn't read as the price of the whole range.
  const priceMyr = variant ? `${distinctSizes.length > 1 ? 'from ' : ''}RM${(getEffectivePrice(variant) / 100).toFixed(2)}` : '';
  const title = `${fullName} — Buy in Malaysia`;

  const shippingFee = settings.shipping_fee || '';
  const shippingClause = !shippingFee || shippingFee === '0' ? 'free fast shipping across Peninsular Malaysia' : 'fast shipping across Peninsular Malaysia';

  // Build a rich description (target ~120-160 chars). Use the product's own copy as the
  // lead when it's substantial; otherwise compose one with name + locale + price + shipping.
  const lead = product.description?.trim();
  const composed = `${lead && lead.length < 110 ? lead + ' ' : ''}Buy ${fullName} in Malaysia from ASCEND — lab-grade 99%+ purity, ${priceMyr}, ${shippingClause}.`;
  const full = lead && lead.length >= 110 ? lead : composed;
  const description = full.length > 160 ? full.slice(0, 157).trimEnd() + '…' : full;

  // Every product page needs a social preview image, even before real
  // per-product photography exists — fall back to the brand hero image
  // rather than leaving og:image/twitter:image unset (was previously
  // undefined for any product without an uploaded photo).
  const socialImage = absoluteImageUrl(variant?.imageUrl) || `${BASE_URL}/images/hero-vials.webp`;

  return {
    title,
    description,
    keywords: [
      `${product.name} malaysia`,
      `buy ${product.name} malaysia`,
      ...(variant ? [`${variant.code} peptide`] : []),
      `${product.name} peptide`,
      'peptides malaysia',
      'research peptides',
    ],
    alternates: { canonical: `${BASE_URL}/products/${slug}` },
    openGraph: {
      title: `${fullName} | ASCEND Peptides Malaysia`,
      description,
      url: `${BASE_URL}/products/${slug}`,
      images: [{ url: socialImage, alt: product.name }],
      type: 'website',
    },
    twitter: {
      card: 'summary',
      title: `${fullName} | ASCEND`,
      description,
      images: [socialImage],
    },
  };
}

export default async function ProductLayout({ params, children }: Props) {
  const { slug } = await params;
  const [product, settings] = await Promise.all([getProductServer(slug), getSettingsServer()]);
  const variant = product ? getDefaultVariant(product) : null;
  const fullName = product && variant ? getVariantDisplayName(product, variant) : product?.name ?? '';

  return (
    <>
      {product && variant && (
        <>
          <ProductGroupJsonLd
            name={product.name}
            description={product.description || `Premium ${product.name} research peptide from ASCEND Malaysia.`}
            slug={product.slug}
            category={product.category?.name || 'Research Peptides'}
            updatedAt={product.updatedAt}
            image={absoluteImageUrl(variant.imageUrl)}
            shippingFee={settings.shipping_fee || ''}
            variants={product.variants.filter((v) => v.active).map((v) => ({
              code: v.code,
              size: v.size,
              price: v.price,
              salePrice: v.salePrice,
              saleStartsAt: v.saleStartsAt,
              saleEndsAt: v.saleEndsAt,
              imageUrl: v.imageUrl,
              inStock: v.stock > 0,
            }))}
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
