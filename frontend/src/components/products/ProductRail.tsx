import type { Product } from '@/types';
import { Animate, Stagger } from '@/components/ui/Animate';
import { ProductCard } from './ProductCard';

interface ProductRailProps {
  title: string;
  subtitle?: string;
  products: Product[];
  delay?: number;
}

export function ProductRail({ title, subtitle, products, delay = 0.3 }: ProductRailProps) {
  if (products.length === 0) return null;

  return (
    <Animate variant="fadeUp" delay={delay}>
      <div className="mt-10">
        <h2 className="font-display font-semibold text-lg mb-1">{title}</h2>
        {subtitle && <p className="text-sm text-text-secondary mb-4">{subtitle}</p>}
        {!subtitle && <div className="mb-4" />}
        <Stagger className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4" stagger={0.05}>
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </Stagger>
      </div>
    </Animate>
  );
}
