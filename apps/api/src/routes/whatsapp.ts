import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireSuperAdmin } from '../middleware/auth.js';
import {
  startSession,
  stopSession,
  logoutSession,
  getSession,
  getAllSessions,
} from '../services/whatsapp.js';
import { db, schema } from '@drivly/db';
import { eq } from 'drizzle-orm';

const startSessionSchema = z.object({
  companyId: z.string().uuid(),
});

export async function whatsappRoutes(app: FastifyInstance) {
  // POST /whatsapp/sessions — start a WhatsApp session for a company
  app.post('/whatsapp/sessions', { preHandler: requireAdmin }, async (request, reply) => {
    const { companyId } = startSessionSchema.parse(request.body);
    const user = request.user as { companyId?: string; adminRole?: string };

    // Company admins can only manage their own company
    if (user.adminRole !== 'platform_admin' && user.companyId !== companyId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const company = await db.query.companies.findFirst({
      where: eq(schema.companies.id, companyId),
    });
    if (!company) {
      return reply.code(404).send({ error: 'Company not found' });
    }

    const session = await startSession(companyId, company.name);

    return {
      companyId,
      status: session.status,
      hasQr: !!session.qrCode,
    };
  });

  // GET /whatsapp/sessions/:companyId — get session status + QR code
  app.get('/whatsapp/sessions/:companyId', { preHandler: requireAdmin }, async (request, reply) => {
    const { companyId } = request.params as { companyId: string };
    const user = request.user as { companyId?: string; adminRole?: string };

    if (user.adminRole !== 'platform_admin' && user.companyId !== companyId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const session = getSession(companyId);
    if (!session) {
      return { companyId, status: 'disconnected', qrCode: null };
    }

    return {
      companyId,
      companyName: session.companyName,
      status: session.status,
      qrCode: session.qrCode,
      lastError: session.lastError,
    };
  });

  // GET /whatsapp/sessions — list all sessions (platform admin only)
  app.get('/whatsapp/sessions', { preHandler: requireSuperAdmin }, async () => {
    return getAllSessions();
  });

  // DELETE /whatsapp/sessions/:companyId — stop a session
  app.delete(
    '/whatsapp/sessions/:companyId',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { companyId } = request.params as { companyId: string };
      const user = request.user as { companyId?: string; adminRole?: string };

      if (user.adminRole !== 'platform_admin' && user.companyId !== companyId) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      await stopSession(companyId);
      return { success: true };
    },
  );

  // POST /whatsapp/sessions/:companyId/logout — logout and clear session
  app.post(
    '/whatsapp/sessions/:companyId/logout',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { companyId } = request.params as { companyId: string };
      const user = request.user as { companyId?: string; adminRole?: string };

      if (user.adminRole !== 'platform_admin' && user.companyId !== companyId) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      await logoutSession(companyId);
      return { success: true };
    },
  );
}
