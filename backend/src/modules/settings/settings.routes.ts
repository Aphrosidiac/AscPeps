import type { FastifyInstance } from 'fastify';

const PUBLIC_KEYS = [
  'business_name', 'business_tagline', 'shipping_fee', 'whatsapp_number',
  'announcement_enabled', 'announcement_text', 'online_payment_enabled', 'payment_gateway',
  'hardsell_enabled', 'hardsell_product_slug', 'hardsell_headline', 'hardsell_subheadline',
  'hardsell_slide2_enabled', 'hardsell_slide2_product_slug', 'hardsell_slide2_headline', 'hardsell_slide2_subheadline',
  // Newsletter capture. Only the popup's on/off flag and its copy are public —
  // the welcome discount percentage is NOT, because publishing it would let
  // anyone read the offer without joining the list, and the code itself is
  // minted per-subscriber server-side anyway.
  'newsletter_popup_enabled', 'newsletter_popup_heading', 'newsletter_popup_body',
];

export default async function publicSettingsRoutes(fastify: FastifyInstance) {
  fastify.get('/', async () => {
    const settings = await fastify.prisma.setting.findMany({
      where: { key: { in: PUBLIC_KEYS } },
    });
    return Object.fromEntries(settings.map((s) => [s.key, s.value]));
  });
}
