import { getProductsServer } from '@/lib/server-api';
import { ProductCard } from '@/components/products/ProductCard';
import { CartView } from './CartView';

/**
 * /cart, laid out like our other stores': the lines on the left, the summary
 * (with shipping) on the right. An empty cart is not a dead end: it shows the
 * featured products, fetched here so the page does not wait on them.
 */
export default async function CartPage() {
  const featured = await getProductsServer({ featured: true, limit: 4 });
  const products = featured.data.length > 0 ? featured.data : (await getProductsServer({ limit: 4 })).data;
  return (
    <CartView
      suggestions={
        products.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {products.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        ) : null
      }
    />
  );
}
