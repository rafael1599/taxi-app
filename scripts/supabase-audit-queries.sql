-- ═══════════════════════════════════════════════════════════════════════════════
-- SUPABASE AUDIT QUERIES — Ejecutar UNO POR UNO en el SQL Editor
-- Basado en schema discovery real (13 tablas confirmadas)
-- ═══════════════════════════════════════════════════════════════════════════════


-- ─── QUERY 1: Users — hashes, roles, actividad ─────────────────────────────
SELECT
  id,
  email,
  role,
  "isActive",
  "companyId",
  "createdAt",
  "updatedAt",
  CASE WHEN password_hash IS NULL THEN 'NULL'
       WHEN password_hash = '' THEN 'EMPTY'
       ELSE 'HAS_HASH' END AS hash_status,
  LENGTH(password_hash) AS hash_length,
  LEFT(password_hash, 7) AS hash_prefix
FROM "User"
ORDER BY "createdAt";


-- ─── QUERY 2: Employees — link a User, hourly_rate nulls ───────────────────
SELECT
  e.id,
  e.full_name,
  e.employee_code,
  e.hourly_rate,
  e."isActive",
  e."userId",
  e."companyId",
  e."createdAt",
  CASE WHEN u.id IS NULL THEN '⚠️ NO USER' ELSE u.email END AS user_email,
  u.role AS user_role
FROM "Employee" e
LEFT JOIN "User" u ON u.id = e."userId"
ORDER BY e.full_name;


-- ─── QUERY 3: Drivers — token status, companyId ────────────────────────────
SELECT
  id,
  name,
  phone,
  plate,
  vehicle,
  "isActive",
  "isOnline",
  "companyId",
  "createdAt",
  CASE WHEN "authToken" IS NULL THEN 'NO TOKEN'
       WHEN "authToken" = '' THEN 'EMPTY'
       ELSE 'HAS_TOKEN' END AS token_status,
  LENGTH("authToken") AS token_length,
  "tokenExpiresAt",
  CASE
    WHEN "tokenExpiresAt" IS NULL THEN 'NO EXPIRY SET'
    WHEN "tokenExpiresAt" < NOW() THEN '❌ EXPIRED'
    ELSE '✅ VALID'
  END AS token_validity
FROM "Driver"
ORDER BY name;


-- ─── QUERY 4: Company — cuántas, qué datos ─────────────────────────────────
SELECT
  id,
  company_name,
  "displayName",
  "logoUrl",
  "createdAt",
  "updatedAt"
FROM "Company";


-- ─── QUERY 5: Trips — conteo por status, timestamps ────────────────────────
SELECT
  status,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE "createdAt" IS NOT NULL) AS has_created,
  COUNT(*) FILTER (WHERE "assignedAt" IS NOT NULL) AS has_assigned,
  COUNT(*) FILTER (WHERE "completedAt" IS NOT NULL) AS has_completed,
  COUNT(*) FILTER (WHERE "driverId" IS NOT NULL) AS has_driver,
  COUNT(*) FILTER (WHERE "clientName" IS NOT NULL) AS has_client_name,
  COUNT(*) FILTER (WHERE "dropoffLat" IS NOT NULL) AS has_dropoff,
  MIN("createdAt") AS oldest,
  MAX("createdAt") AS newest
FROM "Trip"
GROUP BY status
ORDER BY status;


-- ─── QUERY 6: PriceOverride — resumen + createdById ────────────────────────
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE "isActive" = true) AS active,
  COUNT(*) FILTER (WHERE "isActive" = false) AS inactive,
  COUNT(*) FILTER (WHERE note IS NOT NULL AND note != '') AS has_note,
  COUNT(DISTINCT "createdById") AS distinct_creators,
  MIN("createdAt") AS oldest,
  MAX("createdAt") AS newest
FROM "PriceOverride";


