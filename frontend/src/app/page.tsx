import { HomeClient } from './HomeClient';
import { getProductsServer, getCategoriesServer, getSettingsServer, getProductServer, getInsightServer } from '@/lib/server-api';

// Kept as a constant rather than a settings field — swapping which specific
// article backs the "backed by published research" trust badge is a content
// decision, not something that needs to change without a deploy the way the
// promoted product itself does.
const HARDSELL_RESEARCH_SLUG = 'what-the-phase-2-retatrutide-trial-actually-measured';

export default async function HomePage() {
  const [featuredRes, categories, settings] = await Promise.all([
    getProductsServer({ featured: true, limit: 8 }),
    getCategoriesServer(),
    getSettingsServer(),
  ]);

  const products =
    featuredRes.data.length > 0 ? featuredRes.data : (await getProductsServer({ limit: 8 })).data;

  const shippingFee = settings.shipping_fee || '';
  const freeShipping = !shippingFee || shippingFee === '0';

  const hardsellSlug = settings.hardsell_product_slug || '';
  const hardsellEnabled = settings.hardsell_enabled === 'true' && !!hardsellSlug;
  const [hardsellProduct, hardsellResearchArticle] = hardsellEnabled
    ? await Promise.all([getProductServer(hardsellSlug), getInsightServer(HARDSELL_RESEARCH_SLUG)])
    : [null, null];

  return (
    <HomeClient
      products={products}
      categories={categories}
      freeShipping={freeShipping}
      hardsellProduct={hardsellProduct}
      hardsellResearchArticle={hardsellResearchArticle}
      hardsellHeadline={settings.hardsell_headline || ''}
      hardsellSubheadline={settings.hardsell_subheadline || ''}
    />
  );
}
