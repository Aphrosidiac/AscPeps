import type { AgentTool } from '../tool-kit.js';
import { clampLimit, money, parseDate, rm, toCents } from '../tool-kit.js';
import {
  deleteDocument,
  getDocument,
  listDocuments,
  setDocumentLinks,
  updateDocument,
} from '../../admin/admin-documents.controller.js';

/**
 * The filing cabinet, over WhatsApp.
 *
 * One rule shapes every tool in this file: THE AGENT NEVER HANDS OUT A FILE.
 *
 * Documents are receipts, invoices and bank slips. They carry customer names
 * and addresses, and our own account details. The whole reason they are stored
 * outside the public /uploads mount and served only behind the admin JWT (see
 * utils/document-store.ts) is that a link to one is as good as the document
 * itself — and a WhatsApp group is exactly where a link gets forwarded out of
 * the business without anyone deciding to.
 *
 * So `shape()` below is the boundary. The agent can say a document EXISTS, what
 * it is, when it is dated, what it is worth and what it is filed against —
 * everything needed to answer "do we have the receipt for that order?" — and
 * cannot emit the stored filename, a path, or a URL, because none of them ever
 * enter its context. Opening the file is a thing a human does in the admin.
 */

interface DocumentLinkRow {
  orderId: string | null;
  expenseId: string | null;
  order?: { orderNumber: string; customerName: string } | null;
  expense?: { description: string; category: string } | null;
}

function shape(d: any) {
  return {
    documentId: d.id,
    title: d.title,
    description: d.description,
    kind: d.kind,
    occurredAt: d.occurredAt,
    amount: d.amount == null ? null : money(d.amount),
    // The name it was uploaded under. Descriptive only — it is not a path, and
    // the stored filename it maps to is deliberately absent.
    file: { name: d.originalName, sizeKb: Math.round(d.sizeBytes / 1024) },
    filedAgainst: (d.links ?? []).map((l: DocumentLinkRow) =>
      l.orderId
        ? { type: 'order', orderId: l.orderId, orderNumber: l.order?.orderNumber, customer: l.order?.customerName }
        : { type: 'expense', expenseId: l.expenseId, description: l.expense?.description, category: l.expense?.category }
    ),
    // Said out loud so the model does not invent a link, apologise for not
    // having one, or promise to send the file.
    note: 'The file itself is only viewable in the admin. There is no link to give out.',
  };
}

async function resolveOrderIds(prisma: any, refs: string[] | undefined): Promise<string[]> {
  if (!refs?.length) return [];
  const ids: string[] = [];
  for (const ref of refs) {
    const raw = String(ref).trim();
    const order = await prisma.order.findFirst({
      where: { OR: [{ id: raw }, { orderNumber: { equals: raw, mode: 'insensitive' } }] },
      select: { id: true },
    });
    if (!order) throw new Error(`No order matching "${ref}".`);
    ids.push(order.id);
  }
  return ids;
}

