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

    // Prisma unique-constraint violation (e.g. a variant `code` that's
    // already used elsewhere) — surface it as a clear 409, not a raw 500.
    // Duck-typed rather than `instanceof Prisma.PrismaClientKnownRequestError`
    // since the driver-adapter build can end up with two separate copies of
    // the Prisma runtime class across the module graph, which breaks instanceof.
    const prismaError = error as { code?: string; meta?: Record<string, unknown> };
    if (prismaError.code === 'P2002') {
      const meta = prismaError.meta as
        | { target?: string | string[]; driverAdapterError?: { cause?: { constraint?: { fields?: string[] } } } }
        | undefined;
      const fields = meta?.target ?? meta?.driverAdapterError?.cause?.constraint?.fields;
      const fieldList = Array.isArray(fields) ? fields.join(', ') : fields;
      return reply.status(409).send({
        error: fieldList ? `A record with this ${fieldList} already exists` : 'A record with these values already exists',
      });
    }

    const statusCode = 'statusCode' in error ? (error as FastifyError).statusCode : undefined;
    if (statusCode) {
      // A hand-thrown `{ statusCode, message }` may also carry `details` in the
      // same shape a ZodError produces. That's the only way a rule enforced in
      // code rather than in the schema (e.g. the East Malaysia minimum, which
      // needs a DB read) can still land inline on the field it's about instead
      // of in the generic error banner. Absent on almost every throw.
      const details = (error as { details?: { path?: string; message?: string }[] }).details;
      return reply.status(statusCode).send({ error: error.message, ...(details ? { details } : {}) });
    }

    fastify.log.error(error);
    return reply.status(500).send({ error: 'Internal Server Error' });
  });
});
