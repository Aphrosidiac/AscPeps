import type { AgentTool } from '../tool-kit.js';
import { clampLimit, listResult, money, toCents, parseDate, rm } from '../tool-kit.js';
import { getEffectivePrice, isSaleActive } from '../../../utils/product-pricing.js';

// Catalogue tools. The parent/variant split matters here and the descriptions
// lean on it hard: a Product is the compound (one storefront URL, shared copy),
// a ProductVariant is a sellable size with its own price and stock. Price and
// stock questions are ALWAYS about a variant — a model that tries to set a
// price on a Product has misunderstood the model, so no tool offers it.

function variantView(v: any) {
  const onSale = isSaleActive(v);
  return {
    variantId: v.id,
    code: v.code,
    size: v.size,
    price: money(v.price),
    salePrice: v.salePrice == null ? null : money(v.salePrice),
    saleActiveNow: onSale,
    saleWindow: v.saleStartsAt ? { from: v.saleStartsAt, to: v.saleEndsAt } : null,
    effectivePrice: money(getEffectivePrice(v)),
    stock: v.stock,
    active: v.active,
  };
}

export const catalogTools: AgentTool[] = [
  {
    name: 'list_categories',
    description: 'List all product categories with how many products each holds.',
    input_schema: { type: 'object', properties: {} },
    run: async ({ prisma }) => {
      const cats = await prisma.category.findMany({
        orderBy: { sortOrder: 'asc' },
        include: { _count: { select: { products: true } } },
      });
      return cats.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        sortOrder: c.sortOrder,
        productCount: c._count.products,
      }));
    },
  },

  {
    name: 'search_products',
    description:
      'Find product lines by name, slug, SKU code, category or status. Returns each product with all its sizes (variants), prices and stock. Use this before any tool that needs a productId or variantId.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Free text matched against product name, slug, and variant SKU code (e.g. "BPC10", "CRBL").',
        },
        categoryName: { type: 'string' },
        activeOnly: { type: 'boolean', description: 'Default true. Set false to include deactivated products.' },
        featuredOnly: { type: 'boolean' },
        inStockOnly: { type: 'boolean', description: 'Only products with at least one variant in stock.' },
        limit: { type: 'number' },
      },
    },
    run: async ({ prisma }, input) => {
      const where: any = {};
      if (input.activeOnly !== false) where.active = true;
      if (input.featuredOnly) where.featured = true;
      if (input.query) {
        // Variant code is included deliberately: operators refer to a SKU by
        // its code far more often than by slug ("bump CRBL to 135"), and
        // without this the agent reports the product does not exist — which
        // reads as data loss rather than a search miss.
        where.OR = [
          { name: { contains: input.query, mode: 'insensitive' } },
          { slug: { contains: input.query, mode: 'insensitive' } },
          { variants: { some: { code: { contains: input.query, mode: 'insensitive' } } } },
        ];
      }
      if (input.categoryName) {
        where.category = { name: { contains: input.categoryName, mode: 'insensitive' } };
      }
      if (input.inStockOnly) where.variants = { some: { stock: { gt: 0 }, active: true } };

      // Counted separately from the page so a capped result is visible as one.
      // The catalogue is 51 products against a MAX_ROWS of 50: "list all our
      // products" returned 50 of them and read as the complete set, because a
      // bare array cannot say otherwise. See listResult.
      const [products, matched] = await Promise.all([
        prisma.product.findMany({
          where,
          include: { category: true, variants: { orderBy: { price: 'asc' } } },
          orderBy: [{ featured: 'desc' }, { name: 'asc' }],
          take: clampLimit(input.limit),
        }),
        prisma.product.count({ where }),
      ]);

      return listResult(
        products.map((p) => ({
          productId: p.id,
          name: p.name,
          slug: p.slug,
          category: p.category.name,
          featured: p.featured,
          active: p.active,
          addOnOnly: p.addOnOnly,
          variants: p.variants.map(variantView),
        })),
        matched,
        'products'
      );
    },
  },

  {
    name: 'get_product',
    description:
      'Full detail for one product line: description, benefits, dosage info, every variant, and its configured add-ons. Accepts a product id or slug.',
    input_schema: {
      type: 'object',
      properties: { productIdOrSlug: { type: 'string' } },
      required: ['productIdOrSlug'],
    },
    run: async ({ prisma }, input) => {
      const key = String(input.productIdOrSlug);
      const p = await prisma.product.findFirst({
        where: { OR: [{ id: key }, { slug: key }] },
        include: {
          category: true,
          variants: { orderBy: { price: 'asc' } },
          addOns: { include: { addOn: { include: { product: true } } } },
        },
      });
      if (!p) throw new Error(`No product found matching "${key}".`);
      return {
        productId: p.id,
        name: p.name,
        slug: p.slug,
        category: p.category.name,
        description: p.description,
        benefits: p.benefits,
        dosageInfo: p.dosageInfo,
        coaUrl: p.coaUrl,
        addOnReminder: p.addOnReminder,
        featured: p.featured,
        active: p.active,
        addOnOnly: p.addOnOnly,
        variants: p.variants.map(variantView),
        addOns: p.addOns.map((a) => ({
          addOnVariantId: a.addOnId,
          name: `${a.addOn.product.name}${a.addOn.size ? ` ${a.addOn.size}` : ''}`,
          code: a.addOn.code,
          required: a.required,
          quantity: a.quantity,
          price: money(getEffectivePrice(a.addOn)),
        })),
      };
    },
  },

  {
    name: 'update_product',
    description:
      'Edit a product line: name, description, benefits, dosage info, COA url, category, featured/active flags, add-on reminder. Does NOT touch price or stock — those live on variants (use update_variant).',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        productId: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        benefits: { type: 'string' },
        dosageInfo: { type: 'string' },
        coaUrl: { type: 'string' },
        addOnReminder: { type: 'string' },
        categoryId: { type: 'string' },
        featured: { type: 'boolean' },
        active: { type: 'boolean' },
      },
      required: ['productId'],
    },
    run: async ({ prisma, revalidate }, input) => {
      const { productId, ...rest } = input;
      const data: any = {};
      for (const k of ['name', 'description', 'benefits', 'dosageInfo', 'coaUrl', 'addOnReminder', 'categoryId', 'featured', 'active']) {
        if (rest[k] !== undefined) data[k] = rest[k];
      }
      if (!Object.keys(data).length) throw new Error('Nothing to update — pass at least one field.');
      const p = await prisma.product.update({ where: { id: productId }, data });
      revalidate(['products']);
      return { productId: p.id, name: p.name, updated: Object.keys(data) };
    },
  },

  {
    name: 'update_variant',
    description:
      'Change a single size/SKU: price, stock, size label, image, or active flag. Prices are in RINGGIT (e.g. 149.90). Use adjust_stock for relative stock changes and set_sale for sale pricing.',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        variantId: { type: 'string' },
        priceRm: { type: 'number', description: 'New regular price in ringgit, e.g. 149.90.' },
        stock: { type: 'number', description: 'Absolute stock level. For "+10" style changes use adjust_stock.' },
        size: { type: 'string' },
        imageUrl: { type: 'string' },
        active: { type: 'boolean' },
      },
      required: ['variantId'],
    },
    run: async ({ prisma, revalidate }, input) => {
      const data: any = {};
      if (input.priceRm !== undefined) data.price = toCents(input.priceRm);
      if (input.stock !== undefined) data.stock = Math.max(0, Math.trunc(input.stock));
      if (input.size !== undefined) data.size = input.size;
      if (input.imageUrl !== undefined) data.imageUrl = input.imageUrl;
      if (input.active !== undefined) data.active = input.active;
      if (!Object.keys(data).length) throw new Error('Nothing to update — pass at least one field.');

      const before = await prisma.productVariant.findUnique({ where: { id: input.variantId } });
      if (!before) throw new Error(`No variant with id ${input.variantId}.`);
      const v = await prisma.productVariant.update({
        where: { id: input.variantId },
        data,
        include: { product: true },
      });
      revalidate(['products']);
      return {
        variantId: v.id,
        product: v.product.name,
        code: v.code,
        changes: Object.keys(data).map((k) => ({
          field: k,
          from: k === 'price' ? rm((before as any)[k]) : (before as any)[k],
          to: k === 'price' ? rm((v as any)[k]) : (v as any)[k],
        })),
      };
    },
  },

  {
    name: 'adjust_stock',
    description:
      'Add to or subtract from a variant\'s stock by a relative amount (e.g. +24 on restock, -2 for damage). Safer than update_variant for restocking because it cannot clobber a concurrent sale.',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        variantId: { type: 'string' },
        delta: { type: 'number', description: 'Positive to add, negative to remove.' },
        reason: { type: 'string', description: 'Recorded in the audit trail.' },
      },
      required: ['variantId', 'delta'],
    },
    run: async ({ prisma, revalidate }, input) => {
      const delta = Math.trunc(input.delta);
      if (!delta) throw new Error('delta must be a non-zero whole number.');
      // Read-modify-write here would race a live checkout decrementing the
      // same row; `increment` pushes the arithmetic into the UPDATE itself.
      const v = await prisma.productVariant.update({
        where: { id: input.variantId },
        data: { stock: { increment: delta } },
        include: { product: true },
      });
      // An oversell or a bad delta can drive this negative; clamp rather than
      // leave a negative stock level that the storefront would treat as
      // "in stock" in some comparisons.
      if (v.stock < 0) {
        await prisma.productVariant.update({ where: { id: v.id }, data: { stock: 0 } });
        v.stock = 0;
      }
      revalidate(['products']);
      return { variantId: v.id, product: v.product.name, code: v.code, delta, newStock: v.stock, reason: input.reason ?? null };
    },
  },

  {
    name: 'set_sale',
    description:
      'Put a variant on sale for a time window, or clear an existing sale. A sale only shows on the storefront while the current time is inside the window.',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        variantId: { type: 'string' },
        salePriceRm: { type: 'number', description: 'Sale price in ringgit. Omit (or pass clear:true) to end the sale.' },
        startsAt: { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' },
        endsAt: { type: 'string', description: 'YYYY-MM-DD. Required when setting a sale.' },
        clear: { type: 'boolean', description: 'True to remove the sale entirely.' },
      },
      required: ['variantId'],
    },
    run: async ({ prisma, revalidate }, input) => {
      if (input.clear) {
        const v = await prisma.productVariant.update({
          where: { id: input.variantId },
          data: { salePrice: null, saleStartsAt: null, saleEndsAt: null },
          include: { product: true },
        });
        revalidate(['products']);
        return { variantId: v.id, product: v.product.name, sale: 'cleared', price: money(v.price) };
      }

      if (input.salePriceRm === undefined) throw new Error('Pass salePriceRm, or clear:true to end the sale.');
      if (!input.endsAt) throw new Error('endsAt is required — a sale with no end date never expires.');

      const starts = parseDate(input.startsAt ?? 'today', false)!;
      const ends = parseDate(input.endsAt, true)!;
      if (ends <= starts) throw new Error('endsAt must be after startsAt.');

      const salePrice = toCents(input.salePriceRm);
      const current = await prisma.productVariant.findUnique({ where: { id: input.variantId } });
      if (!current) throw new Error(`No variant with id ${input.variantId}.`);
      if (salePrice >= current.price) {
        throw new Error(
          `Sale price ${rm(salePrice)} is not below the regular price ${rm(current.price)} — that would show a "sale" that costs more.`
        );
      }

      const v = await prisma.productVariant.update({
        where: { id: input.variantId },
        data: { salePrice, saleStartsAt: starts, saleEndsAt: ends },
        include: { product: true },
      });
      revalidate(['products']);
      return {
        variantId: v.id,
        product: v.product.name,
        code: v.code,
        was: money(v.price),
        now: money(salePrice),
        from: starts,
        to: ends,
        liveNow: isSaleActive(v),
      };
    },
  },

  {
    name: 'bulk_price_change',
    description:
      'Apply a percentage change to the price of every variant matching a filter (e.g. +5% across a category). Affects many SKUs at once, so it always asks for confirmation first.',
    write: true,
    destructive: true,
    input_schema: {
      type: 'object',
      properties: {
        percent: { type: 'number', description: 'e.g. 5 to raise 5%, -10 to cut 10%.' },
        categoryName: { type: 'string' },
        productQuery: { type: 'string', description: 'Free text matched against product name.' },
      },
      required: ['percent'],
    },
    summarize: async ({ prisma }, input) => {
      const variants = await findVariantsForBulk(prisma, input);
      const dir = input.percent >= 0 ? 'increase' : 'decrease';
      return `${dir} the price of ${variants.length} variant(s) by ${Math.abs(input.percent)}%${
        input.categoryName ? ` in category "${input.categoryName}"` : ''
      }${input.productQuery ? ` matching "${input.productQuery}"` : ''}`;
    },
    run: async ({ prisma, revalidate }, input) => {
      const variants = await findVariantsForBulk(prisma, input);
      if (!variants.length) throw new Error('No variants matched that filter — nothing changed.');
      const factor = 1 + input.percent / 100;
      const changes: any[] = [];
      // One transaction: a partial bulk repricing is worse than none, because
      // nobody can tell from the outside which half went through.
      await prisma.$transaction(
        variants.map((v) => {
          const next = Math.max(1, Math.round(v.price * factor));
          changes.push({ code: v.code, product: v.product.name, from: rm(v.price), to: rm(next) });
          return prisma.productVariant.update({ where: { id: v.id }, data: { price: next } });
        })
      );
      revalidate(['products']);
      return { changed: changes.length, percent: input.percent, changes: changes.slice(0, 30) };
    },
  },

  {
    name: 'list_low_stock',
    description: 'Variants at or below a stock threshold, lowest first. Use for restock planning.',
    input_schema: {
      type: 'object',
      properties: {
        threshold: { type: 'number', description: 'Default 10.' },
        includeInactive: { type: 'boolean' },
        limit: { type: 'number' },
      },
    },
    run: async ({ prisma }, input) => {
      const threshold = Number.isFinite(input.threshold) ? Math.trunc(input.threshold) : 10;
      const variants = await prisma.productVariant.findMany({
        where: {
          stock: { lte: threshold },
          ...(input.includeInactive ? {} : { active: true, product: { active: true } }),
        },
        include: { product: true },
        orderBy: { stock: 'asc' },
        take: clampLimit(input.limit, 30),
      });
      return {
        threshold,
        count: variants.length,
        variants: variants.map((v) => ({
          variantId: v.id,
          product: v.product.name,
          code: v.code,
          size: v.size,
          stock: v.stock,
          price: money(v.price),
          outOfStock: v.stock <= 0,
        })),
      };
    },
  },

  {
    name: 'manage_product_addons',
    description:
      'Add or remove an add-on offered on a product page. The add-on is itself a sellable variant (e.g. a Bacteriostatic Water size). "required" means the customer cannot uncheck it.',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'The product whose page shows the add-on.' },
        addOnVariantId: { type: 'string', description: 'The variant being offered as the add-on.' },
        action: { type: 'string', enum: ['add', 'remove'] },
        required: { type: 'boolean', description: 'Force-selected and locked on the storefront. Default false.' },
        quantity: { type: 'number', description: 'Fixed quantity added. Default 1.' },
      },
      required: ['productId', 'addOnVariantId', 'action'],
    },
    run: async ({ prisma, revalidate }, input) => {
      if (input.action === 'remove') {
        await prisma.productAddOn.deleteMany({
          where: { productId: input.productId, addOnId: input.addOnVariantId },
        });
        revalidate(['products']);
        return { removed: true, productId: input.productId, addOnVariantId: input.addOnVariantId };
      }
      const row = await prisma.productAddOn.upsert({
        where: { productId_addOnId: { productId: input.productId, addOnId: input.addOnVariantId } },
        create: {
          productId: input.productId,
          addOnId: input.addOnVariantId,
          required: !!input.required,
          quantity: Math.max(1, Math.trunc(input.quantity ?? 1)),
        },
        update: {
          required: !!input.required,
          quantity: Math.max(1, Math.trunc(input.quantity ?? 1)),
        },
        include: { addOn: { include: { product: true } } },
      });
      revalidate(['products']);
      return {
        added: true,
        productId: row.productId,
        addOn: `${row.addOn.product.name} ${row.addOn.size ?? ''}`.trim(),
        required: row.required,
        quantity: row.quantity,
      };
    },
  },
];

interface BulkVariant {
  id: string;
  code: string;
  price: number;
  product: { name: string };
}

async function findVariantsForBulk(prisma: any, input: any): Promise<BulkVariant[]> {
  const productWhere: any = { active: true };
  if (input.categoryName) productWhere.category = { name: { contains: input.categoryName, mode: 'insensitive' } };
  if (input.productQuery) productWhere.name = { contains: input.productQuery, mode: 'insensitive' };
  return prisma.productVariant.findMany({
    where: { active: true, product: productWhere },
    include: { product: true },
  });
}
