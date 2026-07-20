import type { FastifyInstance } from 'fastify';

const PUBLIC_KEYS = ['business_name', 'business_tagline', 'shipping_fee', 'whatsapp_number', 'announcement_enabled', 'announcement_text', 'online_payment_enabled', 'payment_gateway', 'hardsell_enabled', 'hardsell_product_slug', 'hardsell_headline', 'hardsell_subheadline'];

export default async function publicSettingsRoutes(fastify: FastifyInstance) {
  fastify.get('/', async () => {
    const settings = await fastify.prisma.setting.findMany({
      where: { key: { in: PUBLIC_KEYS } },
    });
    return Object.fromEntries(settings.map((s) => [s.key, s.value]));
  });
}
