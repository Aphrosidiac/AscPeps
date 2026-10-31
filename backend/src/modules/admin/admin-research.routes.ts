import type { FastifyInstance } from 'fastify';
import {
  adminListResearch, adminGetResearch, adminCreateResearch, adminUpdateResearch, adminDeleteResearch,
  adminPublishResearch, adminUnpublishResearch, adminRenameResearch, adminResearchTargets,
  adminAddResearchImage, adminUpdateResearchImage, adminDeleteResearchImage,
  adminListSources, adminCreateSource, adminUpdateSource, adminDeleteSource, adminLookupPubmed,
  adminListAuthors, adminCreateAuthor, adminUpdateAuthor, adminDeleteAuthor,
} from './admin-research.controller.js';

type Id = { Params: { id: string } };

export default async function adminResearchRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // Literal segments before '/:id' so they can't be read as an article id.
  fastify.get('/sources', async (request) => adminListSources(fastify, request.query as Record<string, string>));
  fastify.post('/sources', async (request) => adminCreateSource(fastify, request.body));
  fastify.get<{ Params: { pmid: string } }>('/sources/pubmed/:pmid', async (request) => adminLookupPubmed(request.params.pmid));
  fastify.patch<Id>('/sources/:id', async (request) => adminUpdateSource(fastify, request.params.id, request.body));
  fastify.delete<Id>('/sources/:id', async (request) => adminDeleteSource(fastify, request.params.id));

  fastify.get('/authors', async () => adminListAuthors(fastify));
  fastify.post('/authors', async (request) => adminCreateAuthor(fastify, request.body));
  fastify.patch<Id>('/authors/:id', async (request) => adminUpdateAuthor(fastify, request.params.id, request.body));
  fastify.delete<Id>('/authors/:id', async (request) => adminDeleteAuthor(fastify, request.params.id));

  fastify.patch<Id>('/images/:id', async (request) => adminUpdateResearchImage(fastify, request.params.id, request.body));
  fastify.delete<Id>('/images/:id', async (request) => adminDeleteResearchImage(fastify, request.params.id));

  fastify.get('/targets', async () => adminResearchTargets(fastify));
  fastify.get('/', async () => adminListResearch(fastify));
  fastify.post('/', async (request) => adminCreateResearch(fastify, request.body));
  fastify.get<Id>('/:id', async (request) => adminGetResearch(fastify, request.params.id));
  fastify.patch<Id>('/:id', async (request) => adminUpdateResearch(fastify, request.params.id, request.body));
  fastify.delete<Id>('/:id', async (request) => adminDeleteResearch(fastify, request.params.id, request.body));
  fastify.post<Id>('/:id/publish', async (request) => adminPublishResearch(fastify, request.params.id));
  fastify.post<Id>('/:id/unpublish', async (request) => adminUnpublishResearch(fastify, request.params.id));
  fastify.post<Id>('/:id/rename', async (request) => adminRenameResearch(fastify, request.params.id, request.body));
  fastify.post<Id>('/:id/images', async (request) => adminAddResearchImage(fastify, request.params.id, request.body));
}
