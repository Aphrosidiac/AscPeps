import type { FastifyInstance } from 'fastify';
import type { BlockKind } from '@prisma/client';
import { z } from 'zod';
import { mailbox } from '../../utils/affiliate.js';
import { banMembersOf, forgetNetworks, keyFromInput, keysFor, type Key } from '../../utils/blocklist.js';

/**
 * Admin side of the customer blocklist (see utils/blocklist.ts for how the
 * store enforces it and learns new identifiers on its own).
 */

const entryInclude = {
  entries: { orderBy: [{ kind: 'asc' as const }, { createdAt: 'asc' as const }] },
  attempts: { orderBy: { createdAt: 'desc' as const }, take: 15 },
};

export async function adminListBlocked(fastify: FastifyInstance) {
  return fastify.prisma.blockedCustomer.findMany({
    orderBy: [{ lastHitAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    include: { ...entryInclude, _count: { select: { attempts: true } } },
  });
}

/** Add keys to a person; a key already on someone else's list is reported, not moved. */
async function addKeys(fastify: FastifyInstance, blockedCustomerId: string, keys: Key[]) {
  const taken: string[] = [];
  for (const k of keys) {
    const existing = await fastify.prisma.blockEntry.findUnique({ where: { kind_value: { kind: k.kind, value: k.value } } });
    if (existing) {
      if (existing.blockedCustomerId === blockedCustomerId) {
        // Typed in by the team now: permanent, whatever it was before.
        await fastify.prisma.blockEntry.update({ where: { id: existing.id }, data: { auto: false, expiresAt: null } });
      } else {
        taken.push(k.display);
      }
      continue;
    }
    await fastify.prisma.blockEntry.create({
      data: { blockedCustomerId, kind: k.kind, value: k.value, display: k.display, auto: false },
    });
  }
  forgetNetworks();
  const banned = await banMembersOf(fastify.prisma, blockedCustomerId);
  return { taken, banned };
}

const list = z.array(z.string().trim().min(1).max(300)).max(50).default([]);
const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  reason: z.string().trim().max(500).optional().nullable(),
  emails: list,
  phones: list,
  addresses: list,
  networks: list,
});

function parseKeys(input: { emails: string[]; phones: string[]; addresses: string[]; networks: string[] }) {
  const keys: Key[] = [];
  const invalid: string[] = [];
  const add = (kind: BlockKind, values: string[]) => {
    for (const v of values) {
      const k = keyFromInput(kind, v);
      if (k) keys.push(k);
      else invalid.push(v);
    }
  };
  add('EMAIL', input.emails);
  add('PHONE', input.phones);
  add('ADDRESS', input.addresses);
  add('NETWORK', input.networks);
  if (invalid.length) {
    throw {
      statusCode: 400,
      message: `Couldn't read: ${invalid.join(', ')}. Addresses need the 5-digit postcode at the end; networks are an IP address.`,
    };
  }
  return keys;
}

export async function adminCreateBlocked(fastify: FastifyInstance, body: unknown, actor: string | null) {
  const data = createSchema.parse(body);
  const keys = parseKeys(data);
  if (keys.length === 0) throw { statusCode: 400, message: 'Add at least one email, phone, address or IP.' };
  const person = await fastify.prisma.blockedCustomer.create({
    data: { name: data.name, reason: data.reason || null, createdBy: actor },
  });
  const result = await addKeys(fastify, person.id, keys);
  return { id: person.id, ...result };
}

const reasonSchema = z.object({ reason: z.string().trim().max(500).optional().nullable() });

/**
 * Block a member and everything we know about them: the account's email, and
 * the phone, delivery address and email of every order placed with that inbox.
 */
