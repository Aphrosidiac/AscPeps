/**
 * Ascend Affiliate — changing your own details (docs/affiliate.md).
 *
 * Fakhrul, 2026-11-03: an affiliate's bank account, name, WhatsApp and where
 * they share are locked once they are in. They press Edit, and saving sends a
 * request the team approves; nothing moves until then, so a payout never goes
 * to an account the team hasn't seen. One request at a time: sending again
 * replaces the waiting one, so the team only ever sees the latest.
 *
 * The affiliate sends the details as they want them; the request keeps only
 * the fields that differ from what is approved (and what they were), so the
 * team reads a short before → after.
 */
import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { normalizePhone } from '../../utils/phone.js';
import { notifyAffiliateTeam } from '../../utils/affiliate-notify.js';
import { mailAffiliate } from '../../utils/affiliate-mail.js';

export const DETAIL_FIELDS = ['fullName', 'phone', 'channel', 'bankName', 'bankAccountName', 'bankAccountNumber'] as const;
export type DetailField = (typeof DETAIL_FIELDS)[number];
export type Details = Record<DetailField, string | null>;

const LABEL: Record<DetailField, string> = {
  fullName: 'Name',
  phone: 'WhatsApp',
  channel: 'Shares on',
  bankName: 'Bank',
  bankAccountName: 'Account name',
  bankAccountNumber: 'Account no.',
};

const BANK_FIELDS: DetailField[] = ['bankName', 'bankAccountName', 'bankAccountNumber'];

const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

const requestSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name.').max(80),
  phone: z.string().trim().min(8, 'Enter a Malaysian mobile number.').max(20),
  channel: z.string().trim().max(200).nullable().optional(),
  bankName: z.string().trim().max(80).nullable().optional(),
  bankAccountName: z.string().trim().max(80).nullable().optional(),
  bankAccountNumber: z
    .string()
    .trim()
    .transform((v) => v.replace(/[ -]/g, ''))
    .refine((v) => v === '' || /^\d{6,24}$/.test(v), 'Account number: numbers only, as on your statement.')
    .nullable()
    .optional(),
});

/** The details as the affiliate wants them, checked and tidied. */
function desired(body: unknown): Details {
  const d = requestSchema.parse(body);
  let phone: string;
  try {
    phone = normalizePhone(d.phone);
  } catch {
    throw { statusCode: 400, message: 'Enter a Malaysian mobile number.' };
  }
  const bank = { bankName: blank(d.bankName), bankAccountName: blank(d.bankAccountName), bankAccountNumber: blank(d.bankAccountNumber) };
  const filled = Object.values(bank).filter(Boolean).length;
  if (filled > 0 && filled < 3) throw { statusCode: 400, message: 'Fill in the bank, the account holder name and the account number.' };
  if (bank.bankAccountName && bank.bankAccountName.length < 2) throw { statusCode: 400, message: 'Enter the account holder name.' };
  return { fullName: d.fullName, phone, channel: blank(d.channel), ...bank };
}

function pick(a: Details): Details {
  return Object.fromEntries(DETAIL_FIELDS.map((k) => [k, a[k] ?? null])) as Details;
}

/** "Maybank ····5678": the team's chats never carry a whole account number. */
function shown(field: DetailField, v: string | null): string {
  if (v == null) return '—';
  return field === 'bankAccountNumber' ? `····${v.slice(-4)}` : v;
}

export interface ChangeView {
  id: string;
  status: string;
  changes: Partial<Details>;
  previous: Partial<Details>;
  sentAt: Date;
  decidedAt: Date | null;
  decidedBy: string | null;
  rejectReason: string | null;
}

const VIEW = { id: true, status: true, changes: true, previous: true, updatedAt: true, decidedAt: true, decidedBy: true, rejectReason: true } as const;

