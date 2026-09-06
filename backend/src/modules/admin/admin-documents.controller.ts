import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getPaginationParams } from '../../utils/pagination.js';
import { createReadStream, createWriteStream } from 'fs';
import { unlink } from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';
import {
  ALLOWED_LABEL,
  DOCUMENTS_DIR,
  deleteDocumentFile,
  documentPath,
  ensureDocumentsDir,
  extensionFor,
  isInlineViewable,
  sniffDocumentType,
} from '../../utils/document-store.js';

// A scanned multi-page invoice is routinely bigger than the 5MB the product
// image endpoint allows, and re-scanning paperwork to fit a limit is not a
// thing anyone should have to do. Applied per request rather than by widening
// the global multipart limit, which would also raise it for product images.
//
// 10MB and not more because that is nginx's `client_max_body_size` on
// ascendpeptides.my. A larger figure here would be a lie in production: nginx
// rejects the request with its own 413 before Fastify ever sees it, so the
// friendly "File too large" below would never fire and the upload would fail
// with a bare proxy error instead. Raising this means raising nginx in the same
// change — both numbers, or neither.
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

const linkTargets = z
  .object({
    orderIds: z.array(z.string().min(1)).max(50).optional(),
    expenseIds: z.array(z.string().min(1)).max(50).optional(),
  })
  .strict();

const metaSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(160),
  description: z.string().trim().max(2000).nullable().optional(),
  kind: z.string().trim().min(1, 'Kind is required').max(60),
  occurredAt: z.coerce.date(),
  // Cents. Nullable because plenty of documents have no amount at all.
  amount: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
});

const updateSchema = metaSchema
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'Nothing to update' });

/**
 * Multipart fields arrive as strings, so the metadata that travels alongside
 * the file is parsed here rather than by the shared schema directly — an empty
 * string has to mean "not given" and not "the number zero".
 */
function metaFromFields(fields: Record<string, unknown>) {
  const text = (key: string): string | undefined => {
    const field = fields[key] as { value?: unknown } | undefined;
    const value = field && typeof field === 'object' && 'value' in field ? field.value : undefined;
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
  };

  const amount = text('amount');
  const ids = (key: string): string[] | undefined => {
    const raw = text(key);
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : undefined;
    } catch {
      return undefined;
    }
  };

  return {
    meta: metaSchema.parse({
      title: text('title'),
      description: text('description') ?? null,
      kind: text('kind'),
      occurredAt: text('occurredAt') ?? new Date().toISOString(),
      amount: amount === undefined ? null : Number(amount),
    }),
    links: linkTargets.parse({ orderIds: ids('orderIds'), expenseIds: ids('expenseIds') }),
  };
}

/** Link rows for one document, refusing anything that points at nothing real. */
async function buildLinks(
  fastify: FastifyInstance,
  documentId: string,
  links: z.infer<typeof linkTargets>
) {
  const orderIds = [...new Set(links.orderIds ?? [])];
  const expenseIds = [...new Set(links.expenseIds ?? [])];

  // Checked before writing rather than relying on the foreign key, so a typo'd
  // id comes back as a message naming what was wrong instead of a 500.
  if (orderIds.length) {
    const found = await fastify.prisma.order.count({ where: { id: { in: orderIds } } });
    if (found !== orderIds.length) throw { statusCode: 400, message: 'One or more orders do not exist.' };
  }
  if (expenseIds.length) {
    const found = await fastify.prisma.companyExpense.count({ where: { id: { in: expenseIds } } });
    if (found !== expenseIds.length) throw { statusCode: 400, message: 'One or more expenses do not exist.' };
  }

  return [
    ...orderIds.map((orderId) => ({ documentId, orderId })),
    ...expenseIds.map((expenseId) => ({ documentId, expenseId })),
  ];
}

