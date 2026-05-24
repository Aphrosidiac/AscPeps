import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function login(fastify: FastifyInstance, body: unknown) {
  const { email, password } = loginSchema.parse(body);

  const admin = await fastify.prisma.adminUser.findUnique({ where: { email } });
  if (!admin) {
    throw { statusCode: 401, message: 'Invalid email or password' };
  }

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) {
    throw { statusCode: 401, message: 'Invalid email or password' };
  }

  const token = fastify.jwt.sign({ id: admin.id, email: admin.email });
  return { token, user: { id: admin.id, email: admin.email, name: admin.name } };
}

export async function getMe(fastify: FastifyInstance, userId: string) {
  const admin = await fastify.prisma.adminUser.findUnique({ where: { id: userId } });
  if (!admin) {
    throw { statusCode: 404, message: 'User not found' };
  }
  return { id: admin.id, email: admin.email, name: admin.name };
}
