// Rewrites the 25 active, browsable product `description` fields that still carry
// human-use / therapeutic / cosmetic claims ("injectable for detoxification and
// skin brightening", "for hormone replacement and performance", "antioxidant
// therapy", ...) or are simply missing the site's research-use-only framing.
//
// WHY: every other product on the site already reads as research supply —
// "<compound> is a <class> studied for <area> research ... supplied by ASCEND in
// Malaysia for laboratory research use only". These 25 were the holdouts, and on a
// regulated-substance catalogue an outcome claim is the part that turns a listing
// into an advertisement for human use. This normalises all of them onto the house
// voice: describe the compound and the research area, never a benefit to a person.
//
// SCOPE — this is a COPY fix, not a compliance ruling. It does not decide whether
// glutathione (NPRA Negative List), tirzepatide (Group B Poison) or the two
// testosterone esters (Poisons Act) may be listed for sale at all. That call is
// still open and needs an actual legal decision, not a rewrite.
//
// Usage: node scripts/fix-product-description-claims.mjs [--dry-run]
//   (needs DATABASE_URL — on the VPS: set -a && source .env && set +a)

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { writeFileSync } from 'fs';

const adapter = new PrismaPg(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter });

const DRY_RUN = process.argv.includes('--dry-run');

const RUO = 'supplied by ASCEND in Malaysia for laboratory research use only.';

// Keyed by slug. Sizes referenced here were read off product_variants in
// production — keep them in sync if a variant is added or renamed.
const DESCRIPTIONS = {
  'acetic-acid':
    `Dilute acetic acid (10ml) is a reconstitution solvent used in peptide research to dissolve compounds that are poorly soluble in bacteriostatic water, such as AOD peptides and certain fragments. Sterile-filtered and research grade, ${RUO}`,

  'alpha-lipoic-acid':
    `Alpha-lipoic acid (ALA) is a naturally occurring dithiol compound studied as a mitochondrial enzyme cofactor and in antioxidant and oxidative-stress research. Supplied as a 25mg / 5ml liquid vial, independently third-party tested, ${RUO}`,

  'bpc-157':
    `BPC-157 (Body Protection Compound-157) is a synthetic pentadecapeptide derived from a sequence found in human gastric juice, widely studied in regenerative research covering muscle, tendon, ligament and gut tissue. Available in 10mg and 40mg lyophilised vials, 99%+ purity and independently third-party tested, ${RUO}`,

  cartalax:
    `Cartalax (Ala-Glu-Asp) is a short synthetic bioregulator peptide studied in cartilage and connective-tissue research. Supplied as a 20mg lyophilised vial, 99%+ purity and independently third-party tested, ${RUO}`,

  cerebrolysin:
    `Cerebrolysin is a preparation of low-molecular-weight neuropeptides and free amino acids studied in neurotrophic-signalling and neuroprotection research. Supplied as a 30mg vial, independently third-party tested, ${RUO}`,

  'cjc-1295-ipamorelin':
    `A research blend of CJC-1295 (a GHRH analogue) and Ipamorelin (a growth hormone secretagogue), studied together for sustained growth-hormone-release research. Supplied as a 5mg + 5mg lyophilised vial, 99%+ purity and independently third-party tested, ${RUO}`,

  dsip:
    `DSIP (Delta Sleep-Inducing Peptide) is a nonapeptide studied in sleep-architecture and stress-response research. Supplied as a 10mg lyophilised vial, 99%+ purity and independently third-party tested, ${RUO}`,

  epithalon:
    `Epithalon is a synthetic tetrapeptide (Ala-Glu-Asp-Gly) studied for its reported effect on telomerase activity, and used widely in cellular-longevity and aging research. Available in 10mg and 50mg lyophilised vials, 99%+ purity and independently third-party tested, ${RUO}`,

  'foxo4-dri':
    `FOXO4-DRI is a synthetic retro-inverso peptide studied in senolytic research for its interaction with the FOXO4-p53 pathway in senescent cells. Supplied as a 10mg lyophilised vial, 99%+ purity and independently third-party tested, ${RUO}`,

  'ginkgo-biloba-extract':
    `Ginkgo biloba extract is a standardised plant-derived preparation containing flavone glycosides and terpene lactones, studied in cognitive and microcirculation research. Supplied as a 17.5mg / 5ml liquid vial, independently third-party tested, ${RUO}`,

  // NPRA Negative List compound — the previous copy ("detoxification and skin
  // brightening") was an explicit cosmetic claim and the single riskiest line of
  // copy on the site. Reduced to compound description only.
  glutathione:
    `Glutathione is an endogenous tripeptide (glutamate-cysteine-glycine) studied as a primary intracellular antioxidant and in redox-balance and oxidative-stress research. Supplied as a 1200mg lyophilised vial, 99%+ purity and independently third-party tested, ${RUO}`,

  ipamorelin:
    `Ipamorelin is a selective growth hormone secretagogue studied for GH release with minimal effect on cortisol and prolactin in published research. Supplied as a 10mg lyophilised vial, 99%+ purity and independently third-party tested, ${RUO}`,

  // Previous copy was truncated mid-sentence and read as pasted vendor marketing
  // ("It's marketed as a multi-pathway healing").
  KW80:
    `KLOW (KW80) is a four-part research blend combining GHK-Cu (50mg), BPC-157 (10mg), TB-500 (10mg) and KPV (10mg) in a single vial, studied across tissue-repair, inflammation and skin- and gut-barrier research. Supplied as an 80mg lyophilised vial, 99%+ purity and independently third-party tested, ${RUO}`,

  'multi-minerals':
    `A multi-mineral complex supplied as a 10ml liquid vial for laboratory preparation and research use. Independently third-party tested, ${RUO}`,

  p021:
    `P021 is a small tetrapeptide derivative of a CNTF (ciliary neurotrophic factor) active region, studied in neurogenesis and neurotrophic-signalling research. Supplied as a 10mg lyophilised vial, 99%+ purity and independently third-party tested, ${RUO}`,

  'pdrn-kfda-grade':
    `PDRN (polydeoxyribonucleotide) is a DNA-derived polymer studied via the adenosine A2A receptor pathway in tissue-repair, angiogenesis and inflammation research. Supplied as a ready-to-use 5.625mg / 3ml liquid vial, independently third-party tested, ${RUO}`,

  selank:
    `Selank is a synthetic heptapeptide analogue of tuftsin studied in anxiolytic, nootropic and immunomodulation research. Supplied as a 10mg lyophilised vial, 99%+ purity and independently third-party tested, ${RUO}`,

  semax:
    `Semax is a synthetic peptide derived from an ACTH(4-10) fragment, studied in cognitive-function and neuroprotection research, including its reported effect on BDNF expression. Supplied as a 10mg lyophilised vial, 99%+ purity and independently third-party tested, ${RUO}`,

  'ss31-elamipretide':
    `SS-31 (elamipretide) is a mitochondria-targeted tetrapeptide studied for its binding to cardiolipin in the inner mitochondrial membrane, used in cellular-bioenergetics and mitochondrial-function research. Available in 10mg, 30mg and 50mg lyophilised vials, 99%+ purity and independently third-party tested, ${RUO}`,

  'tb500-fragment':
    `TB-500 Fragment is the shorter active segment of Thymosin Beta-4, studied in wound-healing and tissue-repair research. Supplied as a 10mg lyophilised vial, 99%+ purity and independently third-party tested, ${RUO}`,

  'tb500-full-chain':
    `Full-length Thymosin Beta-4 (TB-500) is a 43-amino-acid peptide widely studied in cell-migration, wound-healing and inflammation research. Supplied as a 10mg lyophilised vial, 99%+ purity and independently third-party tested, ${RUO}`,

  // Poisons Act-controlled. Previous copy read "for sustained hormone release",
  // i.e. a use claim.
  'testosterone-blend-sustaviron':
    `A multi-ester testosterone blend supplied as a 250mg / 10ml oil-based vial, studied in endocrine research for its staggered ester-release profile. Independently third-party tested, ${RUO}`,

  // Poisons Act-controlled. Previous copy read "for hormone replacement and
  // performance" — an explicit human therapeutic + performance claim.
  'testosterone-enanthate':
    `Testosterone enanthate is a long-chain testosterone ester supplied as a 250mg / 10ml oil-based vial, studied in endocrine and androgen-receptor research for its extended release profile. Independently third-party tested, ${RUO}`,

  tirzepatide:
    `Tirzepatide is a dual GIP/GLP-1 receptor agonist studied in glucose-metabolism and body-weight-regulation research. Supplied as a 30mg lyophilised vial, 99%+ purity and independently third-party tested, ${RUO}`,

  'vitamin-c':
    `High-concentration ascorbic acid supplied as a 10g / 20ml liquid vial, studied in antioxidant and redox research. Independently third-party tested, ${RUO}`,
};