export const documentTools: AgentTool[] = [
  {
    name: 'list_documents',
    description:
      'Search the document store — receipts, supplier invoices, courier bills, bank slips, statements. Use it to answer "do we have the receipt for X", "what paperwork is on this order", or "what has been uploaded but never filed" (set unlinkedOnly). Returns what each document IS, not the file: the file is only viewable in the admin and you cannot send it.',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Matches title, description, uploaded filename, or an order number.' },
        kind: { type: 'string', description: 'e.g. Receipt, Invoice, Bank slip, Statement.' },
        orderRef: { type: 'string', description: 'Order number or id — only documents filed against that order.' },
        expenseId: { type: 'string', description: 'Only documents filed against that company expense.' },
        unlinkedOnly: { type: 'boolean', description: 'Only documents attached to nothing at all.' },
        from: { type: 'string', description: 'Document date on or after. YYYY-MM-DD, or 30d.' },
        to: { type: 'string', description: 'Document date on or before.' },
        limit: { type: 'number' },
      },
    },
    run: async ({ fastify, prisma }, input) => {
      const query: Record<string, string> = {};
      if (input.search) query.search = String(input.search);
      if (input.kind) query.kind = String(input.kind);
      if (input.expenseId) query.expenseId = String(input.expenseId);
      if (input.unlinkedOnly) query.unlinked = 'true';
      if (input.from) query.from = parseDate(input.from, false)!.toISOString();
      if (input.to) query.to = parseDate(input.to, true)!.toISOString();
      if (input.orderRef) {
        const [orderId] = await resolveOrderIds(prisma, [input.orderRef]);
        query.orderId = orderId;
      }

      const { documents, kinds } = await listDocuments(fastify, query);
      const limit = clampLimit(input.limit, 25);
      return {
        total: documents.length,
        kindsInUse: kinds,
        documents: documents.slice(0, limit).map(shape),
      };
    },
  },

  {
    name: 'get_document',
    description:
      'One document in full: what it is, its date and amount, and everything it is filed against. The file itself cannot be sent — say so plainly if asked for it.',
    input_schema: {
      type: 'object',
      properties: { documentId: { type: 'string' } },
      required: ['documentId'],
    },
    run: async ({ fastify }, input) => shape(await getDocument(fastify, input.documentId)),
  },

  {
    name: 'update_document',
    description:
      'Correct a document\'s title, description, kind, date or amount. Does not touch what it is filed against — use file_document for that. Amount in RINGGIT.',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        documentId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        kind: { type: 'string' },
        occurredAt: { type: 'string', description: 'The date ON the document. YYYY-MM-DD.' },
        amountRm: { type: 'number' },
      },
      required: ['documentId'],
    },
    run: async ({ fastify }, input) => {
      const data: Record<string, unknown> = {};
      if (input.title !== undefined) data.title = input.title;
      if (input.description !== undefined) data.description = input.description;
      if (input.kind !== undefined) data.kind = input.kind;
      if (input.occurredAt !== undefined) data.occurredAt = parseDate(input.occurredAt, false);
      if (input.amountRm !== undefined) data.amount = toCents(input.amountRm);
      return shape(await updateDocument(fastify, input.documentId, data));
    },
  },

  {
    name: 'file_document',
    description:
      'Set what a document is filed against — orders, company expenses, or nothing. REPLACES the whole set, so to add one target you must also list the ones already there: read the document first with get_document. Filing against nothing detaches it entirely.',
    write: true,
    // Destructive because it is a replace-all with no undo: filing a courier
    // invoice against one order silently detaches it from the other nineteen it
    // covered, and nobody can reconstruct that list afterwards from memory.
    // It also has a practical effect — `summarize` below only ever runs for
    // destructive tools (see agent.service.ts), so without this the operator
    // would be told nothing before the links were replaced.
    destructive: true,
    input_schema: {
      type: 'object',
      properties: {
        documentId: { type: 'string' },
        orderRefs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Order numbers or ids. One document can cover many orders — a courier invoice for a whole week, say.',
        },
        expenseIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['documentId'],
    },
    summarize: async ({ prisma }, input) => {
      const doc = await prisma.document.findUnique({ where: { id: input.documentId } });
      if (!doc) throw new Error(`No document with id ${input.documentId}.`);
      const count = (input.orderRefs?.length ?? 0) + (input.expenseIds?.length ?? 0);
      return count === 0
        ? `detach "${doc.title}" from everything it is currently filed against`
        : `file "${doc.title}" against ${count} thing${count === 1 ? '' : 's'}, replacing whatever it is attached to now`;
    },
    run: async ({ fastify, prisma }, input) => {
      const orderIds = await resolveOrderIds(prisma, input.orderRefs);
      return shape(
        await setDocumentLinks(fastify, input.documentId, {
          orderIds,
          expenseIds: input.expenseIds ?? [],
        })
      );
    },
  },

  {
    name: 'delete_document',
    description:
      'Permanently remove a document and its stored file. There is no undo and no backup — the file is gone. Detaching a document from an order is file_document, not this.',
    write: true,
    destructive: true,
    input_schema: {
      type: 'object',
      properties: { documentId: { type: 'string' } },
      required: ['documentId'],
    },
    summarize: async ({ prisma }, input) => {
      const doc = await prisma.document.findUnique({
        where: { id: input.documentId },
        include: { links: true },
      });
      if (!doc) throw new Error(`No document with id ${input.documentId}.`);
      const filed = doc.links.length ? `, filed against ${doc.links.length} thing(s)` : '';
      const amount = doc.amount == null ? '' : ` for ${rm(doc.amount)}`;
      return `permanently delete the document "${doc.title}" (${doc.kind}${amount})${filed}. The file cannot be recovered`;
    },
    run: async ({ fastify }, input) => deleteDocument(fastify, input.documentId),
  },
];
