import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { env } from '../../config/env.js';
import { isEmailEnabled, sendEmail } from '../../utils/email.js';
import { renderVerifyEmail } from '../../emails/verify-email.js';
import { renderConfirmNewEmail, renderEmailChangedNotice, renderResetPasswordEmail, renderSignupBonusEmail } from '../../emails/account.js';
import { getAffiliateSettings, mailbox } from '../../utils/affiliate.js';

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
export const REGISTER_RESPONSE = {
  success: true,
  message: "Check your inbox — if that address isn't already registered, a confirmation link is on its way.",
};

const publicFields = { id: true, email: true, displayName: true, emailVerified: true, pendingEmail: true } as const;

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
  // Says what confirming unlocks — only when this inbox would really get it.
  const { subject, html } = renderVerifyEmail(member.displayName, verifyUrl, settings, await signupBonusFor(fastify, member.email));

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
      pendingEmail: member.pendingEmail,
    },
  };
}

export async function getMe(fastify: FastifyInstance, memberId: string) {
  const member = await fastify.prisma.member.findUnique({
    where: { id: memberId },
    select: { ...publicFields, signupBonusCode: { select: { code: true, discountValue: true, usedCount: true, isActive: true } } },
  });
  if (!member) {
    throw { statusCode: 404, message: 'Account not found' };
  }
  const { signupBonusCode, ...rest } = member;
  return {
    ...rest,
    // Shown on the account page until it is used.
    signupBonus: signupBonusCode
      ? { code: signupBonusCode.code, percent: signupBonusCode.discountValue, used: signupBonusCode.usedCount > 0 || !signupBonusCode.isActive }
      : null,
  };
}

/** A single-use code for this account's email, once per account. */
/**
 * The sign-up bonus this address would get on confirming: the percent while
 * the bonus is on and its inbox has never had one (me+2@gmail.com and
 * m.e@gmail.com are me@gmail.com again), else null.
 */
async function signupBonusFor(fastify: FastifyInstance, email: string): Promise<number | null> {
  const settings = await getAffiliateSettings(fastify.prisma);
  if (!settings.signupBonusEnabled) return null;
  const inbox = mailbox(email);
  const minted = await fastify.prisma.member.findMany({ where: { signupBonusCodeId: { not: null } }, select: { email: true } });
  return minted.some((m) => mailbox(m.email) === inbox) ? null : settings.signupBonusPct;
}

