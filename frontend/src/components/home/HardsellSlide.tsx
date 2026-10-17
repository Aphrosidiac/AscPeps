import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, ShieldCheck, FileText, Check, Gift, BadgeCheck, MapPin } from 'lucide-react';
import { Animate } from '@/components/ui/Animate';
import { Button } from '@/components/ui/Button';
import { formatPrice, getDefaultVariant, getEffectivePrice, isSaleActive } from '@/lib/utils';
import type { Product, Insight } from '@/types';

export interface HardsellSlideProps {
  product: Product;
  researchArticle: Insight | null;
  // Owner-authored copy — this component never invents marketing claims
  // of its own. Falls back to a plain, compliant default (product name)
  // if left unset.
  headline: string;
  subheadline: string;
}

// Matches the "Only N left in stock" threshold already used on the product
// detail page (VariantSwitcher.tsx) — same definition of "low stock" in both
// places. Urgency only ever renders when this is genuinely true; never a
// fabricated countdown.
const LOW_STOCK_THRESHOLD = 5;

// Same language as the hero above it: black field, white type, neutral
// greys, the hero's secondary button. No accent colour — the rest of the
// storefront is monochrome, and this section reads as part of it.
export function HardsellSlide({ product, researchArticle, headline, subheadline }: HardsellSlideProps) {
  const activeVariants = product.variants.filter((v) => v.active);
  const variant = getDefaultVariant(product);
  const priceRange = activeVariants.length > 1 && new Set(activeVariants.map((v) => v.price)).size > 1;
  const lowStockVariant = activeVariants.find((v) => v.stock > 0 && v.stock <= LOW_STOCK_THRESHOLD);

  let benefits: string[] = [];
  try {
    if (product.benefits) benefits = JSON.parse(product.benefits);
  } catch {}

  if (!variant) return null;

  return (
    <section className="bg-primary text-white h-full">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-20">
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-center gap-10 lg:gap-16">
          <Animate variant="fadeUp" duration={0.7}>
            <Link
              href={`/products/${product.slug}`}
              className="block relative w-full max-w-[440px] aspect-square bg-surface rounded-xl overflow-hidden"
            >
              {variant.imageUrl ? (
                <Image
                  src={variant.imageUrl}
                  alt={product.name}
                  fill
                  sizes="(min-width: 768px) 440px, 92vw"
                  className="object-cover"
                />
              ) : (
                <span className="w-full h-full flex items-center justify-center text-6xl font-display font-bold text-text-muted">
                  {variant.code}
                </span>
              )}
            </Link>
          </Animate>

          <div className="min-w-0">
            <Animate variant="fadeUp" duration={0.6}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-4">
                <span className="text-[11px] font-semibold uppercase tracking-wider rounded-full px-2.5 py-1 bg-white/10 text-white">
                  Bestseller
                </span>
                <span className="text-xs text-neutral-400 uppercase tracking-wider">
                  {product.category.name}
                </span>
              </div>
              <h2 className="font-display text-4xl md:text-5xl font-bold leading-tight mb-4 text-balance">
                {headline || product.name}
              </h2>
              {subheadline && (
                <p className="text-lg text-neutral-300 mb-6 max-w-xl">{subheadline}</p>
              )}

              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                {priceRange && <span className="text-sm text-neutral-400">From</span>}
                <span className="font-display text-3xl font-bold">{formatPrice(getEffectivePrice(variant))}</span>
                {isSaleActive(variant) && (
                  <span className="text-base text-neutral-500 line-through">{formatPrice(variant.price)}</span>
                )}
              </div>
              {lowStockVariant && (
                <p className="text-warning text-sm mt-1">Only {lowStockVariant.stock} left in stock</p>
              )}
            </Animate>

            {(benefits.length > 0 || product.addOnReminder) && (
              <Animate variant="fadeUp" delay={0.1} duration={0.6}>
                <div className="border-t border-white/10 mt-6 pt-6">
                  {benefits.length > 0 && (
                    <ul className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-3">
                      {benefits.slice(0, 4).map((b, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-sm text-neutral-300">
                          <Check className="w-4 h-4 mt-0.5 shrink-0 text-neutral-500" />
                          {b}
                        </li>
                      ))}
                    </ul>
                  )}
                  {product.addOnReminder && (
                    <p className="flex items-start gap-2.5 text-sm text-neutral-400 mt-4 max-w-xl">
                      <Gift className="w-4 h-4 mt-0.5 shrink-0 text-neutral-500" />
                      {product.addOnReminder}
                    </p>
                  )}
                </div>
              </Animate>
            )}

            <Animate variant="fadeUp" delay={0.2} duration={0.6}>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-4 mt-8">
                <Link href={`/products/${product.slug}`}>
                  <Button variant="secondary" size="lg">
                    Shop {product.name} Risk Free Now <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
                {product.coaUrl && (
                  <a
                    href={product.coaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-white transition-colors"
                  >
                    <ShieldCheck className="w-4 h-4" /> Third-Party Lab Tested
                  </a>
                )}
                {researchArticle && (
                  <Link
                    href={`/insights/${researchArticle.slug}`}
                    className="inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-white transition-colors"
                  >
                    <FileText className="w-4 h-4" /> Backed by Published Research
                  </Link>
                )}
              </div>
            </Animate>
          </div>
        </div>

        {/* Same pattern as the trust-signal row above the section: icon
            tile, short title, one line of support. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 border-t border-white/10 mt-14 pt-10">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-white/5 rounded-lg">
              <BadgeCheck className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-display font-semibold mb-1">Verified Purity. Zero Shortcuts.</h3>
              <p className="text-sm text-neutral-400">Don&apos;t gamble your research on unverified sources.</p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="p-3 bg-white/5 rounded-lg">
              <MapPin className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-display font-semibold mb-1">Malaysia&apos;s #1 Choice for {product.name}</h3>
              <p className="text-sm text-neutral-400">Real clinical data. Real trust. Ordered by researchers nationwide.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