function view(r: { id: string; status: string; changes: Prisma.JsonValue; previous: Prisma.JsonValue; updatedAt: Date; decidedAt: Date | null; decidedBy: string | null; rejectReason: string | null }): ChangeView {
  return {
    id: r.id,
    status: r.status,
    changes: (r.changes ?? {}) as Partial<Details>,
    previous: (r.previous ?? {}) as Partial<Details>,
    sentAt: r.updatedAt,
    decidedAt: r.decidedAt,
    decidedBy: r.decidedBy,
    rejectReason: r.rejectReason,
  };
}

/** The waiting request, and the last answer if it was a no (shown until they send again). */
export async function changeState(fastify: FastifyInstance, affiliateId: string) {
  const latest = await fastify.prisma.affiliateChangeRequest.findFirst({ where: { affiliateId }, orderBy: { updatedAt: 'desc' }, select: VIEW });
  return {
    changeRequest: latest?.status === 'PENDING' ? view(latest) : null,
    lastRejected: latest?.status === 'REJECTED' ? view(latest) : null,
  };
}

/**
 * Sends (or replaces) the affiliate's request. Sending the approved details
 * back unchanged withdraws a waiting request.
 */
export async function requestChange(fastify: FastifyInstance, memberId: string, body: unknown): Promise<void> {
  const want = desired(body);
  const result = await fastify.prisma.$transaction(async (tx) => {
    const a = await tx.affiliate.findUnique({ where: { memberId }, select: { id: true, status: true, fullName: true, discountCode: { select: { code: true } } } });
    if (!a) throw { statusCode: 404, message: 'You have not joined yet.' };
    if (a.status === 'REJECTED') throw { statusCode: 400, message: 'Your application was not approved.' };
    // One request at a time, even with two tabs sending at once.
    await tx.$queryRaw`SELECT id FROM affiliates WHERE id = ${a.id} FOR UPDATE`;
    const now = pick((await tx.affiliate.findUniqueOrThrow({ where: { id: a.id } })) as unknown as Details);
    if (now.bankName && !want.bankName) throw { statusCode: 400, message: 'Bank details can be changed, not removed.' };

    const changed = DETAIL_FIELDS.filter((k) => want[k] !== now[k]);
    const pending = await tx.affiliateChangeRequest.findFirst({ where: { affiliateId: a.id, status: 'PENDING' }, select: { id: true } });
    if (!changed.length) {
      if (!pending) throw { statusCode: 400, message: 'Nothing has changed.' };
      await tx.affiliateChangeRequest.update({ where: { id: pending.id }, data: { status: 'WITHDRAWN', decidedAt: new Date() } });
      return null;
    }
    const changes = Object.fromEntries(changed.map((k) => [k, want[k]]));
    const previous = Object.fromEntries(changed.map((k) => [k, now[k]]));
    if (pending) await tx.affiliateChangeRequest.update({ where: { id: pending.id }, data: { changes, previous } });
    else await tx.affiliateChangeRequest.create({ data: { affiliateId: a.id, changes, previous } });
    return { a, changed, changes, previous, replaced: !!pending };
  });
  if (!result) return;
  const { a, changed, changes, previous, replaced } = result;
  const lines = changed.map((k) => `${LABEL[k]}: ${shown(k, previous[k] as string | null)} → ${shown(k, changes[k] as string | null)}`);
  void notifyAffiliateTeam(
    fastify,
    `✏️ *Affiliate details change${replaced ? ' (sent again, replaces the last one)' : ''}*\n${a.fullName} (${a.discountCode.code})\n${lines.join('\n')}\n\nApprove or reject in Admin → Affiliates → Changes.`
  );
}

export async function withdrawChange(fastify: FastifyInstance, memberId: string): Promise<void> {
  const a = await fastify.prisma.affiliate.findUnique({ where: { memberId }, select: { id: true } });
  if (!a) throw { statusCode: 404, message: 'You have not joined yet.' };
  const { count } = await fastify.prisma.affiliateChangeRequest.updateMany({
    where: { affiliateId: a.id, status: 'PENDING' },
    data: { status: 'WITHDRAWN', decidedAt: new Date() },
  });
  if (!count) throw { statusCode: 400, message: 'There is no change waiting.' };
}

