import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '@drivly/db';
import { eq } from 'drizzle-orm';
import { JWT_EXPIRY_SEC } from '@drivly/shared';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { sendVerificationCode, checkVerificationCode } from '../services/otp.js';

const REFRESH_TOKEN_DAYS = 90;
const REFRESH_TOKEN_MS = REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000;

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

const authRateLimit = {
  config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
};

export async function authRoutes(app: FastifyInstance) {
  // Driver register
  app.post('/auth/driver/register', { ...authRateLimit }, async (request, reply) => {
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

    if (!driver) return reply.code(500).send({ error: 'Failed to create driver' });

    const token = app.jwt.sign(
      { sub: driver.id, role: 'driver', companyId: driver.companyId },
      { expiresIn: JWT_EXPIRY_SEC },
    );
    return reply.code(201).send({ token, driverId: driver.id });
  });

  // Driver login
  app.post('/auth/driver/login', { ...authRateLimit }, async (request, reply) => {
    const body = driverLoginSchema.parse(request.body);

    const driver = await db.query.drivers.findFirst({
      where: eq(schema.drivers.email, body.email),
    });
    if (
      !driver ||
      !driver.passwordHash ||
      !(await verifyPassword(body.password, driver.passwordHash))
    ) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    // Migrate legacy SHA-256 hash to bcrypt on successful login
    if (isSha256Hash(driver.passwordHash)) {
      const newHash = await hashPassword(body.password);
      await db
        .update(schema.drivers)
        .set({ passwordHash: newHash })
        .where(eq(schema.drivers.id, driver.id));
    }

    const token = app.jwt.sign(
      { sub: driver.id, role: 'driver', companyId: driver.companyId },
      { expiresIn: JWT_EXPIRY_SEC },
    );
    return { token, driverId: driver.id };
  });

  // Rider register
  app.post('/auth/rider/register', { ...authRateLimit }, async (request, reply) => {
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

    if (!rider) return reply.code(500).send({ error: 'Failed to create rider' });

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
  app.post('/auth/rider/login', { ...authRateLimit }, async (request, reply) => {
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

    // Migrate legacy SHA-256 hash to bcrypt on successful login
    if (isSha256Hash(auth.passwordHash)) {
      const newHash = await hashPassword(body.password);
      await db
        .update(schema.ridersAuth)
        .set({ passwordHash: newHash })
        .where(eq(schema.ridersAuth.id, auth.id));
    }

    const token = app.jwt.sign(
      { sub: rider.id, role: 'rider', companyId: rider.companyId },
      { expiresIn: JWT_EXPIRY_SEC },
    );
    return { token, riderId: rider.id };
  });

  // ── OTP Verification ──────────────────────────────────────────────────────

  // POST /auth/otp/send — send verification code to phone
  app.post('/auth/otp/send', { ...authRateLimit }, async (request, reply) => {
    const { phone, channel } = z
      .object({
        phone: z.string().min(10),
        channel: z.enum(['sms', 'whatsapp']).optional().default('whatsapp'),
      })
      .parse(request.body);

    const result = await sendVerificationCode(phone, channel);
    if (!result.success) {
      return reply.code(400).send({ error: result.error });
    }
    return { sent: true };
  });

  // POST /auth/otp/verify — check verification code
  app.post('/auth/otp/verify', { ...authRateLimit }, async (request, reply) => {
    const { phone, code } = z
      .object({
        phone: z.string().min(10),
        code: z.string().length(6),
      })
      .parse(request.body);

    const result = await checkVerificationCode(phone, code);
    if (!result.valid) {
      return reply.code(400).send({ error: result.error ?? 'Invalid code' });
    }
    return { verified: true };
  });

  // ── Driver OTP Login (Uber-style) ────────────────────────────────────────

  // POST /auth/driver/otp/send — send OTP to driver's phone
  app.post('/auth/driver/otp/send', { ...authRateLimit }, async (request, reply) => {
    const { phone } = z.object({ phone: z.string().min(10) }).parse(request.body);

    // Verify driver exists with this phone
    const driver = await db.query.drivers.findFirst({
      where: eq(schema.drivers.phone, phone),
    });

    if (!driver || !driver.isActive) {
      // Don't reveal whether driver exists (security)
      return reply.code(200).send({ sent: true });
    }

    const channel = driver.otpChannel ?? 'whatsapp';
    const result = await sendVerificationCode(phone, channel);
    if (!result.success) {
      return reply.code(400).send({ error: result.error });
    }

    return { sent: true };
  });

  // POST /auth/driver/otp/verify — verify OTP → issue JWT + refresh token
  app.post('/auth/driver/otp/verify', { ...authRateLimit }, async (request, reply) => {
    const { phone, code } = z
      .object({
        phone: z.string().min(10),
        code: z.string().length(6),
      })
      .parse(request.body);

    // Verify the OTP code
    const otpResult = await checkVerificationCode(phone, code);
    if (!otpResult.valid) {
      return reply.code(401).send({ error: otpResult.error ?? 'Invalid code' });
    }

    // Find the driver
    const driver = await db.query.drivers.findFirst({
      where: eq(schema.drivers.phone, phone),
    });

    if (!driver || !driver.isActive) {
      return reply.code(401).send({ error: 'Driver not found or inactive' });
    }

    // Generate refresh token (Uber-style persistent session)
    const refreshToken = randomBytes(48).toString('base64url');
    const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_MS);

    // Update driver: mark phone verified, set refresh token, update last login
    await db
      .update(schema.drivers)
      .set({
        phoneVerified: true,
        refreshToken,
        refreshTokenExpiresAt: refreshExpiresAt,
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.drivers.id, driver.id));

    // Issue JWT
    const token = app.jwt.sign(
      { sub: driver.id, role: 'driver', companyId: driver.companyId },
      { expiresIn: JWT_EXPIRY_SEC },
    );

    return {
      token,
      refreshToken,
      refreshExpiresAt: refreshExpiresAt.toISOString(),
      driverId: driver.id,
    };
  });

  // POST /auth/driver/refresh — exchange refresh token for new JWT
  app.post('/auth/driver/refresh', { ...authRateLimit }, async (request, reply) => {
    const { refreshToken } = z.object({ refreshToken: z.string().min(1) }).parse(request.body);

    // Find driver by refresh token
    const driver = await db.query.drivers.findFirst({
      where: eq(schema.drivers.refreshToken, refreshToken),
    });

    if (!driver) {
      return reply.code(401).send({ error: 'Invalid refresh token' });
    }

    // Check expiration
    if (!driver.refreshTokenExpiresAt || driver.refreshTokenExpiresAt < new Date()) {
      // Clear expired token
      await db
        .update(schema.drivers)
        .set({ refreshToken: null, refreshTokenExpiresAt: null })
        .where(eq(schema.drivers.id, driver.id));
      return reply.code(401).send({ error: 'Refresh token expired, please login again' });
    }

    if (!driver.isActive) {
      return reply.code(401).send({ error: 'Driver account is inactive' });
    }

    // Rotate refresh token (issue new one, invalidate old)
    const newRefreshToken = randomBytes(48).toString('base64url');
    const newRefreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_MS);

    await db
      .update(schema.drivers)
      .set({
        refreshToken: newRefreshToken,
        refreshTokenExpiresAt: newRefreshExpiresAt,
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.drivers.id, driver.id));

    // Issue new JWT
    const token = app.jwt.sign(
      { sub: driver.id, role: 'driver', companyId: driver.companyId },
      { expiresIn: JWT_EXPIRY_SEC },
    );

    return {
      token,
      refreshToken: newRefreshToken,
      refreshExpiresAt: newRefreshExpiresAt.toISOString(),
      driverId: driver.id,
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
