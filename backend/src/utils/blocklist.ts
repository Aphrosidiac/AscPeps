import net from 'node:net';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { BlockKind, PrismaClient } from '@prisma/client';
import { mailbox, subscriber } from './affiliate.js';

/**
 * The customer blocklist (schema: BlockedCustomer / BlockEntry / BlockAttempt).
 *
 * Two layers:
 *
 *  1. `screen()` runs inside the routes where someone hands us who they are —
 *     checkout, sign-up, login, newsletter, Group Buy sign-up, affiliate join.
 *     It checks the email, phone, address AND the network the request came
 *     from. One hit refuses the request and LEARNS everything else in it: a
 *     new email typed from a blocked network, or a known phone from a new
 *     network, joins the same person's list.
 *
 *  2. The onRequest hook (registerBlocklistHook) refuses every other public
 *     API call from a blocked network. Pages still load (they're rendered on
 *     our side), but nothing a blocked visitor does from that network works.
 *
 * Nginx is deliberately NOT the enforcement point for networks: a request
 * stopped there never reaches the app, so the new email or phone in it would
 * never be learnt.
 *
 * Failures here fail OPEN (logged): a blocklist bug must never take checkout
 * down for everyone else.
 */

/** What a refused visitor reads. Says nothing about why. */
export const REFUSAL = "Sorry, we can't accept this request.";

// Learnt networks are reassigned (mobile carriers rotate prefixes, CGNAT
// shares IPv4s), so they lapse unless the person keeps turning up on them.
const LEARNT_NETWORK_DAYS = 60;
const learntNetworkExpiry = () => new Date(Date.now() + LEARNT_NETWORK_DAYS * 24 * 60 * 60 * 1000);

// ── Keys ────────────────────────────────────────────────────────────────────

function expandIpv6(addr: string): string[] | null {
  let a = addr;
  // Embedded IPv4 tail (::ffff:1.2.3.4 style) → two hex groups.
  const v4 = a.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const p = v4[1].split('.').map(Number);
    a = a.slice(0, -v4[1].length) + `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const [head, tail] = a.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : [];
  const fill = a.includes('::') ? 8 - h.length - t.length : 0;
  if (fill < 0) return null;
  const groups = [...h, ...Array(fill).fill('0'), ...t];
  return groups.length === 8 ? groups : null;
}

/**
 * The network an address belongs to: the /64 for IPv6 (one home or phone
 * connection; the rest of the address rotates by itself), the address itself
 * for IPv4. Also accepts "addr/len" — the length is ignored on purpose, so a
 * pasted range can never block more than one connection.
 */
export function networkOf(raw: string): string | null {
  let a = raw.trim().split('/')[0].replace(/^\[|\]$/g, '');
  if (a.toLowerCase().startsWith('::ffff:') && net.isIPv4(a.slice(7))) a = a.slice(7);
  if (net.isIPv4(a)) return `${a}/32`;
  if (!net.isIPv6(a)) return null;
  const groups = expandIpv6(a.toLowerCase());
  if (!groups) return null;
  return `${groups
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(':')}::/64`;
}

/** How a network reads in the admin: an IPv4 as itself, an IPv6 as its /64. */
export function networkLabel(network: string): string {
  return network.endsWith('/32') ? network.slice(0, -3) : network;
}

export function addressKey(address: string, postcode: string): string {
  const letters = address.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${letters}|${postcode.replace(/\D/g, '')}`;
}

export type Key = { kind: BlockKind; value: string; display: string };

export type Identity = {
  email?: string | null;
  phone?: string | null;
  address?: { address: string; postcode: string } | null;
};

/**
 * The identity fields of a raw (not yet validated) request body. Screening
 * runs before the route's own parsing, so a request refused here never gets
 * as far as writing anything.
 */
export function identityFrom(body: unknown): Identity {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  const address = str(b.address);
  const postcode = str(b.postcode);
  return { email: str(b.email), phone: str(b.phone), address: address && postcode ? { address, postcode } : null };
}

