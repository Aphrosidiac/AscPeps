import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { env } from '../../config/env.js';
import { isEmailEnabled, sendEmail } from '../../utils/email.js';
import { renderVerifyEmail } from '../../emails/verify-email.js';

const registerSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  displayName: z.string().trim().min(2, 'Name must be at least 2 characters').max(40),
});

const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1),
});

const emailOnlySchema = z.object({ email: z.string().email().max(200) });

// Same trick as the admin login (modules/auth/auth.controller.ts): a real
// bcrypt comparison against a throwaway hash so a nonexistent email costs the
// same wall-clock time as a wrong password.
const DUMMY_HASH = '$2b$12$VrNkdp05BDXELusXONkTreWe31fJHex0cpnFDrJREMb8WiI55d49O';

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

// Deliberately identical for "created", "already registered, still pending"
// and "already registered and verified" — the endpoint must not become an
// oracle for which addresses hold an account. The frontend copy is phrased
// conditionally ("if that address isn't already registered...") so this
// doesn't read as a broken promise when no mail arrives.
const REGISTER_RESPONSE = {
  success: true,
  message: "Check your inbox — if that address isn't already registered, a confirmation link is on its way.",
};

const publicFields = { id: true, email: true, displayName: true, emailVerified: true } as const;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Mints a fresh verification token, persists only its hash, and mails the raw one. */
async function issueVerification(
  fastify: FastifyInstance,
  member: { id: string; email: string; displayName: string }
): Promise<void> {
  const token = crypto.randomBytes(32).toString('hex');

  await fastify.prisma.member.update({
    where: { id: member.id },
    data: {
      verifyTokenHash: hashToken(token),
      verifyTokenExpiresAt: new Date(Date.now() + VERIFY_TTL_MS),
    },
  });

  // Email is optional infrastructure here, exactly as it is for orders — with
  // it switched off (or no Resend key) signup still succeeds and the account
  // simply waits, rather than the whole request 500ing.
  if (!(await isEmailEnabled(fastify.prisma))) {
    fastify.log.warn(`Email disabled — verification link for ${member.email}: /account/verify?token=${token}`);
    return;
  }

  const settingsRows = await fastify.prisma.setting.findMany();
  const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));

  const verifyUrl = `${env.FRONTEND_URL}/account/verify?token=${token}`;
  const { subject, html } = renderVerifyEmail(member.displayName, verifyUrl, settings);

  try {
    await sendEmail({ to: member.email, subject, html });
  } catch (err) {
    // Swallowed on purpose: the member can retry from the "resend
    // confirmation" link, and failing the signup would lose the account row
    // that retry depends on.
    fastify.log.error({ err }, `Failed to send verification email to ${member.email}`);
  }
}

export async function register(fastify: FastifyInstance, body: unknown) {
  const { email, password, displayName } = registerSchema.parse(body);
  const normalisedEmail = email.trim().toLowerCase();

  const existing = await fastify.prisma.member.findUnique({ where: { email: normalisedEmail } });

  if (existing) {
    // Unverified signup re-attempt is the common honest case (lost email,
    // typo'd inbox) — reissue rather than stranding them. A verified account
    // gets nothing, and both paths return the same body as a fresh signup.
    if (!existing.emailVerified && !existing.banned) {
      await issueVerification(fastify, existing);
    }
    return REGISTER_RESPONSE;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const member = await fastify.prisma.member.create({
    data: { email: normalisedEmail, passwordHash, displayName },
  });

  await issueVerification(fastify, member);
  return REGISTER_RESPONSE;
}

export async function login(fastify: FastifyInstance, body: unknown) {
  const { email, password } = loginSchema.parse(body);
  const normalisedEmail = email.trim().toLowerCase();

  const member = await fastify.prisma.member.findUnique({ where: { email: normalisedEmail } });
  if (!member) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw { statusCode: 401, message: 'Invalid email or password' };
  }

  const valid = await bcrypt.compare(password, member.passwordHash);
  if (!valid) {
    throw { statusCode: 401, message: 'Invalid email or password' };
  }
  if (member.banned) {
    throw { statusCode: 403, message: 'This account has been suspended.' };
  }

  // Unverified members are allowed IN — they just can't post (see
  // authenticateMember). Signing in is how they reach the "resend
  // confirmation" prompt in the first place.
  const token = fastify.jwt.sign({ id: member.id, email: member.email, kind: 'member' });
  return {
    token,
    member: {
      id: member.id,
      email: member.email,
      displayName: member.displayName,
      emailVerified: member.emailVerified,
    },
  };
}

export async function getMe(fastify: FastifyInstance, memberId: string) {
  const member = await fastify.prisma.member.findUnique({
    where: { id: memberId },
    select: publicFields,
  });
  if (!member) {
    throw { statusCode: 404, message: 'Account not found' };
  }
  return member;
}

export async function verifyEmail(fastify: FastifyInstance, token: string) {
  if (!token) {
    throw { statusCode: 400, message: 'Missing confirmation token' };
  }

  const member = await fastify.prisma.member.findFirst({
    where: {
      verifyTokenHash: hashToken(token),
      verifyTokenExpiresAt: { gt: new Date() },
    },
  });
  if (!member) {
    throw { statusCode: 400, message: 'This confirmation link is invalid or has expired.' };
  }

  await fastify.prisma.member.update({
    where: { id: member.id },
    // Token cleared so the link is strictly single-use.
    data: { emailVerified: true, verifyTokenHash: null, verifyTokenExpiresAt: null },
  });

  return { success: true };
}

export async function resendVerification(fastify: FastifyInstance, body: unknown) {
  const { email } = emailOnlySchema.parse(body);
  const normalisedEmail = email.trim().toLowerCase();

  const member = await fastify.prisma.member.findUnique({ where: { email: normalisedEmail } });
  if (member && !member.emailVerified && !member.banned) {
    await issueVerification(fastify, member);
  }

  // Non-enumerating, same as register.
  return { success: true, message: 'If that account still needs confirming, a new link is on its way.' };
}
