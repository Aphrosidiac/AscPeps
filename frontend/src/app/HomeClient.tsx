'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, Shield, Truck, FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ProductCard } from '@/components/products/ProductCard';
import { Animate, Stagger } from '@/components/ui/Animate';
import { MolecularNetwork } from '@/components/ui/MolecularNetwork';
import { VideoStrip } from '@/components/ui/VideoStrip';
import { RetaHardsellSection } from '@/components/home/RetaHardsellSection';
import { getCategoryIcon } from '@/lib/category-icons';
import type { Product, Category, Insight } from '@/types';

interface HomeClientProps {
  products: Product[];
  categories: Category[];
  freeShipping: boolean;
  hardsellProduct: Product | null;
  hardsellResearchArticle: Insight | null;
  hardsellHeadline: string;
  hardsellSubheadline: string;
}

export function HomeClient({
  products,
  categories,
  freeShipping,
  hardsellProduct,
  hardsellResearchArticle,
  hardsellHeadline,
  hardsellSubheadline,
}: HomeClientProps) {
  const triggerJiggle = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const el = e.currentTarget as HTMLElement;
    if (el.classList.contains('jiggling')) return;
    el.classList.add('jiggling');
    el.addEventListener('animationend', () => el.classList.remove('jiggling'), { once: true });
  }, []);

  return (
    <div>
      {/* Hero */}
      <section className="bg-primary text-white overflow-hidden relative">
        <MolecularNetwork className="absolute inset-0 w-full h-full" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24 relative z-10">
          <div className="flex flex-col md:flex-row md:items-center gap-8 lg:gap-16">
            <div className="flex-1 min-w-0">
              <Animate variant="fade" duration={0.8}>
                <div className="flex items-center gap-3 mb-6">
                  <Image src="/images/pill-icon.png" alt="ASCEND" width={48} height={48} className="invert" />
                  <span className="font-display text-2xl font-bold tracking-tight">ASCEND</span>
                </div>
              </Animate>
              <Animate variant="fadeUp" delay={0.15} duration={0.7}>
                <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold leading-tight mb-6">
                  Premium Research Peptides in Malaysia
                </h1>
              </Animate>
              <Animate variant="fadeUp" delay={0.3} duration={0.7}>
                <p className="text-lg text-neutral-300 mb-8 max-w-lg">
                  Lab-grade peptides for anti-aging, fat loss, muscle growth, and immune support. Fast shipping across Malaysia.
                </p>
              </Animate>
              <Animate variant="fadeUp" delay={0.45} duration={0.7} className="hidden md:block">
                <div className="flex flex-wrap gap-4">
                  <Link href="/products">
                    <Button variant="secondary" size="lg">
                      Browse Products <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
                </div>
              </Animate>
            </div>
            <Animate variant="fadeUp" delay={0.3} duration={0.8} className="md:hidden flex flex-col items-center gap-6">
              <Image
                src="/images/hero-vials.png"
                alt="ASCEND peptide vials"
                width={300}
                height={300}
                className="w-[220px] h-auto drop-shadow-2xl hero-vials"
                priority
                onMouseEnter={triggerJiggle}
                onTouchStart={triggerJiggle}
              />
              <Link href="/products">
                <Button variant="secondary" size="lg">
                  Browse Products <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </Animate>
            <Animate variant="fadeRight" delay={0.3} duration={0.8} className="hidden md:block flex-shrink-0">
              <Image
                src="/images/hero-vials.png"
                alt="ASCEND peptide vials"
                width={480}
                height={480}
                className="w-[340px] lg:w-[440px] h-auto drop-shadow-2xl hero-vials"
                priority
                onMouseEnter={triggerJiggle}
                onTouchStart={triggerJiggle}
              />
            </Animate>
          </div>
        </div>
      </section>

      {/* Trust Signals */}
      <section className="border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <Stagger className="grid grid-cols-1 md:grid-cols-3 gap-8" stagger={0.12}>
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
                <h3 className="font-display font-semibold mb-1">Secure &amp; Discreet</h3>
                <p className="text-sm text-text-secondary">All orders are discreetly packaged for your privacy.</p>
              </div>
            </div>
          </Stagger>
        </div>
      </section>

      {hardsellProduct && (
        <RetaHardsellSection
          product={hardsellProduct}
          researchArticle={hardsellResearchArticle}
          headline={hardsellHeadline}
          subheadline={hardsellSubheadline}
        />
      )}

      {/* Categories */}
      {categories.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <Animate variant="fadeUp">
            <h2 className="font-display text-2xl md:text-3xl font-bold mb-8">Shop by Category</h2>
          </Animate>
          <Stagger className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" stagger={0.08}>
            {categories.filter(c => c.slug !== 'supplies').map((cat) => {
              const CategoryIcon = getCategoryIcon(cat.slug);
              return (
                <Link
                  key={cat.slug}
                  href={`/products?category=${cat.slug}`}
                  className="group bg-surface rounded-xl border border-border hover:border-border-hover hover:shadow-md transition-all duration-300 p-6"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <CategoryIcon className="w-5 h-5 text-text-primary shrink-0" />
                    <h3 className="font-display font-semibold text-lg group-hover:text-primary-light transition-colors">{cat.name}</h3>
                  </div>
                  <p className="text-sm text-text-secondary mb-3">{cat.description}</p>
                  <span className="text-sm font-medium text-text-muted">{cat.productCount} products</span>
                </Link>
              );
            })}
          </Stagger>
        </section>
      )}

      {/* Video Divider */}
      <VideoStrip src="/videos/lab-glassware.mp4" height="120px" overlay={0.35} />

      {/* Featured Products */}
      {products.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <Animate variant="fadeUp">
            <div className="flex items-center justify-between mb-8">
              <h2 className="font-display text-2xl md:text-3xl font-bold">Featured Products</h2>
              <Link href="/products" className="text-sm font-medium text-text-secondary hover:text-text-primary transition-colors">
                View All <ArrowRight className="w-4 h-4 inline" />
              </Link>
            </div>
          </Animate>
          <Stagger className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" stagger={0.06}>
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </Stagger>
        </section>
      )}

      {/* Video Divider */}
      <VideoStrip src="/videos/lab-glassware.mp4" height="100px" overlay={0.45} />

      {/* SEO content */}
      <section className="border-t border-border bg-surface/40">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <Animate variant="fadeUp">
            <h2 className="font-display text-2xl md:text-3xl font-bold mb-6">Buy Research Peptides in Malaysia</h2>
            <div className="space-y-4 text-text-secondary leading-relaxed">
              <p>
                ASCEND is Malaysia&apos;s trusted source for premium research peptides. We supply lab-grade
                compounds including{' '}
                <Link href="/products" className="text-primary-light hover:underline">Retatrutide, GHK-Cu, BPC-157, Tesamorelin, MOTS-c and AOD9604</Link>,
                all manufactured to 99%+ purity with third-party Certificates of Analysis available on request.
              </p>
              <p>
                {freeShipping ? (
                  <>Every order ships free across Malaysia — from the Klang Valley to Sabah and Sarawak — in discreet,
                  temperature-conscious packaging.</>
                ) : (
                  <>Every order is delivered nationwide across Malaysia — from the Klang Valley to Sabah and Sarawak — in discreet,
                  temperature-conscious packaging.</>
                )}{' '}
                Prices are listed in Malaysian Ringgit (MYR) with no hidden fees,
                and you can pay by bank transfer, FPX or card. No account is needed: simply order and{' '}
                <Link href="/track" className="text-primary-light hover:underline">track your delivery</Link> using your phone number.
              </p>
              <p>
                New to peptides? Read our{' '}
                <Link href="/guide" className="text-primary-light hover:underline">peptide reconstitution and storage guide</Link>, or browse the{' '}
                <Link href="/faq" className="text-primary-light hover:underline">frequently asked questions</Link>{' '}
                covering purity, shipping and how to order research peptides in Malaysia.
              </p>
              <p className="text-xs text-text-muted pt-2">
                All products are sold strictly for laboratory and research purposes only.
              </p>
            </div>
          </Animate>
        </div>
      </section>
    </div>
  );
}
