import type { AgentTool } from '../tool-kit.js';
import { clampLimit, money, parseDate, rm, toCents, truncate } from '../tool-kit.js';
import {
  adminCreateInsight,
  adminDeleteInsight,
  adminGetInsight,
  adminListInsights,
  adminUpdateInsight,
} from '../../admin/admin-insights.controller.js';

// Insights (articles) and discount codes.
//
// Insight bodies are plain text rendered with `whitespace-pre-line` — there is
// no markdown pipeline. The tool descriptions say so explicitly, because a
// model left to guess will write markdown headings that render as literal
// hashes on the live site.

// Slugs are unique in the schema, so a second article with a similar title
// would otherwise fail on a constraint violation the operator can do nothing
// useful with. Suffix until it is free.
async function uniqueSlug(prisma: any, title: string): Promise<string> {
  const base =
    String(title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'article';
  for (let n = 0; n < 50; n++) {
    const candidate = n === 0 ? base : `${base}-${n + 1}`;
    if (!(await prisma.insight.findUnique({ where: { slug: candidate } }))) return candidate;
  }
  throw new Error(`Could not derive a free slug from "${title}" — pass one explicitly.`);
}

export const contentTools: AgentTool[] = [
  {
    name: 'list_insights',
    description: 'List Insights articles, published or draft.',
    input_schema: {
      type: 'object',
      properties: {
        published: { type: 'boolean', description: 'Omit for both.' },
        category: { type: 'string' },
        search: { type: 'string' },
        limit: { type: 'number' },
      },
    },
    run: async ({ fastify }, input) => {
      const query: Record<string, string> = { limit: String(clampLimit(input.limit, 20)) };
      if (input.published !== undefined) query.published = String(input.published);
      if (input.category) query.category = input.category;
      if (input.search) query.search = input.search;
      const res: any = await adminListInsights(fastify, query);
      const items = res?.data ?? res;
      return (Array.isArray(items) ? items : []).map((i: any) => ({
        insightId: i.id,
        title: i.title,
        slug: i.slug,
        category: i.category,
        published: i.published,
        publishedAt: i.publishedAt,
        readTimeMinutes: i.readTimeMinutes,
      }));
    },
  },

  {
    name: 'get_insight',
    description: 'Full article: body text, excerpt, citation, figures and linked products.',
    input_schema: { type: 'object', properties: { insightId: { type: 'string' } }, required: ['insightId'] },
    run: async ({ fastify }, input) => {
      const i: any = await adminGetInsight(fastify, input.insightId);
      return {
        insightId: i.id,
        title: i.title,
        slug: i.slug,
        category: i.category,
        excerpt: i.excerpt,
        content: truncate(i.content, 3000),
        published: i.published,
        publishedAt: i.publishedAt,
        author: `${i.authorName} — ${i.authorRole}`,
        citation: i.citationTitle ? { title: i.citationTitle, source: i.citationSource, url: i.citationUrl } : null,
        relatedProductIds: i.relatedProductIds,
        figures: (i.figures ?? []).map((f: any) => ({ number: f.order, caption: f.caption, imageUrl: f.imageUrl })),
      };
    },
  },

  {
    name: 'create_insight',
    description:
      'Write a new Insights article. The body is PLAIN TEXT — no markdown, no HTML. Paragraph breaks are blank lines and are preserved. Articles are created as drafts unless published is set true.',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        category: { type: 'string' },
        excerpt: { type: 'string', description: 'One or two sentences shown on the article card.' },
        content: { type: 'string', description: 'Plain text body. Blank lines separate paragraphs.' },
        coverImageUrl: { type: 'string' },
        citationTitle: { type: 'string' },
        citationSource: { type: 'string' },
        citationUrl: { type: 'string' },
        relatedProductIds: { type: 'array', items: { type: 'string' } },
        published: { type: 'boolean', description: 'Default false (draft).' },
        slug: { type: 'string', description: 'URL slug. Derived from the title when omitted.' },
      },
      required: ['title', 'category', 'excerpt', 'content'],
    },
    run: async ({ fastify, prisma, revalidate }, input) => {
      // The admin API requires a slug (the dashboard form has a field for it),
      // but an operator dictating an article over WhatsApp will never supply
      // one — so derive it. Without this the tool cannot create an article at
      // all, which is how this was caught.
      const slug = input.slug?.trim() || (await uniqueSlug(prisma, input.title));
      const i: any = await adminCreateInsight(fastify, { ...input, slug, published: !!input.published });
      revalidate(['insights']);
      return { insightId: i.id, title: i.title, slug: i.slug, published: i.published };
    },
  },

  {
    name: 'update_insight',
    description:
      'Edit an article, or publish/unpublish it. Only the fields you pass change. Body text is plain text — no markdown. Omitting figures leaves them untouched.',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        insightId: { type: 'string' },
        title: { type: 'string' },
        category: { type: 'string' },
        excerpt: { type: 'string' },
        content: { type: 'string' },
        coverImageUrl: { type: 'string' },
        citationTitle: { type: 'string' },
        citationSource: { type: 'string' },
        citationUrl: { type: 'string' },
        relatedProductIds: { type: 'array', items: { type: 'string' } },
        published: { type: 'boolean' },
      },
      required: ['insightId'],
    },
    run: async ({ fastify, revalidate }, input) => {
      const { insightId, ...body } = input;
      if (!Object.keys(body).length) throw new Error('Nothing to update — pass at least one field.');
      const i: any = await adminUpdateInsight(fastify, insightId, body);
      revalidate(['insights']);
      return { insightId: i.id, title: i.title, published: i.published, changed: Object.keys(body) };
    },
  },

  {
    name: 'delete_insight',
    description: 'Permanently delete an article and its figures. This cannot be undone.',
    write: true,
    destructive: true,
    input_schema: { type: 'object', properties: { insightId: { type: 'string' } }, required: ['insightId'] },
    summarize: async ({ fastify }, input) => {
      const i: any = await adminGetInsight(fastify, input.insightId);
      return `permanently delete the article "${i.title}"${i.published ? ' (currently LIVE on the site)' : ' (draft)'} and its figures`;
    },
    run: async ({ fastify, revalidate }, input) => {
      await adminDeleteInsight(fastify, input.insightId);
      revalidate(['insights']);
      return { deleted: true, insightId: input.insightId };
    },
  },

  {
    name: 'list_discount_codes',
    description: 'All discount codes with their type, value, usage and expiry.',
    input_schema: {
      type: 'object',
      properties: { activeOnly: { type: 'boolean' }, limit: { type: 'number' } },
    },
    run: async ({ prisma }, input) => {
      const rows = await prisma.discountCode.findMany({
        where: input.activeOnly ? { isActive: true } : {},
        orderBy: { createdAt: 'desc' },
        take: clampLimit(input.limit, 30),
      });
      return rows.map((d) => ({
        discountId: d.id,
        code: d.code,
        type: d.discountType,
        value: d.discountType === 'PERCENTAGE' ? `${d.discountValue}%` : rm(d.discountValue),
        minOrder: d.minOrderAmount == null ? null : money(d.minOrderAmount),
        used: d.usedCount,
        maxUses: d.maxUses,
        active: d.isActive,
        expiresAt: d.expiresAt,
        expired: !!d.expiresAt && d.expiresAt < new Date(),
      }));
    },
  },

  {
    name: 'create_discount_code',
    description:
      'Create a discount code. For a percentage discount pass percent (e.g. 15 for 15% off). For a fixed discount pass amountRm in ringgit. Exactly one of the two.',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'e.g. RAYA25. Case-insensitive at checkout.' },
        percent: { type: 'number', description: 'Percentage off, 1-100.' },
        amountRm: { type: 'number', description: 'Fixed ringgit off.' },
        description: { type: 'string' },
        minOrderRm: { type: 'number', description: 'Minimum order value to qualify.' },
        maxUses: { type: 'number', description: 'Total redemptions allowed. Omit for unlimited.' },
        expiresAt: { type: 'string', description: 'YYYY-MM-DD.' },
      },
      required: ['code'],
    },
    run: async ({ prisma }, input) => {
      const hasPercent = input.percent !== undefined;
      const hasAmount = input.amountRm !== undefined;
      if (hasPercent === hasAmount) {
        throw new Error('Pass exactly one of percent (e.g. 15) or amountRm (e.g. 20).');
      }
      if (hasPercent && (input.percent <= 0 || input.percent > 100)) {
        throw new Error('percent must be between 1 and 100.');
      }
      const d = await prisma.discountCode.create({
        data: {
          code: String(input.code).trim().toUpperCase(),
          description: input.description ?? null,
          discountType: hasPercent ? 'PERCENTAGE' : 'FIXED_AMOUNT',
          // A percentage is stored as a whole number, a fixed amount as cents —
          // the same column carries both, so the unit depends on the type.
          discountValue: hasPercent ? Math.round(input.percent) : toCents(input.amountRm),
          minOrderAmount: input.minOrderRm !== undefined ? toCents(input.minOrderRm) : null,
          maxUses: input.maxUses !== undefined ? Math.trunc(input.maxUses) : null,
          expiresAt: input.expiresAt ? parseDate(input.expiresAt, true) : null,
        },
      });
      return {
        discountId: d.id,
        code: d.code,
        value: hasPercent ? `${d.discountValue}%` : rm(d.discountValue),
        maxUses: d.maxUses,
        expiresAt: d.expiresAt,
      };
    },
  },

  {
    name: 'update_discount_code',
    description: 'Change a discount code — usually to deactivate it or extend its expiry.',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        discountId: { type: 'string' },
        isActive: { type: 'boolean' },
        maxUses: { type: 'number' },
        expiresAt: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['discountId'],
    },
    run: async ({ prisma }, input) => {
      const data: any = {};
      if (input.isActive !== undefined) data.isActive = input.isActive;
      if (input.maxUses !== undefined) data.maxUses = Math.trunc(input.maxUses);
      if (input.expiresAt !== undefined) data.expiresAt = parseDate(input.expiresAt, true);
      if (input.description !== undefined) data.description = input.description;
      if (!Object.keys(data).length) throw new Error('Nothing to update — pass at least one field.');
      const d = await prisma.discountCode.update({ where: { id: input.discountId }, data });
      return { discountId: d.id, code: d.code, active: d.isActive, expiresAt: d.expiresAt };
    },
  },

  {
    name: 'delete_discount_code',
    description: 'Delete a discount code outright. Deactivating it instead is usually better — it keeps the history on orders that used it.',
    write: true,
    destructive: true,
    input_schema: { type: 'object', properties: { discountId: { type: 'string' } }, required: ['discountId'] },
    summarize: async ({ prisma }, input) => {
      const d = await prisma.discountCode.findUnique({ where: { id: input.discountId } });
      if (!d) throw new Error(`No discount code with id ${input.discountId}.`);
      return `permanently delete discount code ${d.code} (used ${d.usedCount} time(s))`;
    },
    run: async ({ prisma }, input) => {
      const d = await prisma.discountCode.delete({ where: { id: input.discountId } });
      return { deleted: true, code: d.code };
    },
  },
];
