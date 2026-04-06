import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '@drivly/db';
import { JWT_EXPIRY_SEC } from '@drivly/shared';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

// ── Schemas ──────────────────────────────────────────────────────────────────
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const authRateLimit = {
  config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
};

// ── Routes ───────────────────────────────────────────────────────────────────
export async function adminAuthRoutes(app: FastifyInstance) {
  // POST /auth/admin/setup — DISABLED (admins are migrated from legacy system)
  app.post('/auth/admin/setup', { ...authRateLimit }, async (_request, reply) => {
    return reply.code(410).send({
      error: 'Admin setup is disabled. Admins are managed via migration scripts.',
    });
  });

  // POST /auth/admin/login — authenticate against LOCAL admins table
  app.post('/auth/admin/login', { ...authRateLimit }, async (request, reply) => {
    const body = loginSchema.parse(request.body);

    // Query local admins table (Drizzle ORM)
    const [admin] = await db
      .select()
      .from(schema.admins)
      .where(eq(schema.admins.email, body.email))
      .limit(1);

    if (!admin || !(await bcrypt.compare(body.password, admin.passwordHash))) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }
    if (!admin.isActive) {
      return reply.code(403).send({ error: 'Account disabled' });
    }

    const adminRole = admin.role;

    const payload: Record<string, unknown> = {
      sub: admin.id,
      role: 'admin',
      adminRole,
    };
    if (admin.companyId) {
      payload.companyId = admin.companyId;
    }

    const token = app.jwt.sign(payload, { expiresIn: JWT_EXPIRY_SEC });

    return {
      token,
      adminId: admin.id,
      adminRole,
      fullName: admin.fullName,
      companyId: admin.companyId ?? undefined,
    };
  });
}
