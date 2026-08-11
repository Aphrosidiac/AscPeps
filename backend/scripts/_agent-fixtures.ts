import type { PrismaClient } from '@prisma/client';

/**
 * The operator rows the agent suites send as.
 *
 * These used to be assumed to exist. They do on a seeded dev database and they
 * do not on one restored from a production dump — and when they are missing the
 * failure is silent and deeply misleading: an unknown sender is dropped before
 * any tool or LLM call, so the agent simply never runs, and the suite reports
 * "a summary was written: FAIL" as though compaction were broken. That cost an
 * afternoon chasing a bug in working code.
 *
 * So the suites seed what they send as. Idempotent, and only ever touches these
 * two obviously-fake numbers.
 */
export const TEST_WRITER = { phone: '0123456789', name: 'Test Operator', canWrite: true };
export const TEST_READER = { phone: '0199998888', name: 'Test ReadOnly', canWrite: false };

export async function ensureTestOperators(prisma: PrismaClient): Promise<void> {
  for (const op of [TEST_WRITER, TEST_READER]) {
    await prisma.whatsAppOperator.upsert({
      where: { phone: op.phone },
      // Reset canWrite on every run: the privilege-escalation test asserts the
      // read-only operator is still read-only, and a previous failed run that
      // actually escalated it would otherwise make the next run pass.
      update: { canWrite: op.canWrite, active: true },
      create: { phone: op.phone, name: op.name, canWrite: op.canWrite, active: true },
    });
  }
}
