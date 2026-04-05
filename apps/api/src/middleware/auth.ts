import { FastifyRequest, FastifyReply } from 'fastify';

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    request.log.warn({ err, url: request.url }, 'Auth failed');
    reply.code(401).send({ error: 'Unauthorized' });
  }
}

export async function requireDriver(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
    const payload = request.user as { role: string };
    if (payload.role !== 'driver') {
      request.log.warn(
        { role: payload.role, url: request.url },
        'Non-driver attempted driver route',
      );
      reply.code(403).send({ error: 'Drivers only' });
    }
  } catch (err) {
    request.log.warn({ err, url: request.url }, 'Auth failed');
    reply.code(401).send({ error: 'Unauthorized' });
  }
}

export async function requireRider(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
    const payload = request.user as { role: string };
    if (payload.role !== 'rider') {
      request.log.warn({ role: payload.role, url: request.url }, 'Non-rider attempted rider route');
      reply.code(403).send({ error: 'Riders only' });
    }
  } catch (err) {
    request.log.warn({ err, url: request.url }, 'Auth failed');
    reply.code(401).send({ error: 'Unauthorized' });
  }
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
    const payload = request.user as { role: string };
    if (payload.role !== 'admin') {
      request.log.warn({ role: payload.role, url: request.url }, 'Non-admin attempted admin route');
      reply.code(403).send({ error: 'Admins only' });
    }
  } catch (err) {
    request.log.warn({ err, url: request.url }, 'Auth failed');
    reply.code(401).send({ error: 'Unauthorized' });
  }
}

export async function requireSuperAdmin(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
    const payload = request.user as { role: string; adminRole?: string };
    if (payload.role !== 'admin' || payload.adminRole !== 'super_admin') {
      request.log.warn(
        { role: payload.role, url: request.url },
        'Non-super-admin attempted super_admin route',
      );
      reply.code(403).send({ error: 'Super admins only' });
    }
  } catch (err) {
    request.log.warn({ err, url: request.url }, 'Auth failed');
    reply.code(401).send({ error: 'Unauthorized' });
  }
}

/** Require platform_admin role — cross-company access */
export async function requirePlatformAdmin(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
    const payload = request.user as { role: string; adminRole?: string };
    if (payload.role !== 'admin' || payload.adminRole !== 'platform_admin') {
      request.log.warn(
        { role: payload.role, url: request.url },
        'Non-platform-admin attempted platform route',
      );
      reply.code(403).send({ error: 'Platform admins only' });
    }
  } catch (err) {
    request.log.warn({ err, url: request.url }, 'Auth failed');
    reply.code(401).send({ error: 'Unauthorized' });
  }
}

/**
 * Extract companyId from JWT and attach to request.
 * For platform_admin, companyId is optional — they can pass X-Company-Id header to scope requests.
 * For company_admin/dispatcher/viewer, companyId is required in the JWT.
 * Drivers and riders always have companyId in their JWT.
 */
export function getCompanyId(request: FastifyRequest): string | null {
  const user = request.user as { companyId?: string; adminRole?: string };
  if (user.companyId) return user.companyId;
  // Platform admins can scope requests via X-Company-Id header
  if (user.adminRole === 'platform_admin') {
    const headerCompanyId = request.headers['x-company-id'] as string | undefined;
    if (headerCompanyId) return headerCompanyId;
  }
  return null;
}

/**
 * Require companyId to be present (from JWT or X-Company-Id header for platform_admin).
 */
export async function requireCompanyScope(request: FastifyRequest, reply: FastifyReply) {
  const companyId = getCompanyId(request);
  if (!companyId) {
    reply
      .code(403)
      .send({ error: 'Company scope required. Platform admins must send X-Company-Id header.' });
  }
}
