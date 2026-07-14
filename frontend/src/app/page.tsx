import { HomeClient } from './HomeClient';
import { getProductsServer, getCategoriesServer, getSettingsServer } from '@/lib/server-api';

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

  return <HomeClient products={products} categories={categories} freeShipping={freeShipping} />;
}