/** The matching keys for what a visitor gave us, plus where they came from. */
export function keysFor(who: Identity, ip?: string | null): Key[] {
  const keys: Key[] = [];
  if (who.email?.includes('@')) keys.push({ kind: 'EMAIL', value: mailbox(who.email), display: who.email.trim().toLowerCase() });
  if (who.phone) {
    const value = subscriber(who.phone);
    if (value.length >= 7) keys.push({ kind: 'PHONE', value, display: who.phone.trim() });
  }
  if (who.address?.address && who.address.postcode) {
    keys.push({
      kind: 'ADDRESS',
      value: addressKey(who.address.address, who.address.postcode),
      display: `${who.address.address.trim()}, ${who.address.postcode.trim()}`,
    });
  }
  const network = ip ? networkOf(ip) : null;
  if (network) keys.push({ kind: 'NETWORK', value: network, display: networkLabel(network) });
  return keys;
}

/** For the admin form: one typed value of a given kind → its key. */
export function keyFromInput(kind: BlockKind, raw: string): Key | null {
  const v = raw.trim();
  if (!v) return null;
  if (kind === 'EMAIL') return v.includes('@') ? { kind, value: mailbox(v), display: v.toLowerCase() } : null;
  if (kind === 'PHONE') {
    const value = subscriber(v);
    return value.length >= 7 ? { kind, value, display: v } : null;
  }
  if (kind === 'NETWORK') {
    const value = networkOf(v);
    return value ? { kind, value, display: networkLabel(value) } : null;
  }
  // ADDRESS: "street..., postcode" — the postcode is the last 5-digit run.
  const m = v.match(/^(.*?)[,\s]+(\d{5})\s*$/s);
  return m ? { kind, value: addressKey(m[1], m[2]), display: v } : null;
}

const active = (e: { expiresAt: Date | null }) => !e.expiresAt || e.expiresAt > new Date();

// ── Network cache (for the hook, which runs on every API call) ──────────────

let networks: Map<string, string> | null = null; // value → blockedCustomerId
let networksLoadedAt = 0;
const NETWORK_CACHE_MS = 30_000;

export function forgetNetworks() {
  networks = null;
}

