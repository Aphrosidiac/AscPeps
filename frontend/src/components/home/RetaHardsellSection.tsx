'use client';

import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, ShieldCheck, FileText, Check, Gift, Flame } from 'lucide-react';
import { Animate } from '@/components/ui/Animate';
import { formatPrice, getDefaultVariant, getEffectivePrice, isSaleActive } from '@/lib/utils';
import type { Product, Insight } from '@/types';

interface RetaHardsellSectionProps {
  product: Product;
  researchArticle: Insight | null;
  // Owner-authored copy, editable from Admin > Settings without a deploy —
  // this component never invents marketing claims of its own. Falls back to
  // a plain, compliant default (just the product name) if left unset.
  headline: string;
  subheadline: string;
}

// Matches the "Only N left in stock" threshold already used on the product
// detail page (VariantSwitcher.tsx) — same definition of "low stock" in both
// places. Urgency only ever renders when this is genuinely true; never a
// fabricated countdown.
const LOW_STOCK_THRESHOLD = 5;

export function RetaHardsellSection({ product, researchArticle, headline, subheadline }: RetaHardsellSectionProps) {
  const activeVariants = product.variants.filter((v) => v.active);
  const variant = getDefaultVariant(product);
  const priceRange = activeVariants.length > 1 && new Set(activeVariants.map((v) => v.price)).size > 1;
  const lowStockVariant = activeVariants.find((v) => v.stock > 0 && v.stock <= LOW_STOCK_THRESHOLD);
  const requiredAddOns = (product.addOns ?? []).filter((a) => a.addOnRequired);

  let benefits: string[] = [];
  try {
    if (product.benefits) benefits = JSON.parse(product.benefits);
  } catch {}

  if (!variant) return null;

  return (
    <section className="bg-primary text-white overflow-hidden relative">
      {/* Glow behind the product photo — visual "spotlight" energy, reusing
          the site's existing success/verified green rather than a new color. */}
      <div className="absolute -top-24 right-0 w-[500px] h-[500px] bg-[#15803d]/20 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-20 relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-stretch gap-10 md:gap-0">
          {/* RIGHT: pure marketing hook — no product data, just the pitch */}
          <Animate
            variant="fadeLeft"
            duration={0.7}
            className="text-center md:text-left order-3 md:order-3 flex flex-col justify-center h-full md:pl-10 lg:pl-12"
          >
            {/* Price anchors the top of this column the same way the
                category/headline pair anchors the top of the details
                column — small label above, big display-weight text below. */}
            <div className="mb-6">
              {priceRange && (
                <span className="block text-xs text-white/60 font-medium uppercase tracking-wider mb-2">From</span>
              )}
              <div className="flex items-baseline justify-center md:justify-start gap-2.5">
                <span className="font-display text-4xl md:text-5xl font-bold">{formatPrice(getEffectivePrice(variant))}</span>
                {isSaleActive(variant) && (
                  <span className="text-lg text-white/60 line-through">{formatPrice(variant.price)}</span>
                )}
              </div>
              {lowStockVariant && (
                <p className="flex items-center justify-center md:justify-start gap-1.5 text-sm text-[#22c55e] font-bold mt-2">
                  <Flame className="w-4 h-4" /> Only {lowStockVariant.stock} left in stock — order soon
                </p>
              )}
            </div>

            <p className="font-display text-2xl sm:text-3xl font-bold leading-snug mb-2 text-balance">
              Verified Purity.<br />Zero Shortcuts.
            </p>
            <p className="text-white/70 text-sm sm:text-base mb-6 max-w-xs mx-auto md:mx-0">
              Don&apos;t gamble your research on unverified sources.
            </p>
            <p className="font-display text-2xl sm:text-3xl font-bold leading-snug mb-2 text-balance">
              Malaysia&apos;s <span className="text-[#22c55e]">#1 Choice</span><br />for Retatrutide
            </p>
            <p className="text-white/70 text-sm sm:text-base max-w-xs mx-auto md:mx-0">
              Real clinical data. Real trust. Ordered by researchers nationwide.
            </p>
          </Animate>

          {/* MIDDLE: product image */}
          <Animate
            variant="fadeUp"
            duration={0.7}
            className="flex-shrink-0 w-full md:w-auto relative order-1 md:order-2 flex flex-col justify-center h-full md:px-10 lg:px-12"
          >
            <div className="relative w-full max-w-[340px] md:w-[400px] aspect-square mx-auto bg-white/5 rounded-2xl border border-white/15 overflow-hidden">
              {variant.imageUrl ? (
                <Image
                  src={variant.imageUrl}
                  alt={product.name}
                  fill
                  sizes="(min-width: 768px) 400px, 85vw"
                  className="object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-6xl font-display font-bold text-white/20">
                  {variant.code}
                </div>
              )}
            </div>
            {requiredAddOns.length > 0 && (
              <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 md:left-auto md:right-4 md:translate-x-0 bg-[#15803d] text-white font-display font-bold text-xs sm:text-sm uppercase tracking-wide rounded-full px-4 py-2 shadow-lg whitespace-nowrap">
                + Free Kit Included
              </div>
            )}

            {/* Custom-styled rather than the shared Button component — this
                is the one CTA in the section that needs to be the boldest
                element on the page (solid accent fill, glow, hover lift),
                which the shared component's variant classes don't cover. */}
            <Link href={`/products/${product.slug}`} className="inline-block mx-auto mt-6">
              <button className="group inline-flex items-center justify-center gap-2 bg-[#15803d] text-white font-display font-bold text-sm px-6 py-3 rounded-lg shadow-[0_6px_20px_rgba(21,128,61,0.45)] hover:shadow-[0_8px_28px_rgba(21,128,61,0.6)] hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 cursor-pointer">
                <span className="leading-snug text-center">Shop Reta<br />Risk Free Now</span>
                <ArrowRight className="w-4 h-4 shrink-0 group-hover:translate-x-1 transition-transform duration-200" />
              </button>
            </Link>
          </Animate>

          {/* LEFT: product details */}
          <div className="min-w-0 text-center md:text-left order-2 md:order-1 flex flex-col justify-center h-full md:pr-10 lg:pr-12">
            <Animate variant="fadeUp" duration={0.6}>
              <div className="flex items-center justify-center md:justify-start gap-2 mb-3">
                <span className="bg-[#15803d] text-white text-[11px] font-bold uppercase tracking-wider rounded-full px-3 py-1">
                  Bestseller
                </span>
                <span className="text-xs text-white/60 font-medium uppercase tracking-wider">
                  {product.category.name}
                </span>
              </div>
              <h2 className="font-display text-4xl md:text-5xl font-bold leading-tight mb-3 text-balance">
                {headline || product.name}
              </h2>
              {subheadline && (
                <p className="text-white/80 text-base sm:text-lg mb-5 max-w-xl mx-auto md:mx-0">{subheadline}</p>
              )}
            </Animate>

            {benefits.length > 0 && (
              <Animate variant="fadeUp" delay={0.1} duration={0.6}>
                <ul className="space-y-2.5 mb-5 inline-block text-left">
                  {benefits.slice(0, 4).map((b, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm sm:text-base text-white/90">
                      <Check className="w-4 h-4 text-[#22c55e] mt-0.5 shrink-0" />
                      {b}
                    </li>
                  ))}
                </ul>
              </Animate>
            )}

            {product.addOnReminder && (
              <Animate variant="fadeUp" delay={0.15} duration={0.6}>
                {/* Same icon-to-text gap (gap-1.5) as the trust row below it,
                    so both icon+text groups line up in the same column. */}
                <div className="flex items-start gap-1.5 mb-5 text-left max-w-xl mx-auto md:mx-0">
                  <Gift className="w-4 h-4 text-[#22c55e] shrink-0 mt-1" />
                  <p className="text-sm sm:text-base text-white/80">{product.addOnReminder}</p>
                </div>
              </Animate>
            )}

            <Animate variant="fadeUp" delay={0.2} duration={0.6}>
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-x-5 gap-y-2 mb-6 text-sm text-white/70">
                {product.coaUrl && (
                  <a
                    href={product.coaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 hover:text-white transition-colors"
                  >
                    <ShieldCheck className="w-4 h-4 text-[#22c55e]" /> Third-Party Lab Tested
                  </a>
                )}
                {researchArticle && (
                  <Link
                    href={`/insights/${researchArticle.slug}`}
                    className="inline-flex items-center gap-1.5 hover:text-white transition-colors"
                  >
                    <FileText className="w-4 h-4 text-[#22c55e]" /> Backed by Published Research
                  </Link>
                )}
              </div>
            </Animate>
          </div>
        </div>
      </div>
    </section>
  );
}