// Phrases that must not survive anywhere in the rewritten copy. Purely a
// self-check on the text above so a careless future edit can't reintroduce a
// use-claim without the script refusing to run.
const BANNED = [
  /\bskin brightening\b/i,
  /\bdetoxification\b/i,
  /\bhormone replacement\b/i,
  /\btherapy\b/i,
  /\btreatment\b/i,
  /\binjectable for\b/i,
  /\bsupplementation\b/i,
  /\bmarketed as\b/i,
];

async function main() {
  const slugs = Object.keys(DESCRIPTIONS);

  // Self-check the new copy before touching anything.
  const violations = [];
  for (const [slug, text] of Object.entries(DESCRIPTIONS)) {
    for (const rx of BANNED) if (rx.test(text)) violations.push(`${slug}: ${rx}`);
    if (!text.endsWith(RUO)) violations.push(`${slug}: missing research-use-only tail`);
  }
  if (violations.length) {
    console.error('New copy failed its own checks:\n  ' + violations.join('\n  '));
    process.exit(1);
  }

  const existing = await prisma.product.findMany({
    where: { slug: { in: slugs } },
    select: { id: true, slug: true, description: true },
  });

  const missing = slugs.filter((s) => !existing.some((p) => p.slug === s));
  if (missing.length) {
    console.error(`Slugs not found in DB (aborting): ${missing.join(', ')}`);
    process.exit(1);
  }

  const backupPath = `/tmp/product-descriptions-backup-${slugs.length}.json`;
  writeFileSync(backupPath, JSON.stringify(existing, null, 2));
  console.log(`Backed up ${existing.length} pre-state rows to ${backupPath}\n`);

  for (const product of existing) {
    const next = DESCRIPTIONS[product.slug];
    if (product.description === next) {
      console.log(`= ${product.slug} (already current)`);
      continue;
    }
    console.log(`${DRY_RUN ? '~' : '+'} ${product.slug}`);
    console.log(`    was: ${product.description ?? '(null)'}`);
    console.log(`    now: ${next}`);
    if (!DRY_RUN) {
      await prisma.product.update({
        where: { id: product.id },
        data: { description: next },
      });
    }
  }

  console.log(`\n${DRY_RUN ? 'DRY RUN — nothing written.' : `Updated ${existing.length} products.`}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
