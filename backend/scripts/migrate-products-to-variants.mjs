// Groups existing flat product_variants rows (the pre-rework Product table,
// renamed in place by migration 20260719102523) into parent Product lines,
// using the same code-prefix + category heuristic the storefront already
// used client-side (frontend/src/lib/product-relations.ts's baseCode()).
// That heuristic is NOT fully authoritative — two different compounds could
// theoretically share a code prefix — so this script never writes anything
// on its own. Pass 1 only proposes groupings for a human to review and
// hand-correct; Pass 2 only runs against an explicitly-approved file.
//
// Usage:
//   DATABASE_URL=... node scripts/migrate-products-to-variants.mjs
//     -> dry run, writes ./groups-proposed.json, no DB writes
//
//   DATABASE_URL=... node scripts/migrate-products-to-variants.mjs --apply groups-approved.json
//     -> commits the (hand-reviewed, warnings cleared) groups file: creates
//        one parent Product per group, backfills ProductVariant.productId,
//        rewrites ProductAddOn.productId from old variant ids to the new
//        parent id, and writes ./redirect-map.json (old slug -> new slug)
//        for the storefront's 301 redirect config.

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { writeFileSync, readFileSync } from 'fs';

const adapter = new PrismaPg(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter });

const applyIndex = process.argv.indexOf('--apply');
const APPLY_FILE = applyIndex !== -1 ? process.argv[applyIndex + 1] : null;

