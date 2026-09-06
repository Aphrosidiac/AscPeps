import type { FastifyInstance } from 'fastify';
import {
  deleteDocument,
  getDocument,
  isInlineViewable,
  listDocuments,
  setDocumentLinks,
  streamDocument,
  updateDocument,
  uploadDocument,
} from './admin-documents.controller.js';

export default async function adminDocumentsRoutes(fastify: FastifyInstance) {
  // Every route here, the file stream included. There is no unauthenticated
  // path to a document's bytes — see the note in utils/document-store.ts.
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/', async (request) => listDocuments(fastify, request.query as Record<string, string>));

  fastify.post('/', async (request) => uploadDocument(fastify, request));

  fastify.get<{ Params: { id: string } }>('/:id', async (request) => getDocument(fastify, request.params.id));

  fastify.patch<{ Params: { id: string } }>('/:id', async (request) =>
    updateDocument(fastify, request.params.id, request.body)
  );

  // Replace-all, like an order's profit split: the links only mean anything as
  // a set.
  fastify.put<{ Params: { id: string } }>('/:id/links', async (request) =>
    setDocumentLinks(fastify, request.params.id, request.body)
  );

  fastify.delete<{ Params: { id: string } }>('/:id', async (request) =>
    deleteDocument(fastify, request.params.id)
  );

  // The bytes. `?download=1` forces a save rather than a preview; a type the
  // browser cannot safely display inline is always sent as an attachment.
  fastify.get<{ Params: { id: string }; Querystring: { download?: string } }>(
    '/:id/file',
    async (request, reply) => {
      const document = await getDocument(fastify, request.params.id);
      const wantsDownload = request.query.download === '1' || !isInlineViewable(document.mimeType);
      return streamDocument(fastify, request.params.id, reply, wantsDownload ? 'attachment' : 'inline');
    }
  );
}
