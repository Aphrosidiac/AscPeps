import { HomeClient } from './HomeClient';
import { getProductsServer, getCategoriesServer, getSettingsServer, getProductServer, getResearchServer, getGroupBuyPromoServer } from '@/lib/server-api';

// Kept as a constant rather than a settings field — swapping which specific
// article backs the "backed by published research" trust badge is a content
// decision, not something that needs to change without a deploy the way the
// promoted product itself does.
const HARDSELL_RESEARCH_SLUG = 'what-the-phase-2-retatrutide-trial-actually-measured';

export default async function HomePage() {
  const [featuredRes, categories, settings, groupBuyPromo] = await Promise.all([
    getProductsServer({ featured: true, limit: 8 }),
    getCategoriesServer(),
    getSettingsServer(),
    getGroupBuyPromoServer(),
  ]);

  const products =
    featuredRes.data.length > 0 ? featuredRes.data : (await getProductsServer({ limit: 8 })).data;

  const shippingFee = settings.shipping_fee || '';
  const freeShipping = !shippingFee || shippingFee === '0';

  const hardsellSlug = settings.hardsell_product_slug || '';
  const hardsellEnabled = settings.hardsell_enabled === 'true' && !!hardsellSlug;
  const slide2Slug = settings.hardsell_slide2_product_slug || '';
  const slide2Enabled = settings.hardsell_slide2_enabled === 'true' && !!slide2Slug;

  const [hardsellProduct, hardsellResearchArticle, hardsellSlide2Product] = await Promise.all([
    hardsellEnabled ? getProductServer(hardsellSlug) : Promise.resolve(null),
    // The research article behind the slide's "Backed by Published Research" link, while it is live.
    hardsellEnabled ? getResearchServer(HARDSELL_RESEARCH_SLUG).then((r) => (r && 'article' in r ? r.article : null)) : Promise.resolve(null),
    slide2Enabled ? getProductServer(slide2Slug) : Promise.resolve(null),
  ]);

  return (
    <HomeClient
      products={products}
      categories={categories}
      freeShipping={freeShipping}
      hardsellProduct={hardsellProduct}
      hardsellResearchArticle={hardsellResearchArticle}
      hardsellHeadline={settings.hardsell_headline || ''}
      hardsellSubheadline={settings.hardsell_subheadline || ''}
      hardsellSlide2Product={hardsellSlide2Product}
      hardsellSlide2Headline={settings.hardsell_slide2_headline || ''}
      hardsellSlide2Subheadline={settings.hardsell_slide2_subheadline || ''}
      groupBuyHome={groupBuyPromo.home}
    />
  );
}
