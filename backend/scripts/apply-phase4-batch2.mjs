// Applies Phase 4 Batch 2 content (benefits + dosageInfo) for the 27 products that
// currently have neither field populated. Backs up pre-state before writing.
// Deliberately excludes: tirzepatide-30mg, testosterone-blend-sustanon-250mg,
// testosterone-enanthate-250mg, glutathione-600mg (compliance hold — see
// ascendpeptides.my-audit/PHASE4-CONTENT-DRAFT-BATCH2.md) and epithalon-50mg,
// kpv-10mg (already have live content, not touched).
//
// Usage: DATABASE_URL=... node scripts/apply-phase4-batch2.mjs [--dry-run]

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { writeFileSync } from 'fs';

const adapter = new PrismaPg(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter });

const DRY_RUN = process.argv.includes('--dry-run');

const PRODUCTS = {
  'nad-100mg': {
    benefits: [
      'Coenzyme central to cellular energy metabolism and mitochondrial function',
      'Studied for sirtuin (SIRT1/SIRT3) activation and DNA-repair (PARP1) research',
      '99%+ purity, third-party tested with COA',
      'Lyophilised 100mg vial',
      'Nationwide delivery across Malaysia',
    ],
    dosageInfo:
      "NAD+ (nicotinamide adenine dinucleotide) is a coenzyme central to cellular energy metabolism, studied for its role in mitochondrial oxidative phosphorylation and as the required substrate for sirtuin enzymes (SIRT1, SIRT3), which are researched in relation to mitochondrial biogenesis and cellular stress response. It is also studied in the context of DNA repair via PARP1, and its age-related decline is an active area of aging and longevity research. A human pilot study characterised the plasma and urine pharmacokinetics of intravenously administered NAD+, finding rapid initial tissue uptake followed by a rise in circulating NAD+ metabolites. No published research differentiates outcomes at different injectable doses — this vial's 100mg quantity reflects peptide supplied for research use, not a studied dose-response tier. Reconstitute with bacteriostatic water, swirl gently (do not shake), and store unreconstituted vials at 2-8°C short-term or -20°C for long-term storage. Refrigerate (2-8°C) once reconstituted and use within the period in our Peptide Guide. For laboratory research purposes only.",
  },
  'nad-500mg': {
    benefits: [
      'Coenzyme central to cellular energy metabolism and mitochondrial function',
      'Studied for sirtuin (SIRT1/SIRT3) activation and DNA-repair (PARP1) research',
      '99%+ purity, third-party tested with COA',
      'Lyophilised 500mg vial',
      'Nationwide delivery across Malaysia',
    ],
    dosageInfo:
      "NAD+ (nicotinamide adenine dinucleotide) is a coenzyme central to cellular energy metabolism, studied for its role in mitochondrial oxidative phosphorylation and as the required substrate for sirtuin enzymes (SIRT1, SIRT3), which are researched in relation to mitochondrial biogenesis and cellular stress response. It is also studied in the context of DNA repair via PARP1, and its age-related decline is an active area of aging and longevity research. A human pilot study characterised the plasma and urine pharmacokinetics of intravenously administered NAD+, finding rapid initial tissue uptake followed by a rise in circulating NAD+ metabolites. No published research differentiates outcomes at different injectable doses — this vial's 500mg quantity reflects peptide supplied for research use, not a studied dose-response tier. Reconstitute with bacteriostatic water, swirl gently (do not shake), and store unreconstituted vials at 2-8°C short-term or -20°C for long-term storage. Refrigerate (2-8°C) once reconstituted and use within the period in our Peptide Guide. For laboratory research purposes only.",
  },
  'nad-1000mg': {
    benefits: [
      'Coenzyme central to cellular energy metabolism and mitochondrial function',
      'Studied for sirtuin (SIRT1/SIRT3) activation and DNA-repair (PARP1) research',
      '99%+ purity, third-party tested with COA',
      'Lyophilised 1000mg vial',
      'Nationwide delivery across Malaysia',
    ],
    dosageInfo:
      "NAD+ (nicotinamide adenine dinucleotide) is a coenzyme central to cellular energy metabolism, studied for its role in mitochondrial oxidative phosphorylation and as the required substrate for sirtuin enzymes (SIRT1, SIRT3), which are researched in relation to mitochondrial biogenesis and cellular stress response. It is also studied in the context of DNA repair via PARP1, and its age-related decline is an active area of aging and longevity research. A human pilot study characterised the plasma and urine pharmacokinetics of intravenously administered NAD+, finding rapid initial tissue uptake followed by a rise in circulating NAD+ metabolites. No published research differentiates outcomes at different injectable doses — this vial's 1000mg quantity reflects peptide supplied for research use, not a studied dose-response tier. Reconstitute with bacteriostatic water, swirl gently (do not shake), and store unreconstituted vials at 2-8°C short-term or -20°C for long-term storage. Refrigerate (2-8°C) once reconstituted and use within the period in our Peptide Guide. For laboratory research purposes only.",
  },
  'pdrn-3ml': {
    benefits: [
      'Polydeoxyribonucleotide studied via the adenosine A2A receptor pathway',
      'Researched for tissue repair, angiogenesis and inflammation modulation',
      '99%+ purity, third-party tested with COA',
      'Liquid 5.625mg / 3ml vial, ready to use',
      'Nationwide delivery across Malaysia',
    ],
    dosageInfo:
      "PDRN (polydeoxyribonucleotide) has been studied for its interaction with the adenosine A2A receptor, proposed as the mechanism behind effects observed in research models — including modulation of inflammatory cytokines (TNF-α, IL-6, IL-1β), promotion of angiogenesis, and support for tissue and wound-healing processes in preclinical and some clinical research settings such as diabetic and incisional wound models. This is a liquid formulation supplied ready for research use — no reconstitution required. Store at 2-8°C, protect from light, and use within the period recommended in our Peptide Guide once opened. For laboratory research purposes only.",
  },
  'ginkgo-biloba-extract-5ml': {
    benefits: [
      'Standardised flavonoid glycoside and terpene lactone extract',
      'Studied for cerebral blood flow, antioxidant and neuroprotective research',
      '99%+ purity, third-party tested with COA',
      'Liquid 17.5mg / 5ml vial, ready to use',
      'Nationwide delivery across Malaysia',
    ],
    dosageInfo:
      "Ginkgo Biloba's standardised extract — primarily flavonoid glycosides and terpene lactones — has been studied for antioxidant activity, circulatory and microcirculatory effects, and neuroprotective mechanisms in preclinical and clinical research, including modulation of cerebral blood flow and reduction of oxidative stress markers. A pilot MR-perfusion imaging study found a modest, region-specific increase in cerebral blood flow after four weeks of supplementation in healthy elderly subjects. This is a liquid formulation supplied ready for research use — no reconstitution required. Store at 2-8°C, protect from light, and use within the period recommended in our Peptide Guide once opened. For laboratory research purposes only.",
  },
  'alpha-lipoic-acid-600mg': {
    benefits: [
      'Mitochondrial cofactor studied for antioxidant activity',
      'Researched for glucose metabolism and peripheral nerve research',
      '99%+ purity, third-party tested with COA',
      'Liquid 25mg / 5ml vial, ready to use',
      'Nationwide delivery across Malaysia',
    ],
    dosageInfo:
      "Alpha lipoic acid is a naturally occurring dithiol compound studied as a mitochondrial enzyme cofactor and researched for antioxidant activity — direct free-radical scavenging plus regeneration of glutathione — and for its investigated role in glucose-uptake and insulin-signalling pathways. It has also been studied in peripheral nerve and neuropathy research, though a recent meta-analysis found favourable effects on symptom scores without significant improvement in objective nerve-conduction measures. This is a liquid formulation supplied ready for research use — no reconstitution required. Store at 2-8°C, protect from light, and use within the period recommended in our Peptide Guide once opened. For laboratory research purposes only.",
  },
  'multi-minerals-5ml': {
    benefits: [
      'Multi-mineral complex for nutritional and metabolic research',
      '99%+ purity, third-party tested with COA',
      'Liquid 10ml vial, ready to use',
      'Nationwide delivery across Malaysia',
    ],
    dosageInfo:
      'This is a multi-mineral complex supplied for research use in nutritional and metabolic research contexts. This is a liquid formulation supplied ready for research use — no reconstitution required. Store at 2-8°C, protect from light. For laboratory research purposes only.',
  },
  'vitamin-c-10g-20ml': {
    benefits: [
      'Water-soluble antioxidant and collagen-synthesis cofactor',
      'Studied for parenteral pharmacokinetics distinct from oral dosing',
      '99%+ purity, third-party tested with COA',
      'Liquid 10g / 20ml vial, ready to use',
      'Nationwide delivery across Malaysia',
    ],
    dosageInfo:
      "Ascorbic acid (Vitamin C) is studied as an essential enzymatic cofactor for collagen hydroxylation and synthesis pathways, and as a water-soluble antioxidant researched for free-radical scavenging. Its pharmacokinetics differ substantially by route of administration — parenteral delivery produces plasma concentrations far exceeding what oral dosing can achieve, which is why high-dose injectable vitamin C is studied as a distinct research context from oral vitamin C. This is a liquid formulation supplied ready for research use — no reconstitution required. Store at 2-8°C, protect from light, and use within the period recommended in our Peptide Guide once opened. For laboratory research purposes only.",
  },
  'cartalax-20mg': {
    benefits: [
      'AED tripeptide bioregulator from the Khavinson research programme',
      'Studied in tissue-aging and cell-culture research',
      '99%+ purity, third-party tested with COA',
      'Lyophilised 20mg vial',
      'Nationwide delivery across Malaysia',
    ],
    dosageInfo:
      'Cartalax is a short synthetic peptide bioregulator based on the AED (Ala-Glu-Asp) tripeptide, developed within the Khavinson peptide bioregulator research programme. The AED peptide and related short peptides from this programme have been studied in peer-reviewed literature across several tissue-aging contexts, including renal cell cultures, skin fibroblast aging and mesenchymal stem cell gene expression, with more limited literature specifically naming Cartalax in connection with animal osteoarthritis models. This is a narrower evidence base than most products on this site — described honestly here rather than overstated. Reconstitute with bacteriostatic water, swirl gently (do not shake), and store unreconstituted vials at 2-8°C short-term or -20°C for long-term storage. Refrigerate (2-8°C) once reconstituted. For laboratory research purposes only.',
  },
  'foxo4-dri-10mg': {
    benefits: [
      'Synthetic senolytic peptide disrupting the FOXO4-p53 interaction',
      'Studied in animal models for senescent-cell research',
      '99%+ purity, third-party tested with COA',
      'Lyophilised 10mg vial',
      'Nationwide delivery across Malaysia',
    ],
    dosageInfo:
      'FOXO4-DRI is a synthetic senolytic peptide studied in animal-model research for its ability to selectively induce apoptosis in senescent cells by disrupting the FOXO4-p53 interaction. Peer-reviewed animal studies have investigated its effects on age-related tissue changes including testicular, pulmonary and vascular senescence. All available research is preclinical — animal models or cultured cells, not human trials. Reconstitute with bacteriostatic water, swirl gently (do not shake), and store unreconstituted vials at 2-8°C short-term or -20°C for long-term storage. Refrigerate (2-8°C) once reconstituted. For laboratory research purposes only.',
  },
  'humanin-10mg': {
    benefits: [
      'Mitochondrial-derived peptide studied for cytoprotective activity',
      'Researched for insulin sensitivity and glucose metabolism signalling',
      '99%+ purity, third-party tested with COA',
      'Lyophilised 10mg vial',
      'Nationwide delivery across Malaysia',
    ],
    dosageInfo:
      "Humanin is one of the original mitochondrial-derived peptides, encoded in a short reading frame within mitochondrial 16S rRNA, first identified for its cytoprotective activity against Alzheimer's-associated toxicity in cultured cells. It has since been researched in animal models for its role in insulin sensitivity and glucose metabolism via central (hypothalamic) signalling, and is discussed in the literature as a prototype for mitochondrial-to-nuclear retrograde signalling. All research is in cell lines and animal models, not human trials. Reconstitute with bacteriostatic water, swirl gently (do not shake), and store unreconstituted vials at 2-8°C short-term or -20°C for long-term storage. Refrigerate (2-8°C) once reconstituted. For laboratory research purposes only.",
  },
  'ss31-10mg': {
    benefits: [
      'Mitochondria-targeted tetrapeptide binding cardiolipin',
      'Studied in human trials for mitochondrial disease research, with mixed results reported honestly',
      '99%+ purity, third-party tested with COA',
      'Lyophilised 10mg vial',
      'Nationwide delivery across Malaysia',
    ],
    dosageInfo:
      'SS-31 (also known as Elamipretide) is a synthetic tetrapeptide studied for its ability to selectively bind cardiolipin on the inner mitochondrial membrane, where research indicates it modulates membrane surface electrostatics and is associated with reduced oxidative stress markers. It has been investigated in human clinical trials for rare mitochondrial diseases, most notably Barth syndrome. Clinical results have been mixed: a separate phase 3 trial in primary mitochondrial myopathy did not meet its primary endpoints in the overall study population, though a genetically-defined subgroup showed benefit on post hoc analysis. This vial is a research-only product, not the approved medication, and is not intended for human treatment. Reconstitute with bacteriostatic water, swirl gently (do not shake), and store unreconstituted vials at 2-8°C short-term or -20°C for long-term storage. Refrigerate (2-8°C) once reconstituted. For laboratory research purposes only.',
  },
  'ss31-50mg': {
    benefits: [
      'Mitochondria-targeted tetrapeptide binding cardiolipin',
      'Studied in human trials for mitochondrial disease research, with mixed results reported honestly',
      '99%+ purity, third-party tested with COA',
      'Lyophilised 50mg vial',
      'Nationwide delivery across Malaysia',
    ],
    dosageInfo:
      'SS-31 (also known as Elamipretide) is a synthetic tetrapeptide studied for its ability to selectively bind cardiolipin on the inner mitochondrial membrane, where research indicates it modulates membrane surface electrostatics and is associated with reduced oxidative stress markers. It has been investigated in human clinical trials for rare mitochondrial diseases, most notably Barth syndrome. Clinical results have been mixed: a separate phase 3 trial in primary mitochondrial myopathy did not meet its primary endpoints in the overall study population, though a genetically-defined subgroup showed benefit on post hoc analysis. This vial is a research-only product, not the approved medication, and is not intended for human treatment. Reconstitute with bacteriostatic water, swirl gently (do not shake), and store unreconstituted vials at 2-8°C short-term or -20°C for long-term storage. Refrigerate (2-8°C) once reconstituted. For laboratory research purposes only.',
  },
  // NOTE: slug says "dsip-5mg" but the live product's actual name/size field is "DSIP 10mg" — a
  // pre-existing naming mismatch, not introduced here. Copy below matches the real 10mg size.
  'dsip-5mg': {
    benefits: [
      'Nonapeptide studied for slow-wave sleep and HPA-axis research',
      'Evidence base is old and inconsistent — described honestly, not oversold',
      '99%+ purity, third-party tested with COA',
      'Lyophilised 10mg vial',
      'Nationwide delivery across Malaysia',
    ],
    dosageInfo:
      "DSIP (Delta Sleep-Inducing Peptide) is a nonapeptide first isolated in the 1970s that has been studied in animal and early human research in connection with sleep-stage regulation (particularly slow-wave/delta sleep) and the hypothalamic-pituitary-adrenal (stress) axis. The evidence base is old, small and inconsistent: the one placebo-controlled human insomnia trial found only weak effects, and a separate human study found no measurable effect on stress-hormone response at all, contradicting earlier animal findings. A peer-reviewed review describes DSIP's biological role as still unresolved, without a confirmed receptor or gene. This is one of the more scientifically uncertain compounds in our catalogue, described honestly rather than oversold. Reconstitute with bacteriostatic water, swirl gently (do not shake), and store unreconstituted vials at 2-8°C short-term or -20°C for long-term storage. Refrigerate (2-8°C) once reconstituted. For laboratory research purposes only.",
  },
  'p021-10mg': {
    benefits: [
      'CNTF-derived peptidomimetic designed to cross the blood-brain barrier',
      "Studied in an Alzheimer's mouse model for tau and amyloid-beta research",
      '99%+ purity, third-party tested with COA',
      'Lyophilised 10mg vial',
      'Nationwide delivery across Malaysia',
    ],
    dosageInfo:
      "P021 (also referenced as P21) is a synthetic peptidomimetic derived from an active region of Ciliary Neurotrophic Factor (CNTF), designed to cross the blood-brain barrier. It has been studied in a triple-transgenic mouse model of Alzheimer's disease, where chronic treatment was associated with reduced tau hyperphosphorylation and amyloid-beta levels, increased BDNF expression, and restored hippocampal neurogenesis and memory performance in the animal model. This is a narrow evidence base — essentially one research group's published work — rather than a broad independent literature, and no human trials exist for this compound. Reconstitute with bacteriostatic water, swirl gently (do not shake), and store unreconstituted vials at 2-8°C short-term or -20°C for long-term storage. Refrigerate (2-8°C) once reconstituted. For laboratory research purposes only.",
  },
  'cerebrolysin-10ml': {
    benefits: [
      'Porcine-derived peptide preparation studied in stroke-recovery research',
      'Mixed clinical trial results reported honestly, not overstated',
      '99%+ purity, third-party tested with COA',
      'Liquid 30mg / 10ml vial, ready to use',
      'Nationwide delivery across Malaysia',
    ],
    dosageInfo:
      'Cerebrolysin is a peptide preparation derived from porcine brain tissue, studied in clinical research for stroke recovery and cognitive/neurodegenerative conditions, with a proposed neurotrophic and neuroprotective mechanism. Research findings across the clinical trial literature are genuinely mixed: some randomised trials reported benefit on motor recovery after stroke and global clinical function in Alzheimer\'s patients, while a meta-analysis pooling six randomised trials found no significant effect on longer-term functional recovery after acute ischemic stroke. This product is described with that full picture rather than only the favourable studies. This is a liquid formulation supplied ready for research use — no reconstitution required. Store at 2-8°C, protect from light, and use within the period recommended in our Peptide Guide once opened. For laboratory research purposes only.',
  },
  'selank-10mg': {
    benefits: [
      'Tuftsin-analogue heptapeptide studied for anxiolytic and BDNF research',
      'Human clinical data from Russian-origin studies, described honestly',
      '99%+ purity, third-party tested with COA',
      'Lyophilised 10mg vial',
      'Nationwide delivery across Malaysia',
    ],
    dosageInfo:
      'Selank is a synthetic heptapeptide analogue of tuftsin, developed in Russia, studied in published research for anxiolytic, GABAergic-modulatory, BDNF-related and immune/cytokine-modulatory activity in both animal models and small human clinical studies. Human clinical data comes from small, Russian-origin studies published with English abstracts, not FDA/EMA-reviewed trials — a genuine but geographically narrow evidence base, described accordingly. Reconstitute with bacteriostatic water, swirl gently (do not shake), and store unreconstituted vials at 2-8°C short-term or -20°C for long-term storage. Refrigerate (2-8°C) once reconstituted. For laboratory research purposes only.',
  },
  'semax-10mg': {
    benefits: [
      'ACTH(4-10) analogue studied for neurotrophin and ischemia research',
      'Mechanistic research primarily rodent-based, described honestly',
      '99%+ purity, third-party tested with COA',
      'Lyophilised 10mg vial',
      'Nationwide delivery across Malaysia',
    ],
    dosageInfo:
      'Semax is a synthetic peptide analogue of ACTH(4-10), developed in Russia, studied in animal models for effects on BDNF/trkB expression, neurotrophin gene transcription following cerebral ischemia, and dopaminergic/serotonergic system activity. Nearly all mechanistic research is rodent-based; Russian clinical research has reported associations between Semax administration and post-stroke functional recovery, though this has not been independently replicated outside Russia. Reconstitute with bacteriostatic water, swirl gently (do not shake), and store unreconstituted vials at 2-8°C short-term or -20°C for long-term storage. Refrigerate (2-8°C) once reconstituted. For laboratory research purposes only.',
  },
  'kpv-30mg': {
    benefits: [
      'Alpha-MSH–derived anti-inflammatory tripeptide',
      'Studied in gut, skin and immune research via the PepT1 pathway',
      '99%+ purity, third-party tested with COA',
      'Lyophilised 30mg vial',
      'Nationwide delivery across Malaysia',
    ],
    dosageInfo:
      "KPV (Lysine-Proline-Valine) is the C-terminal tripeptide fragment of alpha-MSH, studied for retaining alpha-MSH's anti-inflammatory activity — including modulation of the NF-κB pathway — without the melanogenic/pigmentation effects of the full hormone. It has been studied via the PepT1 transporter for gut-targeted anti-inflammatory research, including murine models of colitis, and appears in the preclinical literature in skin-inflammation contexts such as contact hypersensitivity models. All research is in cell culture and animal models; no human trials exist for KPV specifically. The 10mg/30mg vial sizes reflect supplied quantity only — no dose-comparison research exists differentiating them. Reconstitute with bacteriostatic water, swirl gently (do not shake), and store unreconstituted vials at 2-8°C short-term or -20°C for long-term storage. Refrigerate (2-8°C) once reconstituted. For laboratory research purposes only.",
  },
  // NOTE: real-world "TB-500" conventionally refers to the short fragment, not a "full chain"
  // variant — the Full Chain / Fragment naming may be backwards relative to actual COA contents.
  // Same copy applied to both pending supplier verification (see draft doc).
  'tb500-full-chain-10mg': {
    benefits: [
      'Thymosin Beta-4-derived peptide studied for actin regulation',
      'Researched for wound-healing, angiogenesis and tissue-repair models',
      '99%+ purity, third-party tested with COA',
      'Lyophilised 10mg vial',
      'Nationwide delivery across Malaysia',
    ],
    dosageInfo:
      "Thymosin Beta-4 is a naturally-occurring 43-amino-acid protein; 'TB-500' is a product name under which commercial peptide products have been shown analytically to contain a short synthetic fragment corresponding to its actin-binding region. Research on the protein and this fragment has studied actin-sequestering activity that regulates cytoskeletal dynamics and cell migration, with animal-model investigation into dermal wound-healing, angiogenesis and cardiac tissue repair. All cited evidence is preclinical — rodent, chick or cell-culture studies, not human clinical trials. Reconstitute with bacteriostatic water, swirl gently (do not shake), and store unreconstituted vials at 2-8°C short-term or -20°C for long-term storage. Refrigerate (2-8°C) once reconstituted. For laboratory research purposes only.",
  },
  'tb500-fragment-10mg': {
    benefits: [
      'Thymosin Beta-4-derived peptide studied for actin regulation',
      'Researched for wound-healing, angiogenesis and tissue-repair models',
      '99%+ purity, third-party tested with COA',
      'Lyophilised 10mg vial',
      'Nationwide delivery across Malaysia',
    ],
    dosageInfo:
      "Thymosin Beta-4 is a naturally-occurring 43-amino-acid protein; 'TB-500' is a product name under which commercial peptide products have been shown analytically to contain a short synthetic fragment corresponding to its actin-binding region. Research on the protein and this fragment has studied actin-sequestering activity that regulates cytoskeletal dynamics and cell migration, with animal-model investigation into dermal wound-healing, angiogenesis and cardiac tissue repair. All cited evidence is preclinical — rodent, chick or cell-culture studies, not human clinical trials. Reconstitute with bacteriostatic water, swirl gently (do not shake), and store unreconstituted vials at 2-8°C short-term or -20°C for long-term storage. Refrigerate (2-8°C) once reconstituted. For laboratory research purposes only.",
  },
  'ghkcu-50mg-bpc157-10mg-tb500-10mg-kpv-10mg-80mg': {
    benefits: [
      'Combines GHK-Cu, BPC-157, TB-500 and KPV research profiles',
      'No published study on this specific four-peptide combination — stated honestly',
      '99%+ purity, third-party tested with COA',
      'Lyophilised 80mg vial',
      'Nationwide delivery across Malaysia',
    ],
    dosageInfo:
      'This product combines four peptides individually studied in preclinical research: GHK-Cu (copper-binding tripeptide, studied for gene-expression modulation tied to tissue repair and collagen synthesis), BPC-157 (studied in animal models for tendon and muscle tissue repair and angiogenesis), TB-500 (studied for actin-regulation and wound-healing research), and KPV (an alpha-MSH-derived tripeptide studied for anti-inflammatory activity). See each peptide\'s own product page for its individually-published research. No published study has tested this specific four-way combination — the rationale for combining them draws on their individually-documented, complementary research profiles, not evidence that the combination itself has been studied together. Reconstitute with bacteriostatic water, swirl gently (do not shake), and store unreconstituted vials at 2-8°C short-term or -20°C for long-term storage. Refrigerate (2-8°C) once reconstituted. For laboratory research purposes only.',
  },
  'cjc1295-ipamorelin-5mg5mg': {
    benefits: [
      'Pairs GHRH-class CJC-1295 with GHS-R1a agonist Ipamorelin',
      'No combination-specific trial exists — mechanistic rationale stated honestly',
      '99%+ purity, third-party tested with COA',
      'Lyophilised 5mg + 5mg vial',
      'Nationwide delivery across Malaysia',
    ],
    dosageInfo:
      'This product pairs CJC-1295, a long-acting synthetic GHRH analogue, with Ipamorelin, a pentapeptide studied as a selective GHS-R1a (ghrelin-receptor) agonist. Human research on the long-acting CJC-1295 (DAC) form found dose-dependent growth hormone and IGF-1 increases lasting 6-11 days per injection in healthy adults, while preserving natural pulsatile GH release patterns. No published clinical trial has tested CJC-1295 and Ipamorelin in combination specifically — pairing a GHRH-class peptide with a GHS-R1a-class peptide draws on the broader GH-secretagogue literature as mechanistic rationale, not evidence that this specific combination has been studied. Reconstitute with bacteriostatic water, swirl gently (do not shake), and store unreconstituted vials at 2-8°C short-term or -20°C for long-term storage. Refrigerate (2-8°C) once reconstituted. For laboratory research purposes only.',
  },
  'ipamorelin-10mg': {
    benefits: [
      'Selective GHS-R1a (ghrelin receptor) agonist pentapeptide',
      'Studied for growth hormone release without significant ACTH/cortisol rise',
      '99%+ purity, third-party tested with COA',
      'Lyophilised 10mg vial',
      'Nationwide delivery across Malaysia',
    ],
    dosageInfo:
      'Ipamorelin is a pentapeptide studied as a selective agonist of the GHS-R1a (ghrelin) receptor, characterised for stimulating growth hormone release with high receptor selectivity — notably, without significantly raising ACTH/cortisol, unlike some earlier-generation GH secretagogues. Reconstitute with bacteriostatic water, swirl gently (do not shake), and store unreconstituted vials at 2-8°C short-term or -20°C for long-term storage. Refrigerate (2-8°C) once reconstituted. For laboratory research purposes only.',
  },
  // NOTE: epitalon-10mg and the already-published epithalon-50mg are very likely the same
  // AEDG tetrapeptide under two spelling variants — flagged for a catalog decision, not
  // resolved here. Copy matches epithalon-50mg's existing live style for consistency.
  'epitalon-10mg': {
    benefits: [
      'Ala-Glu-Asp-Gly longevity research tetrapeptide',
      'Studied for telomerase and aging research',
      '99%+ purity, third-party tested with COA',
      'Lyophilised 10mg vial',
      'Nationwide delivery across Malaysia',
    ],
    dosageInfo:
      "Epitalon (also referenced as Epithalon/Epithalone in the literature — spelling variants of the same AEDG tetrapeptide) has been studied in vitro and in animal models for its effects on telomerase activity and telomere length, pineal gland function, and melatonin/circadian regulation. The foundational study found Epitalon induced telomerase activity and telomere elongation in telomerase-negative human cell cultures, later independently replicated. Animal studies in aged primates found effects on melatonin synthesis and cortisol rhythm normalisation. No human clinical trial data exists in the indexed literature — all findings are cell-culture or animal-model research. Reconstitute with bacteriostatic water, swirl gently (do not shake), and store unreconstituted vials at 2-8°C short-term or -20°C for long-term storage. Refrigerate (2-8°C) once reconstituted. For laboratory research purposes only.",
  },
  'bac-water-10ml': {
    benefits: [
      'Sterile water for injection with 0.9% benzyl alcohol preservative',
      'Standard solvent for reconstituting lyophilised peptides',
      'Inhibits bacterial growth in multi-use solution',
      '10mL volume',
      'Nationwide delivery across Malaysia',
    ],
    dosageInfo:
      "Bacteriostatic water (BAC water) is sterile water for injection containing 0.9% benzyl alcohol as a preservative, used as a solvent for reconstituting lyophilised peptides. The benzyl alcohol inhibits bacterial growth in the solution, which is why it's preferred over plain sterile water for multi-use reconstitution — it extends how long a reconstituted peptide solution stays viable for research use. Store at room temperature away from direct light; once opened, use within the timeframe recommended for the specific peptide being reconstituted. For laboratory research use only.",
  },
  'bac-water-3ml': {
    benefits: [
      'Sterile water for injection with 0.9% benzyl alcohol preservative',
      'Standard solvent for reconstituting lyophilised peptides',
      'Inhibits bacterial growth in multi-use solution',
      '3mL volume',
      'Nationwide delivery across Malaysia',
    ],
    dosageInfo:
      "Bacteriostatic water (BAC water) is sterile water for injection containing 0.9% benzyl alcohol as a preservative, used as a solvent for reconstituting lyophilised peptides. The benzyl alcohol inhibits bacterial growth in the solution, which is why it's preferred over plain sterile water for multi-use reconstitution — it extends how long a reconstituted peptide solution stays viable for research use. Store at room temperature away from direct light; once opened, use within the timeframe recommended for the specific peptide being reconstituted. For laboratory research use only.",
  },
};

