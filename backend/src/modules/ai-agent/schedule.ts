import type { FastifyInstance } from 'fastify';

// The assistant's two scheduled jobs — the nightly reflection and the morning
// brief — are switched on in the settings table, not the environment, so an
// admin can turn them on from the Assistant page without a deploy. Each runs
// at most once per Malaysian day, after its hour, tracked by a "last day"
// setting so a restart mid-morning does not send a second brief.

export const SETTING_KEYS = {
  reflect: 'agent_nightly_reflection',
  digest: 'agent_morning_brief',
  digestHour: 'agent_morning_brief_hour',
  reflectHour: 'agent_nightly_reflection_hour',
  orderNotify: 'agent_order_notify',
  reflectLast: 'agent_nightly_reflection_last',
  digestLast: 'agent_morning_brief_last',
} as const;

export async function readSetting(fastify: FastifyInstance, key: string): Promise<string | null> {
  const row = await fastify.prisma.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function writeSetting(fastify: FastifyInstance, key: string, value: string): Promise<void> {
  await fastify.prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export function malaysiaDay(d = new Date()): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24 };
}

// The system's own actor for jobs nobody is sitting behind. Full access: the
// reflection edits memory, and the brief only reads — the prompts say so, and
// the audit trail names this actor on anything either one touches.
export const SYSTEM_ACTOR = { phone: '', name: 'Scheduled job', canWrite: true } as const;
