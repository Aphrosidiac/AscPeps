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

  // Products (prices in sen: RM100 = 10000)
  const products = [
    // Skin / Anti-Aging / Repair
    { code: 'CU50', name: 'GHK-Cu', slug: 'ghk-cu-50mg', categoryId: skinCat.id, size: '50mg', price: 10000, stock: 20, description: 'Copper peptide for skin rejuvenation and wound healing. One of the most researched peptides for anti-aging.', benefits: JSON.stringify(['Stimulates collagen production', 'Reduces fine lines and wrinkles', 'Promotes wound healing', 'Antioxidant properties']) },
    { code: 'CU100', name: 'GHK-Cu', slug: 'ghk-cu-100mg', categoryId: skinCat.id, size: '100mg', price: 13000, stock: 15, description: 'Higher dose copper peptide for enhanced skin rejuvenation and anti-aging benefits.', benefits: JSON.stringify(['Enhanced collagen synthesis', 'Deep wrinkle reduction', 'Skin elasticity improvement', 'Tissue repair']) },
    { code: 'ET50', name: 'Epithalon', slug: 'epithalon-50mg', categoryId: skinCat.id, size: '50mg', price: 18000, stock: 10, description: 'Telomerase-activating peptide that may help slow cellular aging. Known for its anti-aging and longevity properties.', benefits: JSON.stringify(['Telomere elongation', 'Cellular anti-aging', 'Improved sleep quality', 'Enhanced immune function']) },
    { code: 'PI10', name: 'Pinealon', slug: 'pinealon-10mg', categoryId: skinCat.id, size: '10mg', price: 14000, stock: 12, description: 'Short peptide bioregulator targeting the pineal gland and central nervous system.', benefits: JSON.stringify(['Neuroprotective effects', 'Improved cognitive function', 'Sleep regulation', 'Stress reduction']) },
    { code: 'TY10', name: 'Thymalin', slug: 'thymalin-10mg', categoryId: skinCat.id, size: '10mg', price: 14000, stock: 12, description: 'Thymic peptide that supports immune function and has anti-aging properties.', benefits: JSON.stringify(['Immune system regulation', 'Anti-aging effects', 'Thymus gland support', 'Cellular repair']) },

    // Fat Loss / Metabolism
    { code: 'AOD10', name: 'AOD9604', slug: 'aod9604-10mg', categoryId: fatCat.id, size: '10mg', price: 15000, stock: 18, description: 'Modified fragment of human growth hormone specifically designed for fat metabolism without affecting blood sugar.', benefits: JSON.stringify(['Targeted fat burning', 'No effect on blood sugar', 'Stimulates lipolysis', 'Inhibits lipogenesis']) },
    { code: '50AM', name: '5-Amino-1MQ', slug: '5-amino-1mq-50mg', categoryId: fatCat.id, size: '50mg', price: 15000, stock: 14, description: 'Small molecule that blocks NNMT enzyme, boosting cellular energy expenditure and fat metabolism.', benefits: JSON.stringify(['Increased metabolic rate', 'Enhanced fat oxidation', 'Improved cellular energy', 'Muscle preservation during fat loss']) },
    { code: 'MS10', name: 'MOTS-c', slug: 'mots-c-10mg', categoryId: fatCat.id, size: '10mg', price: 15000, stock: 16, description: 'Mitochondrial-derived peptide that improves metabolic function and exercise capacity.', benefits: JSON.stringify(['Improved insulin sensitivity', 'Enhanced exercise performance', 'Metabolic homeostasis', 'Fat loss support']) },
    { code: 'MS40', name: 'MOTS-c', slug: 'mots-c-40mg', categoryId: fatCat.id, size: '40mg', price: 32000, stock: 8, description: 'Higher dose MOTS-c for enhanced metabolic support and fat loss.', benefits: JSON.stringify(['Stronger metabolic effects', 'Improved insulin sensitivity', 'Enhanced exercise capacity', 'Long-term metabolic health']) },
    { code: 'RETA10', name: 'Retatrutide', slug: 'retatrutide-10mg', categoryId: fatCat.id, size: '10mg', price: 13500, stock: 20, description: 'Triple agonist peptide targeting GLP-1, GIP, and glucagon receptors for comprehensive weight management.', benefits: JSON.stringify(['Significant weight loss', 'Appetite suppression', 'Improved glycemic control', 'Triple receptor activation']) },
    { code: 'RETA20', name: 'Retatrutide', slug: 'retatrutide-20mg', categoryId: fatCat.id, size: '20mg', price: 19000, stock: 15, description: 'Mid-range dose Retatrutide for sustained weight management.', benefits: JSON.stringify(['Enhanced weight loss', 'Appetite control', 'Metabolic improvement', 'Blood sugar regulation']) },
    { code: 'RETA30', name: 'Retatrutide', slug: 'retatrutide-30mg', categoryId: fatCat.id, size: '30mg', price: 23000, stock: 10, description: 'High dose Retatrutide for maximum weight management support.', benefits: JSON.stringify(['Maximum weight loss support', 'Strong appetite suppression', 'Comprehensive metabolic benefits', 'Long-lasting effects']) },

    // Hormone / Muscle Growth
    { code: 'H36', name: 'HGH', slug: 'hgh-36iu', categoryId: hormoneCat.id, size: '36IU', price: 21000, stock: 10, description: 'Recombinant human growth hormone for muscle growth, recovery, and anti-aging.', benefits: JSON.stringify(['Muscle growth', 'Fat loss', 'Improved recovery', 'Anti-aging effects']) },
    { code: 'IGF-1', name: 'IGF-1LR3', slug: 'igf-1lr3-1mg', categoryId: hormoneCat.id, size: '1mg', price: 18000, stock: 12, description: 'Long-acting insulin-like growth factor for muscle hypertrophy and recovery.', benefits: JSON.stringify(['Muscle hypertrophy', 'Enhanced recovery', 'Cell proliferation', 'Nutrient partitioning']) },
    { code: 'TESA10', name: 'Tesamorelin', slug: 'tesamorelin-10mg', categoryId: hormoneCat.id, size: '10mg', price: 12500, stock: 18, description: 'Growth hormone releasing hormone analog that stimulates natural GH production.', benefits: JSON.stringify(['Natural GH stimulation', 'Visceral fat reduction', 'Improved body composition', 'Cognitive benefits']) },
    { code: 'TESA20', name: 'Tesamorelin', slug: 'tesamorelin-20mg', categoryId: hormoneCat.id, size: '20mg', price: 19500, stock: 12, description: 'Higher dose Tesamorelin for enhanced growth hormone release.', benefits: JSON.stringify(['Enhanced GH release', 'Greater fat reduction', 'Improved lean mass', 'Better sleep quality']) },
    { code: 'TESA-IPAMORELIN', name: 'Tesamorelin + Ipamorelin', slug: 'tesamorelin-ipamorelin-combo', categoryId: hormoneCat.id, size: '5mg + 5mg', price: 12500, stock: 14, description: 'Synergistic combination of Tesamorelin and Ipamorelin for optimized growth hormone release.', benefits: JSON.stringify(['Synergistic GH release', 'Enhanced fat loss', 'Improved sleep', 'Better recovery']) },

    // Immune / Healing
    { code: 'TA10', name: 'Thymosin Alpha-1', slug: 'thymosin-alpha-1-10mg', categoryId: immuneCat.id, size: '10mg', price: 13500, stock: 15, description: 'Potent immune modulator that enhances T-cell function and immune response.', benefits: JSON.stringify(['Enhanced T-cell function', 'Immune system boost', 'Antiviral properties', 'Improved vaccine response']) },
    { code: 'KPV10', name: 'KPV', slug: 'kpv-10mg', categoryId: immuneCat.id, size: '10mg', price: 13500, stock: 15, description: 'Anti-inflammatory tripeptide derived from alpha-MSH with powerful healing properties.', benefits: JSON.stringify(['Anti-inflammatory', 'Gut healing', 'Antimicrobial', 'Wound healing support']) },
    { code: 'PE10', name: 'PE-22-28', slug: 'pe-22-28-10mg', categoryId: immuneCat.id, size: '10mg', price: 13500, stock: 15, description: 'Neuroprotective peptide derived from the pigment epithelium-derived factor.', benefits: JSON.stringify(['Neuroprotection', 'Cognitive enhancement', 'Neuronal survival', 'Brain health support']) },

    // Supplies
    { code: 'AA10', name: 'Acetic Acid', slug: 'acetic-acid-10ml', categoryId: suppliesCat.id, size: '10ml', price: 2500, stock: 50, description: 'Sterile acetic acid solution for peptide reconstitution. Essential supply for preparing peptides.', benefits: JSON.stringify(['Sterile reconstitution', 'Proper peptide preparation', 'Essential accessory']) },
  ];

  for (const product of products) {
    await prisma.product.upsert({
      where: { code: product.code },
      update: {},
      create: product,
    });
  }

  // Admin user
  const passwordHash = await bcrypt.hash('admin123', 12);
  await prisma.adminUser.upsert({
    where: { email: 'admin@ascend.my' },
    update: {},
    create: {
      email: 'admin@ascend.my',
      passwordHash,
      name: 'Admin',
    },
  });

  // Default settings
  const settings = [
    { key: 'whatsapp_number', value: '60123456789' },
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

  console.log('Seed completed: 5 categories, 21 products, 1 admin user, 3 settings');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