async function main() {
  const slugs = Object.keys(PRODUCTS);
  console.log(`Target: ${slugs.length} products${DRY_RUN ? ' (DRY RUN — no writes)' : ''}`);

  const existing = await prisma.product.findMany({
    where: { slug: { in: slugs } },
    select: { id: true, slug: true, name: true, benefits: true, dosageInfo: true },
  });

  const found = new Set(existing.map((p) => p.slug));
  const missing = slugs.filter((s) => !found.has(s));
  if (missing.length) {
    console.error('ABORTING — slugs not found in DB:', missing);
    process.exit(1);
  }

  const alreadyPopulated = existing.filter((p) => p.benefits || p.dosageInfo);
  if (alreadyPopulated.length) {
    console.error(
      'ABORTING — these target slugs already have content and would be overwritten:',
      alreadyPopulated.map((p) => p.slug),
    );
    console.error('Remove them from PRODUCTS or handle deliberately, then re-run.');
    process.exit(1);
  }

  const backupPath = `./phase4-batch2-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(backupPath, JSON.stringify(existing, null, 2));
  console.log(`Backed up pre-state (${existing.length} products) to ${backupPath}`);

  if (DRY_RUN) {
    console.log('Dry run complete — no writes performed.');
    return;
  }

  const byId = new Map(existing.map((p) => [p.slug, p.id]));

  await prisma.$transaction(
    slugs.map((slug) =>
      prisma.product.update({
        where: { id: byId.get(slug) },
        data: {
          benefits: JSON.stringify(PRODUCTS[slug].benefits),
          dosageInfo: PRODUCTS[slug].dosageInfo,
        },
      }),
    ),
  );

  console.log(`Updated ${slugs.length} products.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
