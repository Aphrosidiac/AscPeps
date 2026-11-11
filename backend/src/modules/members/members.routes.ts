import type { FastifyInstance } from 'fastify';
import {
  register,
  login,
  getMe,
  verifyEmail,
  resendVerification,
  updateProfile,
  changePassword,
  requestEmailChange,
  cancelEmailChange,
  confirmEmailChange,
  forgotPassword,
  resetPassword,
  REGISTER_RESPONSE,
} from './members.controller.js';
import { identityFrom, screen } from '../../utils/blocklist.js';

export default async function memberRoutes(fastify: FastifyInstance) {
  // Tighter than the global 100/min limiter. Signup and the resend endpoint
  // both cause outbound mail on someone else's address, so they get the
  // strictest buckets; login matches the admin login's 5/min.
  fastify.post(
    '/register',
    { config: { rateLimit: { max: 3, timeWindow: '10 minutes' }, blocklist: 'screen' } },
    // Blocked: the same answer as any signup, and no account, no email.
    async (request) =>
      (await screen(fastify, request, 'register', identityFrom(request.body)))
        ? REGISTER_RESPONSE
        : register(fastify, request.body)
  );

  fastify.post(
    '/login',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' }, blocklist: 'screen' } },
    async (request) => {
      if (await screen(fastify, request, 'login', identityFrom(request.body))) {
        throw { statusCode: 403, message: 'This account has been suspended.' };
      }
      return login(fastify, request.body);
    }
  );

  fastify.post(
    '/resend-verification',
    { config: { rateLimit: { max: 3, timeWindow: '10 minutes' } } },
    async (request) => resendVerification(fastify, request.body)
  );

  // GET rather than POST because it is reached by clicking a link in an email.
  fastify.get<{ Querystring: { token?: string } }>(
    '/verify',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => verifyEmail(fastify, request.query.token ?? '')
  );

  fastify.get(
    '/me',
    { preHandler: [fastify.authenticateMember] },
    async (request) => getMe(fastify, request.member!.id)
  );

  // ---- Account settings ----

  fastify.patch(
    '/me',
    { preHandler: [fastify.authenticateMember], config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request) => updateProfile(fastify, request.member!.id, request.body)
  );

  fastify.post(
    '/me/password',
    { preHandler: [fastify.authenticateMember], config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (request) => changePassword(fastify, request.member!.id, request.body)
  );

  // Mails the new address, so it shares the strict bucket with register.
  fastify.post(
    '/me/email',
    { preHandler: [fastify.authenticateMember], config: { rateLimit: { max: 3, timeWindow: '10 minutes' } } },
    async (request) => requestEmailChange(fastify, request.member!.id, request.body)
  );

  fastify.delete(
    '/me/email',
    { preHandler: [fastify.authenticateMember] },
    async (request) => cancelEmailChange(fastify, request.member!.id)
  );

  fastify.post(
    '/confirm-email',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => confirmEmailChange(fastify, request.body)
  );

  fastify.post(
    '/forgot-password',
    { config: { rateLimit: { max: 3, timeWindow: '10 minutes' }, blocklist: 'screen' } },
    async (request) =>
      (await screen(fastify, request, 'forgot-password', identityFrom(request.body)))
        ? { success: true, message: 'If that email has an account, a reset link is on its way.' }
        : forgotPassword(fastify, request.body)
  );

  fastify.post(
    '/reset-password',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => resetPassword(fastify, request.body)
  );
}
