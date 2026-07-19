import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ShieldCheck, ExternalLink } from 'lucide-react';
import { getProductServer, getProductsServer, getSettingsServer } from '@/lib/server-api';
import { getDefaultVariant } from '@/lib/utils';
import { Animate } from '@/components/ui/Animate';
import { ProductRail } from '@/components/products/ProductRail';
import { ProductReconstitutionSummary } from '@/components/guide/ProductReconstitutionSummary';
import {
  getRelatedProducts,
  getPairedSupplies,
  needsReconstitutionGuide,
  getRecommendedSolvent,
} from '@/lib/product-relations';
import { VariantSwitcher } from './VariantSwitcher';

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function ProductDetailPage({ params }: Props) {
  const { slug } = await params;
  const product = await getProductServer(slug);
  if (!product) notFound();

  const [settings, catalog] = await Promise.all([getSettingsServer(), getProductsServer({ limit: 100 })]);
  const shippingFee = settings.shipping_fee || '';
  const allProducts = catalog.data;

  const shownIds = new Set([product.id]);
  const relatedProducts = getRelatedProducts(product, allProducts, shownIds);
  relatedProducts.forEach((p) => shownIds.add(p.id));
  const pairedSupplies = getPairedSupplies(product, allProducts, shownIds);

  let benefits: string[] = [];
  try {
    if (product.benefits) benefits = JSON.parse(product.benefits);
  } catch {}

  const defaultVariant = getDefaultVariant(product);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Link href="/products" className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary mb-8 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Products
      </Link>

      <VariantSwitcher product={product} benefits={benefits} shippingFee={shippingFee} />

      {/* Dosage / research information */}
      {product.dosageInfo && (
        <Animate variant="fadeUp" delay={0.2}>
          <div className="mt-10 bg-surface rounded-xl border border-border p-6">
            <h2 className="font-display font-semibold text-lg mb-2">Research &amp; Reconstitution Information</h2>
            <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-line">{product.dosageInfo}</p>
          </div>
        </Animate>
      )}

      {/* Certificate of Analysis */}
      {product.coaUrl && (
        <Animate variant="fadeUp" delay={0.25}>
          <div className="mt-6 bg-surface rounded-xl border border-border p-6">
            <h2 className="font-display font-semibold text-lg mb-2">Certificate of Analysis</h2>
            <p className="text-sm text-text-secondary mb-4">
              All products are independently tested by accredited third-party laboratories. Results confirm identity, purity, and potency.
            </p>
            <a
              href={product.coaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-surface-elevated hover:bg-border rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
            >
              <ShieldCheck className="w-4 h-4" />
              Batch COA — {product.name}{defaultVariant?.size ? ` ${defaultVariant.size}` : ''}
              <ExternalLink className="w-3.5 h-3.5 text-text-muted" />
            </a>
          </div>
        </Animate>
      )}

      {needsReconstitutionGuide(product) && (
        <Animate variant="fadeUp" delay={0.28}>
          <ProductReconstitutionSummary solvent={getRecommendedSolvent(product)} />
        </Animate>
      )}

      <ProductRail
        title="Frequently Paired With"
        products={pairedSupplies}
        delay={0.32}
      />

      <ProductRail
        title="Related Products"
        subtitle={`More from ${product.category.name}`}
        products={relatedProducts}
        delay={0.35}
      />
    </div>
  );
}
