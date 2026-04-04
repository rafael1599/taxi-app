import { FastifyRequest, FastifyReply } from 'fastify';

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    reply.code(401).send({ error: 'Unauthorized' });
  }
}

export async function requireDriver(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
    const payload = request.user as { role: string };
    if (payload.role !== 'driver') {
      reply.code(403).send({ error: 'Drivers only' });
    }
  } catch {
    reply.code(401).send({ error: 'Unauthorized' });
  }
}

export async function requireRider(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
    const payload = request.user as { role: string };
    if (payload.role !== 'rider') {
      reply.code(403).send({ error: 'Riders only' });
    }
  } catch {
    reply.code(401).send({ error: 'Unauthorized' });
  }
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
    const payload = request.user as { role: string };
    if (payload.role !== 'admin') {
      reply.code(403).send({ error: 'Admins only' });
    }
  } catch {
    reply.code(401).send({ error: 'Unauthorized' });
  }
}

export async function requireSuperAdmin(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
    const payload = request.user as { role: string; adminRole?: string };
    if (payload.role !== 'admin' || payload.adminRole !== 'super_admin') {
      reply.code(403).send({ error: 'Super admins only' });
    }
  } catch {
    reply.code(401).send({ error: 'Unauthorized' });
  }
}