function baseCode(code) {
  return code.replace(/\d+$/, '');
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Reverses today's getFullProductName() dedup: strips the size substring back
// out of the name (if present) to recover a size-free parent name.
function deriveParentName(name, size) {
  if (!size) return name.trim();
  const trimmedSize = size.trim();
  const idx = name.toLowerCase().lastIndexOf(trimmedSize.toLowerCase());
  if (idx === -1) return name.trim();
  return (name.slice(0, idx) + name.slice(idx + trimmedSize.length)).replace(/\s+/g, ' ').trim();
}

async function loadFlatVariants() {
  // The declared ProductVariant model no longer has these columns — they
  // still exist physically until the cleanup migration drops them, so they
  // must be read via raw SQL rather than the typed client.
  return prisma.$queryRaw`
    SELECT id, code, name, slug, "categoryId", size, description, benefits,
           "dosageInfo", "coaUrl", featured, "sortOrder", "addOnReminder"
    FROM product_variants
    ORDER BY code
  `;
}

async function proposeGroups() {
  const rows = await loadFlatVariants();
  const groups = new Map(); // key: categoryId|baseCode -> rows[]
  for (const row of rows) {
    const key = `${row.categoryId}|${baseCode(row.code)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const proposals = [];
  const usedSlugs = new Map(); // slug -> group key, to detect cross-group collisions
  for (const [key, members] of groups) {
    const names = new Set(members.map((m) => deriveParentName(m.name, m.size)));
    const parentName = [...names][0];
    const parentSlug = slugify(parentName);
    const warnings = [];

    if (names.size > 1) warnings.push(`NAME_MISMATCH: ${[...names].join(' / ')}`);

    if (usedSlugs.has(parentSlug) && usedSlugs.get(parentSlug) !== key) {
      warnings.push(`SLUG_COLLISION: shares slug "${parentSlug}" with group ${usedSlugs.get(parentSlug)}`);
    }
    usedSlugs.set(parentSlug, key);

    for (const field of ['description', 'benefits', 'dosageInfo', 'coaUrl', 'addOnReminder']) {
      const values = new Set(members.map((m) => m[field]).filter((v) => v != null && v !== ''));
      if (values.size > 1) warnings.push(`CONTENT_DIVERGENCE(${field}): ${values.size} differing non-empty values across members`);
    }

    // Representative used for the parent's shared content: the smallest/base
    // size, same ordering the storefront already used for "Available Sizes".
    const representative = [...members].sort(
      (a, b) => (parseFloat(a.size ?? '') || 0) - (parseFloat(b.size ?? '') || 0)
    )[0];

    proposals.push({
      groupKey: key,
      parentName,
      parentSlug,
      categoryId: members[0].categoryId,
      warnings,
      representativeId: representative.id,
      members: members.map((m) => ({ id: m.id, code: m.code, size: m.size, slug: m.slug, name: m.name })),
    });
  }

  return proposals;
}

async function dryRun() {
  const proposals = await proposeGroups();
  const flagged = proposals.filter((p) => p.warnings.length > 0);
  const totalMembers = proposals.reduce((s, p) => s + p.members.length, 0);

  console.log(`Proposed ${proposals.length} parent product groups from ${totalMembers} variant rows.\n`);
  for (const p of proposals) {
    const flag = p.warnings.length ? ' ⚠️' : '';
    console.log(`- ${p.parentName} (${p.parentSlug})${flag} — ${p.members.map((m) => `${m.code}/${m.size ?? 'no-size'}`).join(', ')}`);
    for (const w of p.warnings) console.log(`    ${w}`);
  }
  console.log(`\n${flagged.length} group(s) flagged for review out of ${proposals.length}.`);

  const outPath = './groups-proposed.json';
  writeFileSync(outPath, JSON.stringify(proposals, null, 2));
  console.log(`\nWrote ${outPath}.`);
  console.log('Review it by hand: split/merge/rename groups as needed, fix representativeId if the');
  console.log('wrong member was picked, and clear each group\'s `warnings` array once resolved.');
  console.log('Then re-run:\n  node scripts/migrate-products-to-variants.mjs --apply groups-approved.json');
}

async function applyGroups(groups) {
  const stillFlagged = groups.filter((g) => (g.warnings ?? []).length > 0);
  if (stillFlagged.length) {
    console.error('ABORTING — the following groups still have unresolved warnings:');
    for (const g of stillFlagged) console.error(`  ${g.parentName}: ${g.warnings.join('; ')}`);
    console.error('Clear the `warnings` array for each group (after fixing the underlying issue) before applying.');
    process.exit(1);
  }

  const redirectMap = {};
  const summary = [];

  await prisma.$transaction(async (tx) => {
    for (const group of groups) {
      const repRows = await tx.$queryRaw`
        SELECT description, benefits, "dosageInfo", "coaUrl", featured, "sortOrder", "addOnReminder"
        FROM product_variants WHERE id = ${group.representativeId}
      `;
      const rep = repRows[0];
      if (!rep) throw new Error(`Representative variant ${group.representativeId} not found for group ${group.parentName}`);

      const parent = await tx.product.create({
        data: {
          name: group.parentName,
          slug: group.parentSlug,
          categoryId: group.categoryId,
          description: rep.description,
          benefits: rep.benefits,
          dosageInfo: rep.dosageInfo,
          coaUrl: rep.coaUrl,
          featured: rep.featured,
          sortOrder: rep.sortOrder,
          addOnReminder: rep.addOnReminder,
          active: true,
        },
      });

      for (const member of group.members) {
        await tx.productVariant.update({ where: { id: member.id }, data: { productId: parent.id } });
        if (member.slug !== group.parentSlug) redirectMap[member.slug] = group.parentSlug;
      }

      // Rewrite any ProductAddOn row whose old productId equals one of this
      // group's member ids (today's flat model meant "this variant's own
      // page shows the add-on") to point at the new parent instead. The old
      // model required configuring the same add-on separately on every
      // size, so two+ members can share the same addOnId — collapsing
      // those onto one parent would violate the (productId, addOnId)
      // unique constraint. Dedupe first: keep one row per addOnId
      // (preferring one already marked required, else the highest
      // quantity), delete the rest.
      const memberAddOns = await tx.productAddOn.findMany({
        where: { productId: { in: group.members.map((m) => m.id) } },
      });
      const survivorByAddOnId = new Map();
      for (const row of memberAddOns) {
        const current = survivorByAddOnId.get(row.addOnId);
        if (!current || (row.required && !current.required) || row.quantity > current.quantity) {
          survivorByAddOnId.set(row.addOnId, row);
        }
      }
      const survivorIds = new Set([...survivorByAddOnId.values()].map((row) => row.id));
      const duplicateIds = memberAddOns.filter((row) => !survivorIds.has(row.id)).map((row) => row.id);
      if (duplicateIds.length > 0) {
        await tx.productAddOn.deleteMany({ where: { id: { in: duplicateIds } } });
      }
      if (survivorIds.size > 0) {
        await tx.productAddOn.updateMany({
          where: { id: { in: [...survivorIds] } },
          data: { productId: parent.id },
        });
      }

      summary.push({ parent: group.parentSlug, variantCount: group.members.length });
    }
  });

  writeFileSync('./redirect-map.json', JSON.stringify(redirectMap, null, 2));
  const totalVariants = groups.reduce((s, g) => s + g.members.length, 0);
  console.log(`Created ${summary.length} parent products, backfilled ${totalVariants} variants.`);
  console.log(`Wrote redirect-map.json (${Object.keys(redirectMap).length} entries).`);
}

async function main() {
  if (APPLY_FILE) {
    const groups = JSON.parse(readFileSync(APPLY_FILE, 'utf8'));
    await applyGroups(groups);
    return;
  }
  await dryRun();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
