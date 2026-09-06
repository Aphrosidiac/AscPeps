/**
 * The document tools' one hard guarantee: the agent can DESCRIBE a document and
 * can never hand one out.
 *
 * Worth its own script rather than a line in the smoke test, because the thing
 * being checked is a negative — that no filename, path or URL reaches the
 * model's context — and a negative silently stops holding the moment someone
 * adds a field to the shaping function in documents.tools.ts.
 *
 *   set -a && source .env && set +a && npx tsx scripts/test-agent-documents.ts
 */
import Fastify from 'fastify';
import prismaPlugin from '../src/plugins/prisma.js';
import { getTool } from '../src/modules/ai-agent/registry.js';
import { routeDomains } from '../src/modules/ai-agent/domains.js';
import type { ToolContext } from '../src/modules/ai-agent/tool-kit.js';

const fastify = Fastify({ logger: false });
await fastify.register(prismaPlugin);

const ctx: ToolContext = {
  fastify,
  prisma: fastify.prisma,
  actor: { phone: '0000000000', name: 'Test', canWrite: true },
  revalidate: () => {},
};

let bad = 0;
const ok = (label: string, cond: boolean) => {
  if (!cond) bad++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
};

console.log('\n--- routing ---');
for (const msg of [
  'do we have the receipt for ASC2608/0022',
  'upload the resit please',
  'where is the bank statement',
]) {
  const domains = routeDomains(msg);
  ok(`"${msg}" -> ${domains.join(', ')}`, domains.includes('documents'));
}

const sample = await fastify.prisma.document.findFirst({ include: { links: true } });
if (!sample) {
  console.log('\nNo documents in the dev database — upload one and re-run.');
  await fastify.close();
  process.exit(0);
}

console.log('\n--- reads ---');
const list: any = await getTool('list_documents')!.run(ctx, { limit: 25 });
ok('list_documents returns rows', list.documents.length > 0);
ok('each row says what it is filed against', Array.isArray(list.documents[0].filedAgainst));

const one: any = await getTool('get_document')!.run(ctx, { documentId: sample.id });
ok('get_document resolves the sample row', one.documentId === sample.id);
ok(
  'an amount is given in ringgit as well as cents',
  one.amount === null || typeof one.amount.display === 'string'
);

console.log('\n--- the boundary: nothing that could fetch the file ---');
const payload = JSON.stringify({ list, one });
ok(
  'no stored filename (uuid.ext) anywhere',
  !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+/i.test(payload)
);
ok('no absolute URL', !/https?:\/\//.test(payload));
ok('no url/href/path field', !/"(url|href|path|filename)"\s*:/.test(payload));
ok('no /documents or /uploads path fragment', !/\/(documents|uploads)\//.test(payload));
ok('the model is told it cannot share the file', payload.includes('only viewable in the admin'));

console.log('\n--- write gates ---');
ok('file_document is a write tool', getTool('file_document')!.write === true);
ok('update_document is a write tool', getTool('update_document')!.write === true);
ok('delete_document is destructive', getTool('delete_document')!.destructive === true);
const summary = await getTool('delete_document')!.summarize!(ctx, { documentId: sample.id });
ok(`the confirmation names the document — "${summary}"`, summary.includes(sample.title));
ok('and warns the file cannot come back', summary.includes('cannot be recovered'));

console.log(`\n${bad === 0 ? 'ALL CHECKS PASSED' : `${bad} FAILED`}\n`);
await fastify.close();
process.exit(bad ? 1 : 0);
