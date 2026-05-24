'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, Shield, Truck, FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ProductCard } from '@/components/products/ProductCard';
import { getProducts, getCategories } from '@/lib/api';
import type { Product, Category } from '@/types';

export default function HomePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    getProducts({ limit: 8 }).then((r) => setProducts(r.data)).catch(() => {});
    getCategories().then(setCategories).catch(() => {});
  }, []);

  return (
    <div>
      {/* Hero */}
      <section className="bg-primary text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-32">
          <div className="max-w-2xl">
            <div className="flex items-center gap-3 mb-6">
              <Image src="/images/logo-transparent.png" alt="ASCEND" width={48} height={48} className="invert" />
              <span className="font-display text-2xl font-bold tracking-tight">ASCEND</span>
            </div>
            <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold leading-tight mb-6">
              Premium Research Peptides
            </h1>
            <p className="text-lg text-neutral-300 mb-8 max-w-lg">
              Lab-grade peptides for anti-aging, fat loss, muscle growth, and immune support. Fast shipping across Malaysia.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link href="/products">
                <Button variant="secondary" size="lg">
                  Browse Products <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Trust Signals */}
      <section className="border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-surface-elevated rounded-lg">
                <FlaskConical className="w-6 h-6 text-text-primary" />
              </div>
              <div>
                <h3 className="font-display font-semibold mb-1">Lab-Grade Quality</h3>
                <p className="text-sm text-text-secondary">Rigorously tested peptides with verified purity and potency.</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="p-3 bg-surface-elevated rounded-lg">
                <Truck className="w-6 h-6 text-text-primary" />
              </div>
              <div>
                <h3 className="font-display font-semibold mb-1">Fast Shipping</h3>
                <p className="text-sm text-text-secondary">Nationwide delivery across Malaysia with tracking.</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="p-3 bg-surface-elevated rounded-lg">
                <Shield className="w-6 h-6 text-text-primary" />
              </div>
              <div>
                <h3 className="font-display font-semibold mb-1">Secure & Discreet</h3>
                <p className="text-sm text-text-secondary">All orders are discreetly packaged for your privacy.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Categories */}
      {categories.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <h2 className="font-display text-2xl md:text-3xl font-bold mb-8">Shop by Category</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {categories.filter(c => c.slug !== 'supplies').map((cat) => (
              <Link
                key={cat.slug}
                href={`/products?category=${cat.slug}`}
                className="group bg-surface rounded-xl border border-border hover:border-border-hover hover:shadow-md transition-all p-6"
              >
                <h3 className="font-display font-semibold text-lg mb-1 group-hover:text-primary-light">{cat.name}</h3>
                <p className="text-sm text-text-secondary mb-3">{cat.description}</p>
                <span className="text-sm font-medium text-text-muted">{cat.productCount} products</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Featured Products */}
      {products.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="flex items-center justify-between mb-8">
            <h2 className="font-display text-2xl md:text-3xl font-bold">Featured Products</h2>
            <Link href="/products" className="text-sm font-medium text-text-secondary hover:text-text-primary transition-colors">
              View All <ArrowRight className="w-4 h-4 inline" />
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
