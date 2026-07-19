import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import 'dotenv/config';

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

async function main() {
  // Categories
  const categories = await Promise.all([
    prisma.category.upsert({
      where: { slug: 'skin-anti-aging' },
      update: {},
      create: { name: 'Skin / Anti-Aging / Repair', slug: 'skin-anti-aging', description: 'Peptides for skin rejuvenation, anti-aging, and cellular repair', sortOrder: 1 },
    }),
    prisma.category.upsert({
      where: { slug: 'fat-loss-metabolism' },
      update: {},
      create: { name: 'Fat Loss / Metabolism', slug: 'fat-loss-metabolism', description: 'Peptides for fat loss, metabolic enhancement, and weight management', sortOrder: 2 },
    }),
    prisma.category.upsert({
      where: { slug: 'hormone-muscle-growth' },
      update: {},
      create: { name: 'Hormone / Muscle Growth', slug: 'hormone-muscle-growth', description: 'Peptides for hormone optimization and muscle development', sortOrder: 3 },
    }),
    prisma.category.upsert({
      where: { slug: 'immune-healing' },
      update: {},
      create: { name: 'Immune / Healing', slug: 'immune-healing', description: 'Peptides for immune system support and accelerated healing', sortOrder: 4 },
    }),
    prisma.category.upsert({
      where: { slug: 'supplies' },
      update: {},
      create: { name: 'Supplies', slug: 'supplies', description: 'Reconstitution supplies and accessories', sortOrder: 5 },
    }),
  ]);

  const [skinCat, fatCat, hormoneCat, immuneCat, suppliesCat] = categories;

  // Product lines (prices in sen: RM100 = 10000). Each line is one parent
  // Product (shared name/slug/description/benefits) with one or more
  // ProductVariant sizes underneath it.
  const productGroups = [
    // Skin / Anti-Aging / Repair
    { name: 'GHK-Cu', slug: 'ghk-cu', categoryId: skinCat.id, description: 'Copper peptide for skin rejuvenation and wound healing. One of the most researched peptides for anti-aging.', benefits: ['Stimulates collagen production', 'Reduces fine lines and wrinkles', 'Promotes wound healing', 'Antioxidant properties'], variants: [
      { code: 'CU50', size: '50mg', price: 10000, stock: 20 },
      { code: 'CU100', size: '100mg', price: 13000, stock: 15 },
    ] },
    { name: 'Epithalon', slug: 'epithalon', categoryId: skinCat.id, description: 'Telomerase-activating peptide that may help slow cellular aging. Known for its anti-aging and longevity properties.', benefits: ['Telomere elongation', 'Cellular anti-aging', 'Improved sleep quality', 'Enhanced immune function'], variants: [
      { code: 'ET50', size: '50mg', price: 18000, stock: 10 },
    ] },
    { name: 'Pinealon', slug: 'pinealon', categoryId: skinCat.id, description: 'Short peptide bioregulator targeting the pineal gland and central nervous system.', benefits: ['Neuroprotective effects', 'Improved cognitive function', 'Sleep regulation', 'Stress reduction'], variants: [
      { code: 'PI10', size: '10mg', price: 14000, stock: 12 },
    ] },
    { name: 'Thymalin', slug: 'thymalin', categoryId: skinCat.id, description: 'Thymic peptide that supports immune function and has anti-aging properties.', benefits: ['Immune system regulation', 'Anti-aging effects', 'Thymus gland support', 'Cellular repair'], variants: [
      { code: 'TY10', size: '10mg', price: 14000, stock: 12 },
    ] },

    // Fat Loss / Metabolism
    { name: 'AOD9604', slug: 'aod9604', categoryId: fatCat.id, description: 'Modified fragment of human growth hormone specifically designed for fat metabolism without affecting blood sugar.', benefits: ['Targeted fat burning', 'No effect on blood sugar', 'Stimulates lipolysis', 'Inhibits lipogenesis'], variants: [
      { code: 'AOD10', size: '10mg', price: 15000, stock: 18 },
    ] },
    { name: '5-Amino-1MQ', slug: '5-amino-1mq', categoryId: fatCat.id, description: 'Small molecule that blocks NNMT enzyme, boosting cellular energy expenditure and fat metabolism.', benefits: ['Increased metabolic rate', 'Enhanced fat oxidation', 'Improved cellular energy', 'Muscle preservation during fat loss'], variants: [
      { code: '50AM', size: '50mg', price: 15000, stock: 14 },
    ] },
    { name: 'MOTS-c', slug: 'mots-c', categoryId: fatCat.id, description: 'Mitochondrial-derived peptide that improves metabolic function and exercise capacity.', benefits: ['Improved insulin sensitivity', 'Enhanced exercise performance', 'Metabolic homeostasis', 'Fat loss support'], variants: [
      { code: 'MS10', size: '10mg', price: 15000, stock: 16 },
      { code: 'MS40', size: '40mg', price: 32000, stock: 8 },
    ] },
    { name: 'Retatrutide', slug: 'retatrutide', categoryId: fatCat.id, description: 'Triple agonist peptide targeting GLP-1, GIP, and glucagon receptors for comprehensive weight management.', benefits: ['Significant weight loss', 'Appetite suppression', 'Improved glycemic control', 'Triple receptor activation'], variants: [
      { code: 'RETA10', size: '10mg', price: 13500, stock: 20 },
      { code: 'RETA20', size: '20mg', price: 19000, stock: 15 },
      { code: 'RETA30', size: '30mg', price: 23000, stock: 10 },
    ] },

    // Hormone / Muscle Growth
    { name: 'HGH', slug: 'hgh', categoryId: hormoneCat.id, description: 'Recombinant human growth hormone for muscle growth, recovery, and anti-aging.', benefits: ['Muscle growth', 'Fat loss', 'Improved recovery', 'Anti-aging effects'], variants: [
      { code: 'H36', size: '36IU', price: 21000, stock: 10 },
    ] },
    { name: 'IGF-1LR3', slug: 'igf-1lr3', categoryId: hormoneCat.id, description: 'Long-acting insulin-like growth factor for muscle hypertrophy and recovery.', benefits: ['Muscle hypertrophy', 'Enhanced recovery', 'Cell proliferation', 'Nutrient partitioning'], variants: [
      { code: 'IGF-1', size: '1mg', price: 18000, stock: 12 },
    ] },
    { name: 'Tesamorelin', slug: 'tesamorelin', categoryId: hormoneCat.id, description: 'Growth hormone releasing hormone analog that stimulates natural GH production.', benefits: ['Natural GH stimulation', 'Visceral fat reduction', 'Improved body composition', 'Cognitive benefits'], variants: [
      { code: 'TESA10', size: '10mg', price: 12500, stock: 18 },
      { code: 'TESA20', size: '20mg', price: 19500, stock: 12 },
    ] },
    { name: 'Tesamorelin + Ipamorelin', slug: 'tesamorelin-ipamorelin-combo', categoryId: hormoneCat.id, description: 'Synergistic combination of Tesamorelin and Ipamorelin for optimized growth hormone release.', benefits: ['Synergistic GH release', 'Enhanced fat loss', 'Improved sleep', 'Better recovery'], variants: [
      { code: 'TESA-IPAMORELIN', size: '5mg + 5mg', price: 12500, stock: 14 },
    ] },

    // Immune / Healing
    { name: 'Thymosin Alpha-1', slug: 'thymosin-alpha-1', categoryId: immuneCat.id, description: 'Potent immune modulator that enhances T-cell function and immune response.', benefits: ['Enhanced T-cell function', 'Immune system boost', 'Antiviral properties', 'Improved vaccine response'], variants: [
      { code: 'TA10', size: '10mg', price: 13500, stock: 15 },
    ] },
    { name: 'KPV', slug: 'kpv', categoryId: immuneCat.id, description: 'Anti-inflammatory tripeptide derived from alpha-MSH with powerful healing properties.', benefits: ['Anti-inflammatory', 'Gut healing', 'Antimicrobial', 'Wound healing support'], variants: [
      { code: 'KPV10', size: '10mg', price: 13500, stock: 15 },
    ] },
    { name: 'PE-22-28', slug: 'pe-22-28', categoryId: immuneCat.id, description: 'Neuroprotective peptide derived from the pigment epithelium-derived factor.', benefits: ['Neuroprotection', 'Cognitive enhancement', 'Neuronal survival', 'Brain health support'], variants: [
      { code: 'PE10', size: '10mg', price: 13500, stock: 15 },
    ] },

    // Supplies
    { name: 'Acetic Acid', slug: 'acetic-acid', categoryId: suppliesCat.id, description: 'Sterile acetic acid solution for peptide reconstitution. Essential supply for preparing peptides.', benefits: ['Sterile reconstitution', 'Proper peptide preparation', 'Essential accessory'], variants: [
      { code: 'AA10', size: '10ml', price: 2500, stock: 50 },
    ] },
  ];

  const defaultCoaUrl = 'https://verify.janoshik.com/tests/155584-Blind_GLP_C5AGHBRFFNYY';

  for (const group of productGroups) {
    const parent = await prisma.product.upsert({
      where: { slug: group.slug },
      update: {},
      create: {
        name: group.name,
        slug: group.slug,
        categoryId: group.categoryId,
        description: group.description,
        benefits: JSON.stringify(group.benefits),
        coaUrl: defaultCoaUrl,
      },
    });

    for (const variant of group.variants) {
      await prisma.productVariant.upsert({
        where: { code: variant.code },
        update: {},
        create: { ...variant, productId: parent.id },
      });
    }
  }

  // Admin user — never ship a hardcoded production password. Require an explicit
  // ADMIN_INITIAL_PASSWORD (min 12 chars). Only fall back to a known dev password
  // outside production, and warn loudly.
  const adminEmail = process.env.ADMIN_INITIAL_EMAIL || 'admin@ascend.my';
  let adminPassword = process.env.ADMIN_INITIAL_PASSWORD;
  if (!adminPassword) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ADMIN_INITIAL_PASSWORD is required when seeding in production');
    }
    adminPassword = 'admin123';
    console.warn('⚠️  Seeding admin with the default dev password "admin123" — set ADMIN_INITIAL_PASSWORD for any real deploy.');
  }
  if (adminPassword.length < 12 && process.env.NODE_ENV === 'production') {
    throw new Error('ADMIN_INITIAL_PASSWORD must be at least 12 characters');
  }
  const passwordHash = await bcrypt.hash(adminPassword, 12);
  await prisma.adminUser.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      passwordHash,
      name: 'Admin',
    },
  });

  // Default settings
  const settings = [
    { key: 'whatsapp_number', value: '601161092723' },
    { key: 'business_name', value: 'ASCEND' },
    { key: 'business_tagline', value: 'Premium Peptides Malaysia' },
  ];

  for (const setting of settings) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      update: {},
      create: setting,
    });
  }

  const variantCount = productGroups.reduce((sum, g) => sum + g.variants.length, 0);
  console.log(`Seed completed: 5 categories, ${productGroups.length} products (${variantCount} variants), 1 admin user, 3 settings`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
