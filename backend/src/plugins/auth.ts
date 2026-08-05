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

  // Admin gate. Every /api/v1/admin/* route hangs off this.
  //
  // The `kind` check is load-bearing, not decoration: storefront members are
  // signed with the SAME secret by the same instance, so without it a member's
  // token would satisfy jwtVerify() here and walk straight into the admin API.
  // The claim is what keeps the two populations apart.
  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    // Admin tokens issued before members existed carry no `kind` at all, and
    // stay valid for their remaining 24h — treating undefined as admin avoids
    // logging every admin out on deploy. This is safe in the direction that
    // matters: member tokens are always minted WITH kind: 'member', so the
    // legacy shape can never be produced by the member login path.
    if (request.user.kind === 'member') {
      return reply.status(403).send({ error: 'Forbidden' });
    }
  });

  // Storefront gate. Verifies the token, then re-reads the member on every
  // request rather than trusting the claims: a ban or a just-completed email
  // verification must take effect immediately, not whenever the 24h token
  // happens to expire.
  //
  // Deliberately does NOT require a confirmed email — an unverified member is
  // legitimately signed in, and /me has to answer for them so the UI can show
  // the "confirm your inbox" prompt. Posting is gated separately below.
  fastify.decorate('authenticateMember', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    if (request.user.kind !== 'member') {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const member = await fastify.prisma.member.findUnique({
      where: { id: request.user.id },
      select: { id: true, email: true, displayName: true, emailVerified: true, banned: true },
    });
    if (!member || member.banned) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    request.member = member;
  });

  // Chained after authenticateMember on anything that writes. 403 rather than
  // 401 on purpose: the client shows "confirm your email" instead of bouncing
  // a genuinely signed-in reader back to a login form.
  fastify.decorate('requireVerifiedMember', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.member?.emailVerified) {
      return reply.status(403).send({ error: 'Please confirm your email address before posting.' });
    }
  });
});

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateMember: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireVerifiedMember: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    // Populated by authenticateMember only.
    member?: { id: string; email: string; displayName: string; emailVerified: boolean; banned: boolean };
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    // `kind` is optional to keep pre-existing admin tokens type-compatible;
    // see the undefined-means-admin note above.
    payload: { id: string; email: string; kind?: 'admin' | 'member' };
    user: { id: string; email: string; kind?: 'admin' | 'member' };
  }
}