export async function mintSignupBonus(fastify: FastifyInstance, memberId: string) {
  const member = await fastify.prisma.member.findUnique({ where: { id: memberId }, select: { email: true, displayName: true, signupBonusCodeId: true, emailVerified: true } });
  if (!member || member.signupBonusCodeId || !member.emailVerified) return null;
  const pct = await signupBonusFor(fastify, member.email);
  if (pct === null) return null;
  // One to an inbox, for good. The row outlives an email change and a deleted
  // account, and its key settles two confirmations racing each other.
  const inbox = mailbox(member.email);
  const claimed = await fastify.prisma.signupBonusClaim.createMany({ data: [{ inbox, memberId }], skipDuplicates: true });
  if (claimed.count === 0) return null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = `WELCOME-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    let created;
    try {
      created = await fastify.prisma.$transaction(async (tx) => {
        const row = await tx.discountCode.create({
          data: {
            code,
            description: `Sign-up bonus · ${member.email}`,
            discountType: 'PERCENTAGE',
            discountValue: pct,
            maxUses: 1,
            scope: 'STORE',
            boundEmail: member.email,
          },
        });
        // Conditional so two confirmations racing mint one code.
        const { count } = await tx.member.updateMany({ where: { id: memberId, signupBonusCodeId: null }, data: { signupBonusCodeId: row.id } });
        if (count === 0) throw new Error('already minted');
        return row;
      });
    } catch (err) {
      if ((err as Error).message === 'already minted') return null;
      if ((err as { code?: string }).code !== 'P2002') {
        // Nothing was given, so the inbox can still have its code.
        await fastify.prisma.signupBonusClaim.delete({ where: { inbox } }).catch(() => {});
        throw err;
      }
      continue;
    }
    // The popup promised it: send it now rather than leave it on a page they
    // may never open. Logged instead while email is off; never undoes the mint.
    await mailMember(fastify, member.email, `sign-up code ${created.code}`, null, (settings) =>
      renderSignupBonusEmail(member.displayName, created.code, pct, `${env.FRONTEND_URL}/products`, settings)
    );
    return created;
  }
  return null;
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
  // The one-time sign-up bonus, when it is on. Minted on confirmation rather
  // than sign-up, so a made-up address never gets one.
  const bonus = await mintSignupBonus(fastify, member.id).catch((err) => {
    fastify.log.warn({ err, memberId: member.id }, 'sign-up bonus not minted');
    return null;
  });

  // The confirmed page shows the code there and then. Only whoever holds this
  // single-use link (sent to the inbox it belongs to) ever sees it.
  return { success: true, signupBonus: bonus ? { code: bonus.code, percent: bonus.discountValue } : null };
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

// ---- Account settings ----

const RESET_TTL_MS = 60 * 60 * 1000;
const EMAIL_CHANGE_TTL_MS = 24 * 60 * 60 * 1000;

// Links in these mails land back where the member asked from, so someone in
// the Group Buy portal never gets dropped into the store's chrome.
const whereSchema = z.enum(['store', 'group-buy']).default('store');
type Where = z.infer<typeof whereSchema>;

function accountUrl(where: Where, page: string, token: string): string {
  return `${env.FRONTEND_URL}${where === 'group-buy' ? '/group-buy' : '/account'}/${page}?token=${token}`;
}

const newPassword = z.string().min(8, 'Password must be at least 8 characters').max(200);

const profileSchema = z.object({
  displayName: z.string().trim().min(2, 'Name must be at least 2 characters').max(40),
});
const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword });
const changeEmailSchema = z.object({ newEmail: z.string().email().max(200), password: z.string().min(1), where: whereSchema });
const forgotSchema = z.object({ email: z.string().email().max(200), where: whereSchema });
const resetSchema = z.object({ token: z.string().min(1), password: newPassword });
const tokenSchema = z.object({ token: z.string().min(1) });

function signMember(fastify: FastifyInstance, member: { id: string; email: string }): string {
  return fastify.jwt.sign({ id: member.id, email: member.email, kind: 'member' });
}

/** Sends one account mail, or logs the link when email is switched off (as issueVerification does). */
async function mailMember(
  fastify: FastifyInstance,
  to: string,
  what: string,
  link: string | null,
  render: (settings: Record<string, string>) => { subject: string; html: string }
): Promise<void> {
  if (!(await isEmailEnabled(fastify.prisma))) {
    fastify.log.warn(`Email disabled — ${what} for ${to}${link ? `: ${link}` : ''}`);
    return;
  }
  const settingsRows = await fastify.prisma.setting.findMany();
  const { subject, html } = render(Object.fromEntries(settingsRows.map((s) => [s.key, s.value])));
  try {
    await sendEmail({ to, subject, html });
  } catch (err) {
    // The member can ask again; failing the request would not help them.
    fastify.log.error({ err }, `Failed to send ${what} to ${to}`);
  }
}

/** The signed-in member's row with its password hash, for the checks below. */
async function loadMember(fastify: FastifyInstance, memberId: string) {
  const member = await fastify.prisma.member.findUnique({ where: { id: memberId } });
  if (!member) throw { statusCode: 404, message: 'Account not found' };
  return member;
}

async function checkPassword(hash: string, password: string): Promise<void> {
  // 400, not 401: a 401 reads as "session expired" to the client and signs
  // the member out over a typo.
  if (!(await bcrypt.compare(password, hash))) {
    throw { statusCode: 400, message: 'That password is not right.' };
  }
}

export async function updateProfile(fastify: FastifyInstance, memberId: string, body: unknown) {
  const { displayName } = profileSchema.parse(body);
  return fastify.prisma.member.update({ where: { id: memberId }, data: { displayName }, select: publicFields });
}

export async function changePassword(fastify: FastifyInstance, memberId: string, body: unknown) {
  const { currentPassword, newPassword: password } = changePasswordSchema.parse(body);
  const member = await loadMember(fastify, memberId);
  await checkPassword(member.passwordHash, currentPassword);

  const updated = await fastify.prisma.member.update({
    where: { id: memberId },
    data: {
      passwordHash: await bcrypt.hash(password, 12),
      // Signs every other device out (authenticateMember); this one gets the
      // fresh token below.
      passwordChangedAt: new Date(),
      resetTokenHash: null,
      resetTokenExpiresAt: null,
    },
    select: publicFields,
  });
  return { token: signMember(fastify, updated), member: updated };
}

export async function requestEmailChange(fastify: FastifyInstance, memberId: string, body: unknown) {
  const { newEmail, password, where } = changeEmailSchema.parse(body);
  const member = await loadMember(fastify, memberId);
  await checkPassword(member.passwordHash, password);

  const normalised = newEmail.trim().toLowerCase();
  if (normalised === member.email) {
    throw { statusCode: 400, message: 'That is already your email.' };
  }
  // Behind a correct password and a tight rate limit, saying the address is
  // taken is worth more to the member than hiding it.
  if (await fastify.prisma.member.findUnique({ where: { email: normalised }, select: { id: true } })) {
    throw { statusCode: 409, message: 'Another account already uses that email.' };
  }

  const token = crypto.randomBytes(32).toString('hex');
  const updated = await fastify.prisma.member.update({
    where: { id: memberId },
    data: {
      pendingEmail: normalised,
      emailChangeTokenHash: hashToken(token),
      emailChangeExpiresAt: new Date(Date.now() + EMAIL_CHANGE_TTL_MS),
    },
    select: publicFields,
  });

  const url = accountUrl(where, 'confirm-email', token);
  await mailMember(fastify, normalised, 'new-email confirmation', url, (settings) =>
    renderConfirmNewEmail(member.displayName, normalised, url, settings)
  );
  return updated;
}

export async function cancelEmailChange(fastify: FastifyInstance, memberId: string) {
  return fastify.prisma.member.update({
    where: { id: memberId },
    data: { pendingEmail: null, emailChangeTokenHash: null, emailChangeExpiresAt: null },
    select: publicFields,
  });
}

export async function confirmEmailChange(fastify: FastifyInstance, body: unknown) {
  const { token } = tokenSchema.parse(body);
  const member = await fastify.prisma.member.findFirst({
    where: { emailChangeTokenHash: hashToken(token), emailChangeExpiresAt: { gt: new Date() } },
  });
  if (!member?.pendingEmail) {
    throw { statusCode: 400, message: 'This link is invalid or has expired.' };
  }
  const newEmail = member.pendingEmail;
  // Someone may have registered it since the change was asked for.
  const taken = await fastify.prisma.member.findUnique({ where: { email: newEmail }, select: { id: true } });
  if (taken && taken.id !== member.id) {
    throw { statusCode: 409, message: 'Another account now uses that email.' };
  }

  // An unused sign-up code is tied to the address: it moves with it, or it
  // could never be used again.
  if (member.signupBonusCodeId) {
    await fastify.prisma.discountCode.updateMany({
      where: { id: member.signupBonusCodeId, usedCount: 0 },
      data: { boundEmail: newEmail, description: `Sign-up bonus · ${newEmail}` },
    });
  }

  await fastify.prisma.member.update({
    where: { id: member.id },
    data: {
      email: newEmail,
      // Clicking the link proves the new inbox is theirs.
      emailVerified: true,
      verifyTokenHash: null,
      verifyTokenExpiresAt: null,
      pendingEmail: null,
      emailChangeTokenHash: null,
      emailChangeExpiresAt: null,
    },
  });

  await mailMember(fastify, member.email, 'email-changed notice', null, (settings) =>
    renderEmailChangedNotice(member.displayName, newEmail, settings)
  );
  return { success: true, email: newEmail };
}

export async function forgotPassword(fastify: FastifyInstance, body: unknown) {
  const { email, where } = forgotSchema.parse(body);
  const member = await fastify.prisma.member.findUnique({ where: { email: email.trim().toLowerCase() } });

  if (member && !member.banned) {
    const token = crypto.randomBytes(32).toString('hex');
    await fastify.prisma.member.update({
      where: { id: member.id },
      data: { resetTokenHash: hashToken(token), resetTokenExpiresAt: new Date(Date.now() + RESET_TTL_MS) },
    });
    const url = accountUrl(where, 'reset-password', token);
    await mailMember(fastify, member.email, 'password reset link', url, (settings) =>
      renderResetPasswordEmail(member.displayName, url, settings)
    );
  }

  // Non-enumerating, same as register.
  return { success: true, message: 'If that email has an account, a reset link is on its way.' };
}

export async function resetPassword(fastify: FastifyInstance, body: unknown) {
  const { token, password } = resetSchema.parse(body);
  const member = await fastify.prisma.member.findFirst({
    where: { resetTokenHash: hashToken(token), resetTokenExpiresAt: { gt: new Date() } },
  });
  if (!member) {
    throw { statusCode: 400, message: 'This reset link is invalid or has expired.' };
  }
  if (member.banned) {
    throw { statusCode: 403, message: 'This account has been suspended.' };
  }

  const updated = await fastify.prisma.member.update({
    where: { id: member.id },
    data: {
      passwordHash: await bcrypt.hash(password, 12),
      passwordChangedAt: new Date(),
      resetTokenHash: null,
      resetTokenExpiresAt: null,
      // The link reached their inbox, which is all confirming does.
      emailVerified: true,
      verifyTokenHash: null,
      verifyTokenExpiresAt: null,
    },
    select: publicFields,
  });
  // Signed straight in, so the reset ends where they were going.
  return { token: signMember(fastify, updated), member: updated };
}
