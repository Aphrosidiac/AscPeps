import { getProductsServer } from '@/lib/server-api';
import { ProductCard } from '@/components/products/ProductCard';
import { Animate, Stagger } from '@/components/ui/Animate';

interface ProductsGridProps {
  category?: string;
  search?: string;
}

export async function ProductsGrid({ category, search }: ProductsGridProps) {
  const showFeatured = !category && !search;

  const [featuredRes, productsRes] = await Promise.all([
    showFeatured ? getProductsServer({ featured: true, limit: 10 }) : Promise.resolve(null),
    // limit 100: catalog is at 54 products as of 2026-07; headroom above the
    // previous hardcoded 50 so growth doesn't silently drop products from the
    // default listing view again.
    getProductsServer({ category, search, limit: 100 }),
  ]);

  const featured = featuredRes?.data ?? [];
  const products = productsRes.data;

  return (
    <>
      {featured.length > 0 && (
        <Animate variant="fadeUp" delay={0.05} duration={0.5}>
          <div className="mb-10">
            <div className="flex items-center gap-2 mb-4">
              <h2 className="font-display font-semibold text-lg">Featured</h2>
            </div>
            <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 snap-x snap-mandatory scrollbar-hide">
              {featured.map((product) => (
                <div key={product.id} className="w-[200px] sm:w-[220px] shrink-0 snap-start">
                  <ProductCard product={product} />
                </div>
              ))}
            </div>
          </div>
        </Animate>
      )}

      {products.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-text-muted text-lg">No products found.</p>
        </div>
      ) : (
        <Stagger className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" stagger={0.05}>
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </Stagger>
      )}
    </>
  );
}
