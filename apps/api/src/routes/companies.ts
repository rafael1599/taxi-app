import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePlatformAdmin } from '../middleware/auth.js';
import {
  listCompanies,
  getCompanyById,
  createCompany,
  updateCompany,
  deleteCompany,
  getCompanyBySlug,
} from '../services/company.js';

const createCompanySchema = z.object({
  name: z.string().min(2),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  logo: z.string().url().nullable().optional(),
  whatsappJid: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  settings: z.record(z.unknown()).optional(),
});

const updateCompanySchema = z.object({
  name: z.string().min(2).optional(),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  logo: z.string().url().nullable().optional(),
  whatsappJid: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  settings: z.record(z.unknown()).optional(),
});

export async function companyRoutes(app: FastifyInstance) {
  // GET /companies — list all companies (platform_admin only)
  app.get('/companies', { preHandler: requirePlatformAdmin }, async () => {
    return listCompanies();
  });

  // GET /companies/:id — get a single company
  app.get('/companies/:id', { preHandler: requirePlatformAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const company = await getCompanyById(id);
    if (!company) return reply.code(404).send({ error: 'Company not found' });
    return company;
  });

  // POST /companies — create a new company
  app.post('/companies', { preHandler: requirePlatformAdmin }, async (request, reply) => {
    const body = createCompanySchema.parse(request.body);

    // Check slug uniqueness
    const existing = await getCompanyBySlug(body.slug);
    if (existing) {
      return reply.code(409).send({ error: 'Slug already in use' });
    }

    const company = await createCompany(body);
    return reply.code(201).send(company);
  });

  // PATCH /companies/:id — update a company
  app.patch('/companies/:id', { preHandler: requirePlatformAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = updateCompanySchema.parse(request.body);

    // If slug is being changed, check uniqueness
    if (body.slug) {
      const existing = await getCompanyBySlug(body.slug);
      if (existing && existing.id !== id) {
        return reply.code(409).send({ error: 'Slug already in use' });
      }
    }

    const updated = await updateCompany(id, body);
    if (!updated) return reply.code(404).send({ error: 'Company not found' });
    return updated;
  });

  // DELETE /companies/:id — delete a company
  app.delete('/companies/:id', { preHandler: requirePlatformAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = await deleteCompany(id);
    if (!deleted) return reply.code(404).send({ error: 'Company not found' });
    return { ok: true };
  });
}