// ── The team's side ─────────────────────────────────────────────────────────

export async function adminListChanges(fastify: FastifyInstance, query: Record<string, string>) {
  const status = (['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'].includes(query.status) ? query.status : 'PENDING') as 'PENDING';
  const rows = await fastify.prisma.affiliateChangeRequest.findMany({
    where: { status, ...(query.affiliateId ? { affiliateId: query.affiliateId } : {}) },
    orderBy: { updatedAt: status === 'PENDING' ? 'asc' : 'desc' },
    take: 200,
    select: { ...VIEW, affiliateId: true, affiliate: { select: { fullName: true, status: true, discountCode: { select: { code: true } } } } },
  });
  return {
    changes: rows.map(({ affiliate, affiliateId, ...r }) => ({
      ...view(r),
      affiliateId,
      name: affiliate.fullName,
      code: affiliate.discountCode.code,
      affiliateStatus: affiliate.status,
    })),
  };
}

const decideSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('approve') }),
  z.object({ decision: z.literal('reject'), reason: z.string().trim().min(2, 'Say why — they will see it.').max(300) }),
]);

/**
 * Approve: the details become theirs, and a payout still waiting is sent to
 * the new account (the team transfers by hand, after this). Reject: nothing
 * moves; they see the reason.
 */
export async function adminDecideChange(fastify: FastifyInstance, id: string, body: unknown, actor: string) {
  const d = decideSchema.parse(body);
  const decided = await fastify.prisma.$transaction(async (tx) => {
    const r = await tx.affiliateChangeRequest.findUnique({ where: { id }, select: { affiliateId: true, status: true, changes: true } });
    if (!r) throw { statusCode: 404, message: 'Change request not found.' };
    await tx.$queryRaw`SELECT id FROM affiliates WHERE id = ${r.affiliateId} FOR UPDATE`;
    // Claimed from PENDING only: a second click, or a replacement sent in
    // between, never applies twice or applies the wrong one.
    const { count } = await tx.affiliateChangeRequest.updateMany({
      where: { id, status: 'PENDING', changes: { equals: r.changes as Prisma.InputJsonValue } },
      data: d.decision === 'approve'
        ? { status: 'APPROVED', decidedAt: new Date(), decidedBy: actor }
        : { status: 'REJECTED', decidedAt: new Date(), decidedBy: actor, rejectReason: d.reason },
    });
    if (!count) throw { statusCode: 409, message: r.status === 'PENDING' ? 'They changed it again just now — reload to see the latest.' : `This request is already ${r.status.toLowerCase()}.` };
    const fields = DETAIL_FIELDS.filter((k) => k in (r.changes as object)).map((k) => LABEL[k]);
    if (d.decision === 'reject') return { affiliateId: r.affiliateId, fields };

    const changes = r.changes as Partial<Details>;
    // Checked when sent (desired()): name and WhatsApp are never null here.
    const updated = await tx.affiliate.update({ where: { id: r.affiliateId }, data: changes as Prisma.AffiliateUncheckedUpdateInput });
    if (BANK_FIELDS.some((k) => k in changes)) {
      await tx.affiliatePayout.updateMany({
        where: { affiliateId: r.affiliateId, status: 'REQUESTED' },
        data: { bankName: updated.bankName!, bankAccountName: updated.bankAccountName!, bankAccountNumber: updated.bankAccountNumber! },
      });
    }
    return { affiliateId: r.affiliateId, fields };
  });
  await mailAffiliate(
    fastify,
    decided.affiliateId,
    d.decision === 'approve' ? { kind: 'changeApproved', fields: decided.fields } : { kind: 'changeRejected', fields: decided.fields, reason: d.reason }
  );
  return { ok: true };
}
