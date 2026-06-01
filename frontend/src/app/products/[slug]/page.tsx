'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ShoppingCart, ArrowLeft, Check, ShieldCheck, ExternalLink, Truck } from 'lucide-react';
import { getProduct, getSettings } from '@/lib/api';
import { useCart } from '@/lib/cart';
import { formatPrice } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Animate } from '@/components/ui/Animate';
import { ProductJsonLd, BreadcrumbJsonLd } from '@/components/JsonLd';
import type { Product } from '@/types';

export default function ProductDetailPage() {
  const params = useParams();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const [shippingFee, setShippingFee] = useState<string>('');
  const { addItem } = useCart();

  useEffect(() => {
    if (params.slug) {
      getProduct(params.slug as string)
        .then(setProduct)
        .catch(() => {})
        .finally(() => setLoading(false));
    }
    getSettings().then((s) => setShippingFee(s.shipping_fee || '')).catch(() => {});
  }, [params.slug]);

  const handleAddToCart = () => {
    if (!product) return;
    addItem({
      productId: product.id,
      code: product.code,
      name: `${product.name}${product.size ? ` ${product.size}` : ''}`,
      size: product.size,
      price: product.price,
      quantity,
      imageUrl: product.imageUrl,
    });
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-pulse">
        <div className="h-4 bg-surface-elevated rounded w-24 mb-8" />
        <div className="grid md:grid-cols-2 gap-6 md:gap-8">
          <div className="aspect-square bg-surface-elevated rounded-xl" />
          <div className="space-y-4">
            <div className="h-3 bg-surface-elevated rounded w-1/3" />
            <div className="h-8 bg-surface-elevated rounded w-2/3" />
            <div className="h-6 bg-surface-elevated rounded w-1/4" />
          </div>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <p className="text-text-muted text-lg mb-4">Product not found.</p>
        <Link href="/products"><Button variant="outline">Back to Products</Button></Link>
      </div>
    );
  }

  let benefits: string[] = [];
  try { if (product.benefits) benefits = JSON.parse(product.benefits); } catch {}

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <ProductJsonLd
        name={`${product.name}${product.size ? ` ${product.size}` : ''}`}
        description={product.description || `Premium ${product.name} research peptide from ASCEND Malaysia.`}
        price={product.price}
        code={product.code}
        slug={product.slug}
        imageUrl={product.imageUrl}
        inStock={product.stock > 0}
        category={product.category.name}
      />
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', url: 'https://ascendpeptides.my' },
          { name: 'Products', url: 'https://ascendpeptides.my/products' },
          { name: product.name, url: `https://ascendpeptides.my/products/${product.slug}` },
        ]}
      />
      <Link href="/products" className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary mb-8 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Products
      </Link>

      <div className="grid md:grid-cols-2 gap-6 md:gap-8">
        <Animate variant="fade" duration={0.6}>
          <div className="aspect-square bg-surface-elevated rounded-xl border border-border flex items-center justify-center overflow-hidden">
            {product.imageUrl ? (
              <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
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
            {product.size && <p className="text-text-secondary mt-1">{product.size}</p>}
          </div>

          <p className="font-display text-3xl font-bold">{formatPrice(product.price)}</p>

          {product.description && (
            <p className="text-text-secondary leading-relaxed">{product.description}</p>
          )}

          {benefits.length > 0 && (
            <div>
              <h3 className="font-display font-semibold mb-3">Benefits</h3>
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

          <div className="flex items-center gap-4 pt-4">
            <div className="flex items-center border border-border rounded-lg">
              <button
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                className="px-3 py-2 text-text-secondary hover:text-text-primary cursor-pointer"
              >
                -
              </button>
              <span className="px-4 py-2 font-medium min-w-[3rem] text-center">{quantity}</span>
              <button
                onClick={() => setQuantity(quantity + 1)}
                className="px-3 py-2 text-text-secondary hover:text-text-primary cursor-pointer"
              >
                +
              </button>
            </div>
            <Button onClick={handleAddToCart} disabled={product.stock === 0} size="lg" className="flex-1">
              {added ? (
                <><Check className="w-4 h-4" /> Added</>
              ) : (
                <><ShoppingCart className="w-4 h-4" /> Add to Cart</>
              )}
            </Button>
          </div>

          {product.stock === 0 && <p className="text-danger font-medium">Out of stock</p>}
          {product.stock > 0 && product.stock <= 5 && <p className="text-warning text-sm">Only {product.stock} left in stock</p>}

          <p className="text-xs text-text-muted italic">For research purposes only — not for human consumption.</p>

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

      {/* Certificate of Analysis */}
      {product.coaUrl && (
        <Animate variant="fadeUp" delay={0.25}>
          <div className="mt-10 bg-surface rounded-xl border border-border p-6">
            <h3 className="font-display font-semibold text-lg mb-2">Certificate of Analysis</h3>
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
              Batch COA — {product.name} {product.size}
              <ExternalLink className="w-3.5 h-3.5 text-text-muted" />
            </a>
          </div>
        </Animate>
      )}
    </div>
  );
}