-- ─── QUERY 7: TimeEntry — completitud, entries abiertas ────────────────────
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE end_time IS NULL) AS open_entries,
  COUNT(*) FILTER (WHERE "projectId" IS NOT NULL) AS has_project,
  COUNT(*) FILTER (WHERE "locationId" IS NOT NULL) AS has_location,
  COUNT(DISTINCT "employeeId") AS distinct_employees,
  COUNT(DISTINCT "companyId") AS distinct_companies,
  MIN(start_time) AS earliest_shift,
  MAX(end_time) AS latest_shift,
  MIN("createdAt") AS oldest_record,
  MAX("createdAt") AS newest_record
FROM "TimeEntry";


-- ─── QUERY 8: Tablas que NO conocíamos — conteo rápido ─────────────────────
SELECT 'Client' AS tabla, COUNT(*) AS rows FROM "Client"
UNION ALL
SELECT 'Location', COUNT(*) FROM "Location"
UNION ALL
SELECT 'Project', COUNT(*) FROM "Project"
UNION ALL
SELECT 'EmployeeAssignment', COUNT(*) FROM "EmployeeAssignment"
UNION ALL
SELECT 'PendingBooking', COUNT(*) FROM "PendingBooking"
UNION ALL
SELECT 'WhatsAppContact', COUNT(*) FROM "WhatsAppContact"
ORDER BY tabla;


-- ─── QUERY 9: Orphans — FKs rotas ──────────────────────────────────────────
SELECT '⚠️ Employee sin User' AS issue, e.id, e.full_name AS detail
FROM "Employee" e LEFT JOIN "User" u ON u.id = e."userId"
WHERE u.id IS NULL
UNION ALL
SELECT '⚠️ TimeEntry sin Employee', t.id, t."employeeId"
FROM "TimeEntry" t LEFT JOIN "Employee" e ON e.id = t."employeeId"
WHERE e.id IS NULL
UNION ALL
SELECT '⚠️ Trip sin Driver', t.id, t."driverId"
FROM "Trip" t LEFT JOIN "Driver" d ON d.id = t."driverId"
WHERE t."driverId" IS NOT NULL AND d.id IS NULL
UNION ALL
SELECT '⚠️ PriceOverride sin Creator', p.id, p."createdById"
FROM "PriceOverride" p LEFT JOIN "User" u ON u.id = p."createdById"
WHERE u.id IS NULL;


-- ─── QUERY 10: ID format check ─────────────────────────────────────────────
SELECT tabla, id, LENGTH(id) AS id_length,
  CASE
    WHEN id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN 'UUID standard'
    WHEN id ~ '^[a-z]' THEN 'Prisma CUID-like'
    ELSE 'Other'
  END AS id_format
FROM (
  (SELECT 'User' AS tabla, id FROM "User" LIMIT 2)
  UNION ALL
  (SELECT 'Employee', id FROM "Employee" LIMIT 2)
  UNION ALL
  (SELECT 'Driver', id FROM "Driver" LIMIT 2)
  UNION ALL
  (SELECT 'Company', id FROM "Company" LIMIT 1)
  UNION ALL
  (SELECT 'Trip', id FROM "Trip" LIMIT 2)
  UNION ALL
  (SELECT 'TimeEntry', id FROM "TimeEntry" LIMIT 2)
  UNION ALL
  (SELECT 'PriceOverride', id FROM "PriceOverride" LIMIT 2)
  UNION ALL
  (SELECT 'WhatsAppContact', id FROM "WhatsAppContact" LIMIT 2)
) sub
ORDER BY tabla;


-- ─── QUERY 11: WhatsAppContact — detalle (potencial tabla de riders) ───────
SELECT
  id,
  jid,
  phone,
  name,
  "pushName",
  language,
  "tripCount",
  "lastTripAt",
  "lastPickupAddr",
  "createdAt"
FROM "WhatsAppContact"
ORDER BY "tripCount" DESC
LIMIT 20;