async function blockedNetwork(prisma: PrismaClient, ip: string): Promise<string | null> {
  const key = networkOf(ip);
  if (!key) return null;
  if (!networks || Date.now() - networksLoadedAt > NETWORK_CACHE_MS) {
    const rows = await prisma.blockEntry.findMany({
      where: { kind: 'NETWORK', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      select: { value: true, blockedCustomerId: true },
    });
    networks = new Map(rows.map((r) => [r.value, r.blockedCustomerId]));
    networksLoadedAt = Date.now();
  }
  return networks.get(key) ?? null;
}

// ── Bans ────────────────────────────────────────────────────────────────────

/** Ban every member account whose email is on this person's list. */
export async function banMembersOf(prisma: PrismaClient, blockedCustomerId: string): Promise<number> {
  const emails = await prisma.blockEntry.findMany({
    where: { blockedCustomerId, kind: 'EMAIL' },
    select: { value: true },
  });
  if (emails.length === 0) return 0;
  const wanted = new Set(emails.map((e) => e.value));
  // Member.email is lowercased but not folded the way mailbox() folds it, so
  // the comparison happens here. The table is small (hundreds of rows).
  const members = await prisma.member.findMany({ where: { banned: false }, select: { id: true, email: true } });
  const ids = members.filter((m) => wanted.has(mailbox(m.email))).map((m) => m.id);
  if (ids.length === 0) return 0;
  const { count } = await prisma.member.updateMany({ where: { id: { in: ids } }, data: { banned: true } });
  return count;
}

// ── Screening ───────────────────────────────────────────────────────────────

const label = (k: { kind: BlockKind; display: string }) => `${k.kind.toLowerCase()}: ${k.display}`;

/**
 * Is the person behind this request blocked? On a hit: learn every new
 * identifier in it, ban their member accounts, log the attempt, and return
 * true — the caller then refuses (or silently drops) the request.
 */
export async function screen(
  fastify: FastifyInstance,
  request: FastifyRequest | null,
  action: string,
  who: Identity
): Promise<boolean> {
  try {
    const ip = request?.ip ?? null;
    const keys = keysFor(who, ip);
    if (keys.length === 0) return false;

    const prisma = fastify.prisma;
    const existing = await prisma.blockEntry.findMany({
      where: { OR: keys.map((k) => ({ kind: k.kind, value: k.value })) },
    });
    const hits = existing.filter(active);
    if (hits.length === 0) return false;

    // The person: whoever the strongest identifier belongs to (a typed-in
    // entry over a learnt one, an email or phone over a network).
    const rank = (e: (typeof hits)[number]) => (e.auto ? 10 : 0) + (e.kind === 'NETWORK' ? 1 : 0);
    const personId = [...hits].sort((a, b) => rank(a) - rank(b))[0].blockedCustomerId;

    const learnt: string[] = [];
    for (const k of keys) {
      const row = existing.find((e) => e.kind === k.kind && e.value === k.value);
      if (!row) {
        await prisma.blockEntry
          .create({
            data: {
              blockedCustomerId: personId,
              kind: k.kind,
              value: k.value,
              display: k.display,
              auto: true,
              expiresAt: k.kind === 'NETWORK' ? learntNetworkExpiry() : null,
            },
          })
          .then(() => learnt.push(label(k)))
          // Lost a race with a parallel request learning the same key: fine.
          .catch(() => {});
      } else if (!active(row)) {
        // A lapsed entry is back in use: it now belongs to whoever this is.
        await prisma.blockEntry.update({
          where: { id: row.id },
          data: { blockedCustomerId: personId, auto: true, expiresAt: k.kind === 'NETWORK' ? learntNetworkExpiry() : null },
        });
        learnt.push(label(k));
      } else if (row.kind === 'NETWORK' && row.auto && row.blockedCustomerId === personId) {
        // Still using it: keep it blocked for another full term.
        await prisma.blockEntry.update({ where: { id: row.id }, data: { expiresAt: learntNetworkExpiry() } });
      }
    }

    const matched = hits.map((h) => label(h));
    await prisma.$transaction([
      prisma.blockAttempt.create({ data: { blockedCustomerId: personId, action, ip, matched, learnt } }),
      prisma.blockedCustomer.update({ where: { id: personId }, data: { hits: { increment: 1 }, lastHitAt: new Date() } }),
    ]);
    if (learnt.some((l) => l.startsWith('email'))) await banMembersOf(prisma, personId);
    if (learnt.some((l) => l.startsWith('network'))) forgetNetworks();

    fastify.log.warn({ blockedCustomerId: personId, action, matched, learnt }, 'blocklist: request refused');
    return true;
  } catch (err) {
    fastify.log.error({ err, action }, 'blocklist: screening failed, request allowed');
    return false;
  }
}

// ── The hook ────────────────────────────────────────────────────────────────

declare module 'fastify' {
  interface FastifyContextConfig {
    /** 'screen' = this route calls screen() itself, with the visitor's details. */
    blocklist?: 'screen';
  }
}

// Not the visitor's own calls: the team's, the gateways', the agent's.
const EXEMPT = /^\/api\/v1\/(admin|internal|webhooks|payments)(\/|$)/;

// One attempt row per network per 10 minutes is plenty; a blocked browser
// fires a dozen calls per page.
const lastLogged = new Map<string, number>();
const LOG_EVERY_MS = 10 * 60 * 1000;

export function registerBlocklistHook(fastify: FastifyInstance) {
  fastify.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/v1/') || EXEMPT.test(request.url)) return;
    if (request.routeOptions.config?.blocklist === 'screen') return;
    let personId: string | null;
    try {
      personId = await blockedNetwork(fastify.prisma, request.ip);
    } catch (err) {
      fastify.log.error({ err }, 'blocklist: network check failed, request allowed');
      return;
    }
    if (!personId) return;

    const net = networkOf(request.ip)!;
    const last = lastLogged.get(net) ?? 0;
    if (Date.now() - last > LOG_EVERY_MS) {
      lastLogged.set(net, Date.now());
      const path = request.url.split('?')[0];
      await fastify.prisma
        .$transaction([
          fastify.prisma.blockAttempt.create({
            data: { blockedCustomerId: personId, action: `${request.method} ${path}`, ip: request.ip, matched: [`network: ${request.ip}`], learnt: [] },
          }),
          fastify.prisma.blockedCustomer.update({ where: { id: personId }, data: { hits: { increment: 1 }, lastHitAt: new Date() } }),
        ])
        .catch((err) => fastify.log.error({ err }, 'blocklist: could not log attempt'));
    }
    return reply.code(403).send({ error: REFUSAL });
  });
}
