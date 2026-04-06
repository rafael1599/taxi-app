import { db, schema } from '@drivly/db';
import { eq } from 'drizzle-orm';

export async function listCompanies() {
  return db.query.companies.findMany({
    orderBy: (c, { desc }) => [desc(c.createdAt)],
  });
}

export async function getCompanyById(id: string) {
  return db.query.companies.findFirst({
    where: eq(schema.companies.id, id),
  });
}

export async function getCompanyBySlug(slug: string) {
  return db.query.companies.findFirst({
    where: eq(schema.companies.slug, slug),
  });
}

export async function createCompany(data: {
  name: string;
  slug: string;
  logo?: string | null;
  whatsappJid?: string | null;
  isActive?: boolean;
  settings?: Record<string, unknown>;
}) {
  const [company] = await db
    .insert(schema.companies)
    .values({
      name: data.name,
      slug: data.slug,
      logo: data.logo ?? null,
      whatsappJid: data.whatsappJid ?? null,
      isActive: data.isActive ?? true,
      settings: data.settings ?? {},
    })
    .returning();
  return company;
}

export async function updateCompany(
  id: string,
  data: Partial<{
    name: string;
    slug: string;
    logo: string | null;
    whatsappJid: string | null;
    isActive: boolean;
    settings: Record<string, unknown>;
  }>,
) {
  const [updated] = await db
    .update(schema.companies)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(schema.companies.id, id))
    .returning();
  return updated;
}

export async function deleteCompany(id: string) {
  const [deleted] = await db
    .delete(schema.companies)
    .where(eq(schema.companies.id, id))
    .returning({ id: schema.companies.id });
  return deleted;
}
