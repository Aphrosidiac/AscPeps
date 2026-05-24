import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyError } from 'fastify';
import { ZodError } from 'zod';

export default fp(async (fastify: FastifyInstance) => {
  fastify.setErrorHandler((error: FastifyError | Error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'Validation Error',
        details: error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }

    const statusCode = 'statusCode' in error ? (error as FastifyError).statusCode : undefined;
    if (statusCode) {
      return reply.status(statusCode).send({ error: error.message });
    }

    fastify.log.error(error);
    return reply.status(500).send({ error: 'Internal Server Error' });
  });
});
