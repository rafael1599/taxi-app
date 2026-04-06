import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '@drivly/db';
import { eq, count } from 'drizzle-orm';
import { JWT_EXPIRY_SEC } from '@drivly/shared';
import bcrypt from 'bcryptjs';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const registerSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['super_admin', 'dispatcher', 'viewer']).default('viewer'),
  companyId: z.string().uuid().optional(),
});

const authRateLimit = {
  config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
};

export async function adminAuthRoutes(app: FastifyInstance) {
  // POST /auth/admin/setup — create first admin (no auth required, guarded by existing admin count)
  app.post('/auth/admin/setup', { ...authRateLimit }, async (request, reply) => {
    const [result] = await db.select({ count: count() }).from(schema.admins);
    if (result.count > 0) {
      return reply.code(409).send({ error: 'Admin already initialized. Use /auth/admin/login.' });
    }
    const body = registerSchema.parse(request.body);
    const hash = await hashPassword(body.password);

    // First admin is always platform_admin (no company scope)
    const [admin] = await db
      .insert(schema.admins)
      .values({
        fullName: body.fullName,
        email: body.email,
        passwordHash: hash,
        role: 'platform_admin',
        companyId: null,
      })
      .returning({ id: schema.admins.id, role: schema.admins.role });

    const token = app.jwt.sign(
      { sub: admin.id, role: 'admin', adminRole: 'platform_admin' },
      { expiresIn: JWT_EXPIRY_SEC },
    );
    return reply.code(201).send({ token, adminId: admin.id });
  });

  // POST /auth/admin/login
  app.post('/auth/admin/login', { ...authRateLimit }, async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const admin = await db.query.admins.findFirst({ where: eq(schema.admins.email, body.email) });
    if (!admin || !(await verifyPassword(body.password, admin.passwordHash))) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }
    if (!admin.isActive) return reply.code(403).send({ error: 'Account disabled' });

    // Migrate legacy SHA-256 hash to bcrypt on successful login
    if (isSha256Hash(admin.passwordHash)) {
      const newHash = await hashPassword(body.password);
      await db
        .update(schema.admins)
        .set({ passwordHash: newHash })
        .where(eq(schema.admins.id, admin.id));
    }

    const payload: Record<string, unknown> = {
      sub: admin.id,
      role: 'admin',
      adminRole: admin.role,
    };
    // Include companyId for company-scoped admins
    if (admin.companyId) {
      payload.companyId = admin.companyId;
    }

    const token = app.jwt.sign(payload, { expiresIn: JWT_EXPIRY_SEC });
    return {
      token,
      adminId: admin.id,
      adminRole: admin.role,
      fullName: admin.fullName,
      companyId: admin.companyId ?? undefined,
    };
  });
}

const BCRYPT_ROUNDS = 12;

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

function isSha256Hash(hash: string): boolean {
  return /^[a-f0-9]{64}$/.test(hash);
}

async function legacySha256(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + process.env.JWT_SECRET);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Buffer.from(digest).toString('hex');
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (isSha256Hash(storedHash)) {
    return (await legacySha256(password)) === storedHash;
  }
  return bcrypt.compare(password, storedHash);
}
