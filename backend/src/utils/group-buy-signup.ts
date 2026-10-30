import type { FastifyInstance } from 'fastify';
import type { GroupBuy } from '@prisma/client';
import { newRewardCode } from './group-buy.js';

/**
 * Put someone on a batch's list, and give them the batch's sign-up reward when
 * there is one. The reward is a single-use code tied to their email address
 * (DiscountCode.boundEmail), so a shared code is worthless to anyone else.
 *
 * The code is EMAILED, not shown on screen — anyone can type an address into
 * the form, and only the inbox proves it is theirs. A signed-in member with a
 * confirmed email has already proven that, so they also see it straight away.
 */
export async function createSignup(
  fastify: FastifyInstance,
  gb: GroupBuy,
  input: {
    email: string;
    name?: string;
    phone?: string;
    source: string;
    member?: { id: string; email: string; emailVerified: boolean } | null;
    note?: string;
  }
) {
  const email = input.email.trim().toLowerCase();
  const member = input.member ?? null;
  const memberMatches = !!member && member.email.trim().toLowerCase() === email;

  const existing = await fastify.prisma.groupBuySignup.findUnique({
    where: { groupBuyId_email: { groupBuyId: gb.id, email } },
    include: { discountCode: true },
  });

  const rewardOn = gb.rewardEnabled && gb.rewardValue > 0;
  // Members-only rewards need a signed-in member signing up with their own address.
  const eligible = rewardOn && (!gb.rewardMembersOnly || memberMatches);

  let signup = existing;
  if (!signup) {
    signup = await fastify.prisma.groupBuySignup.create({
      data: {
        groupBuyId: gb.id,
        email,
        name: input.name || null,
        phone: input.phone || null,
        source: input.source,
        memberId: memberMatches ? member!.id : null,
        note: input.note || null,
      },
      include: { discountCode: true },
    });
  } else {
    // Joining again fills in what was missing; it never overwrites.
    const patch: Record<string, string> = {};
    if (!signup.name && input.name) patch.name = input.name;
    if (!signup.phone && input.phone) patch.phone = input.phone;
    if (!signup.memberId && memberMatches) patch.memberId = member!.id;
    if (Object.keys(patch).length) {
      signup = await fastify.prisma.groupBuySignup.update({ where: { id: signup.id }, data: patch, include: { discountCode: true } });
    }
  }

  let issued = false;
  if (eligible && !signup.discountCodeId) {
    const expiresAt = gb.rewardValidDays ? new Date(Date.now() + gb.rewardValidDays * 24 * 3600 * 1000) : null;
    for (let attempt = 0; attempt < 5 && !signup.discountCodeId; attempt++) {
      try {
        const code = await fastify.prisma.discountCode.create({
          data: {
            code: newRewardCode(gb.number),
            description: `Group Buy batch ${gb.number} sign-up reward — ${email}`,
            discountType: gb.rewardType === 'FIXED_AMOUNT' ? 'FIXED_AMOUNT' : 'PERCENTAGE',
            discountValue: gb.rewardValue,
            minOrderAmount: gb.rewardMinOrder,
            maxUses: 1,
            expiresAt,
            scope: gb.rewardScope === 'ANY' ? null : gb.rewardScope,
            groupBuyId: gb.rewardScope === 'GROUP_BUY' ? gb.id : null,
            boundEmail: email,
          },
        });
        signup = await fastify.prisma.groupBuySignup.update({ where: { id: signup.id }, data: { discountCodeId: code.id }, include: { discountCode: true } });
        issued = true;
      } catch (err) {
        if ((err as { code?: string }).code !== 'P2002') throw err;
      }
    }
  }

  // The welcome email: always for a new sign-up, and again when this visit is
  // the one that earned the code. Once per (sign-up, code) via the dedupe key.
  if (!existing || issued) {
    await fastify.prisma.groupBuyNotice.createMany({
      data: {
        groupBuyId: gb.id,
        signupId: signup.id,
        kind: 'SIGNUP',
        toEmail: email,
        dedupeKey: `signup:${signup.id}:${signup.discountCodeId ?? 'none'}`,
      },
      skipDuplicates: true,
    });
  }

  const code = signup.discountCode;
  const showCode = !!code && memberMatches && member!.emailVerified;
  return {
    status: existing ? 'already' : 'joined',
    reward: code
      ? {
          emailed: true,
          code: showCode ? code.code : null,
          type: code.discountType,
          value: code.discountValue,
          expiresAt: code.expiresAt,
        }
      : null,
    // A members-only reward the visitor would get by signing in.
    rewardNeedsMember: rewardOn && gb.rewardMembersOnly && !memberMatches,
  };
}
