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
      request.log.warn({ role: payload.role, url: request.url }, 'Non-driver attempted driver route');
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
      request.log.warn({ role: payload.role, url: request.url }, 'Non-super-admin attempted super_admin route');
      reply.code(403).send({ error: 'Super admins only' });
    }
  } catch (err) {
    request.log.warn({ err, url: request.url }, 'Auth failed');
    reply.code(401).send({ error: 'Unauthorized' });
  }
}
