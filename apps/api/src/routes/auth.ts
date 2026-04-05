import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '@rockland-taxi/db';
import { eq } from 'drizzle-orm';
import { JWT_EXPIRY_SEC } from '@rockland-taxi/shared';

const driverLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const riderLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const driverRegisterSchema = z.object({
  fullName: z.string().min(2),
  phone: z.string().min(10),
  email: z.string().email(),
  password: z.string().min(8),
  licenseNumber: z.string().min(4),
  tlcLicense: z.string().optional(),
  companyId: z.string().uuid(),
});

const riderRegisterSchema = z.object({
  fullName: z.string().min(2),
  phone: z.string().min(10),
  email: z.string().email(),
  password: z.string().min(8),
  companyId: z.string().uuid(),
});

export async function authRoutes(app: FastifyInstance) {
  // Driver register
  app.post('/auth/driver/register', async (request, reply) => {
    const body = driverRegisterSchema.parse(request.body);
    const hash = await hashPassword(body.password);

    const [driver] = await db
      .insert(schema.drivers)
      .values({
        companyId: body.companyId,
        fullName: body.fullName,
        phone: body.phone,
        email: body.email,
        passwordHash: hash,
        licenseNumber: body.licenseNumber,
        tlcLicense: body.tlcLicense ?? null,
      })
      .returning({ id: schema.drivers.id, companyId: schema.drivers.companyId });

    const token = app.jwt.sign(
      { sub: driver.id, role: 'driver', companyId: driver.companyId },
      { expiresIn: JWT_EXPIRY_SEC },
    );
    return reply.code(201).send({ token, driverId: driver.id });
  });

  // Driver login
  app.post('/auth/driver/login', async (request, reply) => {
    const body = driverLoginSchema.parse(request.body);

    const driver = await db.query.drivers.findFirst({
      where: eq(schema.drivers.email, body.email),
    });
    if (!driver || !(await verifyPassword(body.password, driver.passwordHash))) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const token = app.jwt.sign(
      { sub: driver.id, role: 'driver', companyId: driver.companyId },
      { expiresIn: JWT_EXPIRY_SEC },
    );
    return { token, driverId: driver.id };
  });

  // Rider register
  app.post('/auth/rider/register', async (request, reply) => {
    const body = riderRegisterSchema.parse(request.body);
    const hash = await hashPassword(body.password);

    const [rider] = await db
      .insert(schema.riders)
      .values({
        companyId: body.companyId,
        fullName: body.fullName,
        phone: body.phone,
        email: body.email,
      })
      .returning({ id: schema.riders.id, companyId: schema.riders.companyId });

    await db.insert(schema.ridersAuth).values({
      riderId: rider.id,
      passwordHash: hash,
    });

    const token = app.jwt.sign(
      { sub: rider.id, role: 'rider', companyId: rider.companyId },
      { expiresIn: JWT_EXPIRY_SEC },
    );
    return reply.code(201).send({ token, riderId: rider.id });
  });

  // Rider login
  app.post('/auth/rider/login', async (request, reply) => {
    const body = riderLoginSchema.parse(request.body);

    const rider = await db.query.riders.findFirst({
      where: eq(schema.riders.email, body.email),
    });
    if (!rider) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const auth = await db.query.ridersAuth.findFirst({
      where: eq(schema.ridersAuth.riderId, rider.id),
    });
    if (!auth || !(await verifyPassword(body.password, auth.passwordHash))) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const token = app.jwt.sign(
      { sub: rider.id, role: 'rider', companyId: rider.companyId },
      { expiresIn: JWT_EXPIRY_SEC },
    );
    return { token, riderId: rider.id };
  });
}

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + process.env.JWT_SECRET);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Buffer.from(hash).toString('hex');
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const computed = await hashPassword(password);
  return computed === hash;
}
