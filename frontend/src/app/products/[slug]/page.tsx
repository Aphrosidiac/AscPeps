import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { ArrowLeft, Check, ShieldCheck, ExternalLink, Truck } from 'lucide-react';
import { getProductServer, getSettingsServer } from '@/lib/server-api';
import { formatPrice, getFullProductName } from '@/lib/utils';
import { Animate } from '@/components/ui/Animate';
import { AddToCartPanel } from './AddToCartPanel';

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function ProductDetailPage({ params }: Props) {
  const { slug } = await params;
  const product = await getProductServer(slug);
  if (!product) notFound();

  const settings = await getSettingsServer();
  const shippingFee = settings.shipping_fee || '';

  let benefits: string[] = [];
  try {
    if (product.benefits) benefits = JSON.parse(product.benefits);
  } catch {}

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Link href="/products" className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary mb-8 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Products
      </Link>

      <div className="grid md:grid-cols-2 gap-6 md:gap-8">
        <Animate variant="fade" duration={0.6}>
          <div className="relative aspect-square bg-surface-elevated rounded-xl border border-border flex items-center justify-center overflow-hidden">
            {product.imageUrl ? (
              <Image
                src={product.imageUrl}
                alt={`${getFullProductName(product)} — research peptide available in Malaysia`}
                fill
                sizes="(min-width: 768px) 50vw, 100vw"
                priority
                className="object-cover"
              />
            ) : (
              <span className="text-6xl font-display font-bold text-text-muted/20 select-none">{product.code}</span>
            )}
          </div>
        </Animate>

        <Animate variant="fadeUp" delay={0.15} duration={0.6}>
          <div className="space-y-6">
            <div>
              <p className="text-sm text-text-muted font-medium uppercase tracking-wider mb-1">{product.category.name}</p>
              <h1 className="font-display text-3xl font-bold">{product.name}</h1>
              {product.size && !product.name.toLowerCase().includes(product.size.trim().toLowerCase()) && (
                <p className="text-text-secondary mt-1">{product.size}</p>
              )}
            </div>

            <p className="font-display text-3xl font-bold">{formatPrice(product.price)}</p>

            {product.description && (
              <p className="text-text-secondary leading-relaxed">{product.description}</p>
            )}

            {benefits.length > 0 && (
              <div>
                <h2 className="font-display font-semibold mb-3 text-base">Benefits</h2>
                <ul className="space-y-2">
                  {benefits.map((b, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                      <Check className="w-4 h-4 text-success mt-0.5 shrink-0" />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <AddToCartPanel
              productId={product.id}
              code={product.code}
              name={product.name}
              size={product.size}
              price={product.price}
              imageUrl={product.imageUrl}
              stock={product.stock}
            />

            {product.stock === 0 && <p className="text-danger font-medium">Out of stock</p>}
            {product.stock > 0 && product.stock <= 5 && <p className="text-warning text-sm">Only {product.stock} left in stock</p>}

            <p className="text-xs text-text-muted italic">For research and laboratory use only.</p>

            {/* Trust Badges */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="flex items-center gap-2.5 bg-surface-elevated rounded-lg px-3 py-2.5">
                <ShieldCheck className="w-4 h-4 text-text-muted shrink-0" />
                <div>
                  <p className="text-xs font-semibold">3rd Party Verified</p>
                  <p className="text-[11px] text-text-muted">Identity & purity tested</p>
                </div>
              </div>
              <div className="flex items-center gap-2.5 bg-surface-elevated rounded-lg px-3 py-2.5">
                <Truck className="w-4 h-4 text-text-muted shrink-0" />
                <div>
                  <p className="text-xs font-semibold">
                    {!shippingFee || shippingFee === '0' ? 'Free Shipping' : `Shipping: RM${shippingFee}`}
                  </p>
                  <p className="text-[11px] text-text-muted">
                    {!shippingFee || shippingFee === '0' ? 'All orders, nationwide' : 'Nationwide delivery'}
                  </p>
                </div>
              </div>
            </div>

            <p className="text-xs text-text-muted">Product Code: {product.code}</p>
          </div>
        </Animate>
      </div>

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
              Batch COA — {getFullProductName(product)}
              <ExternalLink className="w-3.5 h-3.5 text-text-muted" />
            </a>
          </div>
        </Animate>
      )}
    </div>
  );
}