/** What every read of a document returns — file facts plus what it is filed against. */
const DOCUMENT_INCLUDE = {
  links: {
    include: {
      order: { select: { id: true, orderNumber: true, customerName: true, total: true, createdAt: true } },
      expense: { select: { id: true, description: true, category: true, amount: true, occurredAt: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
} as const;

export async function uploadDocument(fastify: FastifyInstance, request: FastifyRequest) {
  await ensureDocumentsDir();
  const id = randomUUID();
  const tmppath = path.join(DOCUMENTS_DIR, `${id}.tmp`);

  // Walked part by part rather than via request.file(), because `file().fields`
  // only ever contains the fields that arrived BEFORE the file part. That made
  // the endpoint quietly dependent on client field order: a caller that
  // appended the file first would lose every piece of metadata and be told
  // "Title is required", which is true but useless. Iterating collects fields
  // on both sides of the file, so order stops mattering at all.
  const fields: Record<string, { value: string }> = {};
  let originalName: string | null = null;
  let truncated = false;
  let wroteFile = false;

  try {
    for await (const part of request.parts({ limits: { fileSize: MAX_DOCUMENT_BYTES } })) {
      if (part.type !== 'file') {
        fields[part.fieldname] = { value: String((part as { value: unknown }).value ?? '') };
        continue;
      }
      if (wroteFile) {
        // Only the first file is stored; anything else is drained so the
        // request can finish rather than stalling on an unread stream.
        await part.file.resume();
        continue;
      }
      await pipeline(part.file, createWriteStream(tmppath));
      truncated = part.file.truncated;
      originalName = part.filename ?? null;
      wroteFile = true;
    }
  } catch {
    await unlink(tmppath).catch(() => {});
    throw {
      statusCode: 400,
      message: `Upload failed. The file may be larger than ${MAX_DOCUMENT_BYTES / 1024 / 1024}MB.`,
    };
  }

  if (!wroteFile) throw { statusCode: 400, message: 'No file uploaded' };

  if (truncated) {
    await unlink(tmppath).catch(() => {});
    throw { statusCode: 400, message: `File too large. Max ${MAX_DOCUMENT_BYTES / 1024 / 1024}MB.` };
  }

  // Validated only once the stream is fully drained — rejecting earlier would
  // leave the request body half-read. The temp file is removed on any failure
  // below so a bad title never leaves bytes behind.
  let parsed: ReturnType<typeof metaFromFields>;
  try {
    parsed = metaFromFields(fields);
  } catch (err) {
    await unlink(tmppath).catch(() => {});
    throw err;
  }

  // From the bytes, never from data.mimetype — the declared type is whatever
  // the client felt like sending.
  const mime = await sniffDocumentType(tmppath);
  if (!mime) {
    await unlink(tmppath).catch(() => {});
    throw { statusCode: 400, message: `That file is not a ${ALLOWED_LABEL}.` };
  }

  const filename = `${id}.${extensionFor(mime)}`;
  const { size } = await import('fs/promises').then((fs) => fs.stat(tmppath));

  // Stored byte-for-byte: no re-encode, no downscale. A document may have to be
  // produced to an accountant or a bank exactly as it was issued.
  await import('fs/promises').then((fs) => fs.rename(tmppath, documentPath(filename)));

  try {
    return await fastify.prisma.$transaction(async (tx) => {
      const document = await tx.document.create({
        data: {
          ...parsed.meta,
          description: parsed.meta.description ?? null,
          amount: parsed.meta.amount ?? null,
          filename,
          // Kept for display and downloads only — never used to build a path.
          originalName: originalName?.slice(0, 255) || filename,
          mimeType: mime,
          sizeBytes: size,
        },
      });

      const links = await buildLinks(fastify, document.id, parsed.links);
      if (links.length) await tx.documentLink.createMany({ data: links });

      return tx.document.findUnique({ where: { id: document.id }, include: DOCUMENT_INCLUDE });
    });
  } catch (err) {
    // The row is what makes the file reachable. If it never landed, the file is
    // unreferenced bytes on disk — remove it rather than leaking storage.
    await deleteDocumentFile(filename);
    throw err;
  }
}

export async function listDocuments(fastify: FastifyInstance, query: Record<string, string>) {
  const where: Record<string, unknown> = {};

  if (query.kind) where.kind = query.kind;
  if (query.orderId) where.links = { some: { orderId: query.orderId } };
  if (query.expenseId) where.links = { some: { expenseId: query.expenseId } };

  // "Unfiled" is the useful view nobody thinks to ask for until they need it:
  // what has been uploaded and never attached to anything.
  if (query.unlinked === 'true') where.links = { none: {} };

  if (query.from || query.to) {
    where.occurredAt = {
      ...(query.from ? { gte: new Date(query.from) } : {}),
      ...(query.to ? { lte: new Date(query.to) } : {}),
    };
  }

  if (query.search) {
    const search = query.search.trim();
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { originalName: { contains: search, mode: 'insensitive' } },
      // So pasting an order number finds the paperwork filed against it.
      { links: { some: { order: { orderNumber: { contains: search, mode: 'insensitive' } } } } },
    ];
  }

  // Paged, because a filing cabinet only ever grows and this endpoint returns
  // every link of every row. Offset paging rather than a cursor: the list is
  // sorted by a date the user can also filter on, so "give me the next 50 of
  // this filtered set" is exactly the question being asked, and there is no
  // infinite feed here for a cursor to protect.
  const { page, limit, skip } = getPaginationParams({ ...query, limit: query.limit ?? '50' });

  const [documents, total, kinds] = await Promise.all([
    fastify.prisma.document.findMany({
      where,
      include: DOCUMENT_INCLUDE,
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: limit,
    }),
    fastify.prisma.document.count({ where }),
    // Powers the "kinds already in use" suggestions — the same thing that keeps
    // free-text expense categories from fragmenting. Deliberately unfiltered
    // and unpaged: these are the filter chips, and one that vanished because
    // its only document sits on page 2 would be a dead end.
    fastify.prisma.document.findMany({ distinct: ['kind'], select: { kind: true }, orderBy: { kind: 'asc' } }),
  ]);

  return {
    documents,
    total,
    page,
    limit,
    hasMore: skip + documents.length < total,
    kinds: kinds.map((k) => k.kind),
  };
}

export async function getDocument(fastify: FastifyInstance, id: string) {
  // Guarded rather than handed straight to Prisma: findUnique with an undefined
  // id throws a schema error about DocumentWhereUniqueInput, which tells an
  // agent operator nothing about what they actually got wrong.
  if (!id) throw { statusCode: 400, message: 'A document id is required.' };
  const document = await fastify.prisma.document.findUnique({ where: { id }, include: DOCUMENT_INCLUDE });
  if (!document) throw { statusCode: 404, message: 'Document not found' };
  return document;
}

export async function updateDocument(fastify: FastifyInstance, id: string, body: unknown) {
  const data = updateSchema.parse(body);
  const existing = await fastify.prisma.document.findUnique({ where: { id } });
  if (!existing) throw { statusCode: 404, message: 'Document not found' };

  return fastify.prisma.document.update({ where: { id }, data, include: DOCUMENT_INCLUDE });
}

/**
 * Replace the whole set of links in one shot rather than exposing per-row CRUD.
 * The links are only meaningful as a set — "this invoice covers these four
 * orders" — and a partial edit is not a state worth being able to persist.
 */
export async function setDocumentLinks(fastify: FastifyInstance, id: string, body: unknown) {
  const links = linkTargets.parse(body);
  const existing = await fastify.prisma.document.findUnique({ where: { id } });
  if (!existing) throw { statusCode: 404, message: 'Document not found' };

  const rows = await buildLinks(fastify, id, links);

  await fastify.prisma.$transaction([
    fastify.prisma.documentLink.deleteMany({ where: { documentId: id } }),
    ...(rows.length ? [fastify.prisma.documentLink.createMany({ data: rows })] : []),
  ]);

  return getDocument(fastify, id);
}

export async function deleteDocument(fastify: FastifyInstance, id: string) {
  const document = await fastify.prisma.document.findUnique({ where: { id } });
  if (!document) throw { statusCode: 404, message: 'Document not found' };

  // Row first: a deleted row with the file still on disk is invisible clutter,
  // while a deleted file with the row still present is a broken link the UI
  // would offer to open. Link rows cascade.
  await fastify.prisma.document.delete({ where: { id } });
  await deleteDocumentFile(document.filename);

  return { deleted: true, title: document.title };
}

/**
 * RFC 6266 Content-Disposition.
 *
 * A header value in Node must be latin1; anything outside it throws
 * ERR_INVALID_CHAR and the whole response 500s. Uploaded filenames are not
 * ASCII in practice — a supplier invoice saved as "資料 invoice.pdf", or anything
 * a Mac names with a curly quote or an em dash — so the naive
 * `filename="${originalName}"` broke downloads for exactly the files most
 * likely to arrive here.
 *
 * Both forms are emitted, which is what the RFC asks for: a sanitised ASCII
 * `filename` every client understands, and `filename*` carrying the real name
 * percent-encoded as UTF-8 for the ones that do. Modern browsers prefer the
 * second, so the user still gets the original name.
 */
function contentDisposition(disposition: 'inline' | 'attachment', originalName: string): string {
  // Everything outside printable ASCII goes, and so do the quote and backslash
  // that would otherwise let a filename break out of the quoted string.
  const ascii = originalName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'document';
  // encodeURIComponent leaves !'()* alone, none of which are attr-char in
  // RFC 5987 — encode them too rather than emit a technically invalid header.
  const utf8 = encodeURIComponent(originalName).replace(
    /['()!*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

/**
 * The only way to read a document's bytes.
 *
 * Behind `fastify.authenticate` — unlike /uploads, which is a public static
 * mount. That difference is the whole security posture of this feature: these
 * files carry customer addresses and bank details, and a UUID in a URL is not
 * a permission.
 */
export async function streamDocument(
  fastify: FastifyInstance,
  id: string,
  reply: FastifyReply,
  disposition: 'inline' | 'attachment'
) {
  const document = await fastify.prisma.document.findUnique({ where: { id } });
  if (!document) throw { statusCode: 404, message: 'Document not found' };

  // Every stored file has had its type verified from its own bytes, so nothing
  // here can be HTML or SVG. These headers are the second line anyway: a stored
  // file must never execute against the admin's session.
  reply
    .header('Content-Type', document.mimeType)
    .header('Content-Length', document.sizeBytes)
    .header('Content-Disposition', contentDisposition(disposition, document.originalName))
    .header('Content-Security-Policy', "default-src 'none'; img-src 'self'; object-src 'none'")
    .header('X-Content-Type-Options', 'nosniff')
    // Never cached by a shared proxy: this is per-admin private content.
    .header('Cache-Control', 'private, no-store');

  return reply.send(createReadStream(documentPath(document.filename)));
}

export { isInlineViewable };
