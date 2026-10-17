interface BannerStripProps {
  // Desktop export cropped for this divider's height (2800px wide, 2x).
  src: string;
  height: '100px' | '120px';
}

// Decorative photographic divider between home sections. Replaces the looping
// lab-glassware video: a still is a fraction of the bytes, and its lighting is
// baked in, so it needs no dark overlay. Below 640px the taller mobile export
// keeps the glass recognisable in a narrow crop.
// Artwork: assets/site-banners/2026-10-18 (generated illustration, no product
// or facility shown).
export function BannerStrip({ src, height }: BannerStripProps) {
  return (
    <picture className="block w-full overflow-hidden" style={{ height }}>
      <source media="(max-width: 639px)" srcSet="/images/banners/lab-glass-mobile.webp" />
      <img
        src={src}
        alt=""
        width={2800}
        height={height === '120px' ? 240 : 200}
        loading="lazy"
        decoding="async"
        className="block w-full h-full object-cover object-center"
      />
    </picture>
  );
}