export async function adminBlockMember(fastify: FastifyInstance, memberId: string, body: unknown, actor: string | null) {
  const { reason } = reasonSchema.parse(body ?? {});
  const member = await fastify.prisma.member.findUnique({ where: { id: memberId }, select: { email: true, displayName: true } });
  if (!member) throw { statusCode: 404, message: 'Member not found' };

  const inbox = mailbox(member.email);
  const orders = (
    await fastify.prisma.order.findMany({
      where: { email: { not: null }, isTest: false },
      select: { email: true, phone: true, address: true, postcode: true },
    })
  ).filter((o) => mailbox(o.email!) === inbox);

  const keys = [
    ...keysFor({ email: member.email }),
    ...orders.flatMap((o) => keysFor({ email: o.email, phone: o.phone, address: { address: o.address, postcode: o.postcode } })),
  ];
  const unique = [...new Map(keys.map((k) => [`${k.kind}|${k.value}`, k])).values()];

  // Already on someone's list: add to that person rather than starting a second.
  const existing = await fastify.prisma.blockEntry.findFirst({
    where: { kind: 'EMAIL', value: inbox },
    select: { blockedCustomerId: true },
  });
  const personId =
    existing?.blockedCustomerId ??
    (await fastify.prisma.blockedCustomer.create({ data: { name: member.displayName, reason: reason || null, createdBy: actor } })).id;

  const result = await addKeys(fastify, personId, unique);
  // The member's own account, even if the inbox fold somehow missed it.
  await fastify.prisma.member.update({ where: { id: memberId }, data: { banned: true } });
  return { id: personId, ...result, added: unique.length };
}

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  reason: z.string().trim().max(500).optional().nullable(),
});

export async function adminUpdateBlocked(fastify: FastifyInstance, id: string, body: unknown) {
  const data = updateSchema.parse(body);
  return fastify.prisma.blockedCustomer.update({ where: { id }, data: { ...data, reason: data.reason === undefined ? undefined : data.reason || null } });
}

const addSchema = z.object({ kind: z.enum(['EMAIL', 'PHONE', 'ADDRESS', 'NETWORK']), value: z.string().trim().min(1).max(300) });

export async function adminAddBlockEntry(fastify: FastifyInstance, id: string, body: unknown) {
  const { kind, value } = addSchema.parse(body);
  const person = await fastify.prisma.blockedCustomer.findUnique({ where: { id }, select: { id: true } });
  if (!person) throw { statusCode: 404, message: 'Not found' };
  const [key] = parseKeys({
    emails: kind === 'EMAIL' ? [value] : [],
    phones: kind === 'PHONE' ? [value] : [],
    addresses: kind === 'ADDRESS' ? [value] : [],
    networks: kind === 'NETWORK' ? [value] : [],
  });
  const result = await addKeys(fastify, id, [key]);
  if (result.taken.length) throw { statusCode: 409, message: `${value} is already on another person's list.` };
  return result;
}

export async function adminRemoveBlockEntry(fastify: FastifyInstance, entryId: string) {
  await fastify.prisma.blockEntry.delete({ where: { id: entryId } });
  forgetNetworks();
  return { ok: true };
}

/**
 * Unblock: the person and every identifier go, and the member accounts on
 * their email list are un-banned. (Learnt entries go too — they were only
 * ever this person's.)
 */
export async function adminDeleteBlocked(fastify: FastifyInstance, id: string) {
  const emails = await fastify.prisma.blockEntry.findMany({ where: { blockedCustomerId: id, kind: 'EMAIL' }, select: { value: true } });
  const wanted = new Set(emails.map((e) => e.value));
  const members = await fastify.prisma.member.findMany({ where: { banned: true }, select: { id: true, email: true } });
  const ids = members.filter((m) => wanted.has(mailbox(m.email))).map((m) => m.id);
  await fastify.prisma.$transaction([
    fastify.prisma.member.updateMany({ where: { id: { in: ids } }, data: { banned: false } }),
    fastify.prisma.blockedCustomer.delete({ where: { id } }),
  ]);
  forgetNetworks();
  return { ok: true, unbanned: ids.length };
}
