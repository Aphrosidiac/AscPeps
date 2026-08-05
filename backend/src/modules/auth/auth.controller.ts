import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12, 'New password must be at least 12 characters'),
});

// Precomputed hash of a throwaway value (cost 12, same as real hashes) —
// compared against when the email doesn't exist, so unknown-email and
// wrong-password responses take the same time (no account-enumeration timing).
const DUMMY_HASH = '$2b$12$VrNkdp05BDXELusXONkTreWe31fJHex0cpnFDrJREMb8WiI55d49O';

export async function login(fastify: FastifyInstance, body: unknown) {
  const { email, password } = loginSchema.parse(body);

  const admin = await fastify.prisma.adminUser.findUnique({ where: { email } });
  if (!admin) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw { statusCode: 401, message: 'Invalid email or password' };
  }

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) {
    throw { statusCode: 401, message: 'Invalid email or password' };
  }

  // `kind` separates this from a storefront member token signed with the same
  // secret — see plugins/auth.ts.
  const token = fastify.jwt.sign({ id: admin.id, email: admin.email, kind: 'admin' });
  return { token, user: { id: admin.id, email: admin.email, name: admin.name } };
}

export async function getMe(fastify: FastifyInstance, userId: string) {
  const admin = await fastify.prisma.adminUser.findUnique({ where: { id: userId } });
  if (!admin) {
    throw { statusCode: 404, message: 'User not found' };
  }
  return { id: admin.id, email: admin.email, name: admin.name };
}

export async function changePassword(fastify: FastifyInstance, userId: string, body: unknown) {
  const { currentPassword, newPassword } = changePasswordSchema.parse(body);

  const admin = await fastify.prisma.adminUser.findUnique({ where: { id: userId } });
  if (!admin) {
    throw { statusCode: 404, message: 'User not found' };
  }

  const valid = await bcrypt.compare(currentPassword, admin.passwordHash);
  if (!valid) {
    throw { statusCode: 401, message: 'Current password is incorrect' };
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await fastify.prisma.adminUser.update({
    where: { id: admin.id },
    data: { passwordHash },
  });

  return { success: true };
}
