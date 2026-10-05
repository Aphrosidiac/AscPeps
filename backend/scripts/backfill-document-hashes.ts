/**
 * Fill documents.sha256 for documents filed before the column existed, so a
 * receipt filed from the dashboard in August is recognised when the same file
 * arrives over WhatsApp. Reads each stored file once; safe to re-run (only
 * rows still missing a hash are touched).
 *
 *   set -a && source .env && set +a && npx tsx scripts/backfill-document-hashes.ts
 */
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { documentPath } from '../src/utils/document-store.js';
import { sha256 } from '../src/utils/agent-media-store.js';

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });
const rows = await prisma.document.findMany({ where: { sha256: null }, select: { id: true, filename: true, title: true } });
let done = 0;
let missing = 0;
for (const d of rows) {
  try {
    const digest = sha256(await readFile(documentPath(d.filename)));
    await prisma.document.update({ where: { id: d.id }, data: { sha256: digest } });
    done++;
  } catch {
    console.log(`  file missing for "${d.title}" (${d.id}) — left without a hash`);
    missing++;
  }
}
console.log(`hashed ${done} document(s); ${missing} without a file on disk`);
await prisma.$disconnect();
