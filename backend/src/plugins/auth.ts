import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env.js';

export default fp(async (fastify: FastifyInstance) => {
  await fastify.register(jwt, {
    secret: env.JWT_SECRET,
    // Pin the algorithm on both sign and verify so the accepted-alg set can't
    // silently widen (alg-confusion hardening).
    sign: { algorithm: 'HS256', expiresIn: '24h' },
    verify: { algorithms: ['HS256'] },
  });

  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.status(401).send({ error: 'Unauthorized' });
    }
  });
});

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { id: string; email: string };
    user: { id: string; email: string };
  }
}
