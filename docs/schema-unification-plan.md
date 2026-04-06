# Drivly — Schema Unification Plan v2

**Fecha:** 2026-04-05
**Branch:** `desk`
**Autor:** Rafael + Claude
**Revisión:** Incorpora feedback de consultor de compliance + respuestas de discovery

---

## 0. Contexto Operativo Actual (Discovery)

| Pregunta                          | Respuesta                                                                        |
| --------------------------------- | -------------------------------------------------------------------------------- |
| ¿Cuántas bases operan hoy?        | **1 sola** (Excellent Taxi). Multi-tenancy es preparación a futuro.              |
| ¿Qué son los 9 employees?         | **Despachadores/oficina**. No manejan. Son personal administrativo.              |
| ¿WhatsApp integration?            | **Conexión directa** (baileys/wa-web.js). Migración a Business API el 1 de mayo. |
| ¿Quién accede a la DB?            | **Solo vía admin dashboard**. No hay BI tools ni agentes AI directos.            |
| ¿Cómo logean drivers hoy?         | **OTP por WhatsApp**. No usan contraseña.                                        |
| ¿Las tarifas cambian?             | **Casi nunca**. Se agregan nuevas rutas, rara vez se modifica precio existente.  |
| ¿Qué pasa cuando un driver se va? | **Soft delete**. Se desactiva, data histórica se conserva.                       |

---

## 1. Diagnóstico del Estado Actual

### 1.1 Dos mundos, dos bases de datos

| Aspecto    | DB Local (Drivly)                    | DB Supabase (Legacy)                 |
| ---------- | ------------------------------------ | ------------------------------------ |
| **Engine** | PostgreSQL 16 + PostGIS 3.4 (Docker) | PostgreSQL (Supabase hosted)         |
| **ORM**    | Drizzle ORM, migraciones custom SQL  | Sin ORM (raw SQL via pg Pool)        |
| **Acceso** | Read/Write                           | Read-only (5 conn pool)              |
| **Schema** | 15+ tablas, multi-tenant, PostGIS    | 7 tablas, single-tenant              |
| **Auth**   | Drivers + Riders (bcrypt + JWT)      | Admins (bcrypt, Supabase User table) |
| **IDs**    | UUID nativo (`gen_random_uuid()`)    | Text IDs (`u0000000-...`)            |

### 1.2 Problemas Identificados

**P1 — Auth fragmentada (3 sistemas):**

- Drivers en Supabase → OTP por WhatsApp (authToken estático)
- Drivers/Riders en DB local → bcrypt + JWT (password-based)
- Admins → bcrypt en Supabase User table + JWT local

**P2 — El JOIN User↔Employee para fullName:**

- Supabase `User` no tiene `full_name`, se hace LEFT JOIN con `Employee`
- Employee es nómina, no auth. No todos los Users tienen Employee asociado.

**P3 — Password storage inconsistente:**

- Drivers local: `passwordHash` inline en tabla
- Riders: `passwordHash` en tabla separada `riders_auth`
- Admins: `password_hash` en Supabase externo
- Legacy SHA-256 aún en migración on-login

**P4 — Datos operativos divididos:**

- `PriceOverride` (173 rows) en Supabase ≈ `fixed_routes` local
- `Trip` (13 rows) en Supabase ≈ `rides` local (schema más completo)
- `Driver` (2 rows) en Supabase con token auth vs password local

**P5 — ON DELETE CASCADE en datos de RRHH:**

- Propuesta original tenía `ON DELETE CASCADE` en `time_entries.employee_id`
- **Riesgo legal:** Destruiría historial de horas si se borra un empleado
- Historial de nómina debe ser **inmutable** para auditorías

**P6 — Drivers y Employees desconectados:**

- Hoy: drivers son self-employed (100% de la tarifa, sin nómina)
- Futuro: podría haber drivers empleados (W-2) que necesiten time tracking
- Sin link entre `drivers` y `employees`, no hay camino para ese modelo mixto

**P7 — Auth de drivers genera fricción innecesaria:**

- Drivers ya usan OTP por WhatsApp (funciona bien)
- Migrar a password-based es un downgrade en UX para gig-workers
- Necesitan sesión persistente tipo Uber (login una vez, queda abierto)

---

## 2. Principios de Diseño para la Unificación

1. **Auth única, métodos múltiples:** Un solo sistema JWT, pero soportar OTP (WhatsApp/SMS) como método primario para drivers y password para admins
2. **DB local como fuente de verdad:** Todo migra eventualmente a la DB local
3. **Migración gradual:** Nunca romper lo que funciona hoy
4. **Datos de RRHH inmutables:** RESTRICT en vez de CASCADE. Soft deletes obligatorios.
5. **Separación de concerns:** Auth ≠ RRHH ≠ Operaciones, pero con links opcionales
6. **Multi-tenant ready:** Todo con `company_id`, pero sin over-engineering (1 base hoy)
7. **Future-proof sin over-build:** Campos nullable para features futuras, no tablas enteras

---

## 3. Schema Unificado Propuesto

### 3.1 Cambios en Tablas Existentes

#### `admins` — Migrar auth de Supabase a local

La tabla ya tiene `full_name` (NOT NULL), `email` (UNIQUE), `password_hash`, y `role`. Agregar:

```sql
-- Trazabilidad de migración
ALTER TABLE admins ADD COLUMN legacy_supabase_id TEXT UNIQUE;
-- Auditoría: quién tocó este registro por última vez
ALTER TABLE admins ADD COLUMN updated_by UUID;
-- Fuente del último cambio
ALTER TABLE admins ADD COLUMN migration_source TEXT CHECK (migration_source IN ('legacy', 'local', 'migration_script'));
```

#### `drivers` — Preparar para OTP + sesiones persistentes

```sql
-- OTP auth (WhatsApp/SMS) - método primario para drivers
ALTER TABLE drivers ALTER COLUMN password_hash DROP NOT NULL; -- password ahora es opcional
ALTER TABLE drivers ADD COLUMN phone_verified BOOLEAN DEFAULT false;
ALTER TABLE drivers ADD COLUMN otp_code TEXT;           -- código temporal (6 dígitos)
ALTER TABLE drivers ADD COLUMN otp_expires_at TIMESTAMPTZ;
ALTER TABLE drivers ADD COLUMN otp_channel TEXT CHECK (otp_channel IN ('whatsapp', 'sms'));
ALTER TABLE drivers ADD COLUMN last_login_at TIMESTAMPTZ;

-- Sesión persistente (refresh tokens)
ALTER TABLE drivers ADD COLUMN refresh_token TEXT UNIQUE;
ALTER TABLE drivers ADD COLUMN refresh_token_expires_at TIMESTAMPTZ;

-- Link opcional a employee (future-proof para drivers en nómina)
ALTER TABLE drivers ADD COLUMN employee_id UUID REFERENCES employees(id);

-- Soft delete explícito (además de is_active)
ALTER TABLE drivers ADD COLUMN deactivated_at TIMESTAMPTZ;

-- Trazabilidad
ALTER TABLE drivers ADD COLUMN legacy_supabase_id TEXT UNIQUE;
ALTER TABLE drivers ADD COLUMN updated_by UUID;

CREATE INDEX drivers_employee_id_idx ON drivers(employee_id) WHERE employee_id IS NOT NULL;
CREATE INDEX drivers_refresh_token_idx ON drivers(refresh_token) WHERE refresh_token IS NOT NULL;
```

#### `fixed_routes` — Metadata para pricing futuro

```sql
-- Preparación para pricing dinámico (no urgente, pero barato de agregar)
ALTER TABLE fixed_routes ADD COLUMN is_dynamic_enabled BOOLEAN DEFAULT false;
ALTER TABLE fixed_routes ADD COLUMN base_price NUMERIC(8,2); -- precio base antes de ajustes
ALTER TABLE fixed_routes ADD COLUMN rules_config JSONB DEFAULT '{}'; -- motor de reglas futuro
ALTER TABLE fixed_routes ADD COLUMN note TEXT; -- notas operativas (migrado de PriceOverride.note)
ALTER TABLE fixed_routes ADD COLUMN is_active BOOLEAN DEFAULT true;
ALTER TABLE fixed_routes ADD COLUMN legacy_supabase_id TEXT UNIQUE;
```

### 3.2 Nuevas Tablas

#### `employees` — RRHH local (despachadores/oficina)

```sql
CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  -- Link a admin: si el empleado tiene acceso al dashboard
  admin_id UUID REFERENCES admins(id),
  employee_code TEXT,
  full_name TEXT NOT NULL,
  hourly_rate NUMERIC(8,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  deactivated_at TIMESTAMPTZ, -- soft delete con timestamp (auditoría)
  legacy_supabase_id TEXT UNIQUE,
  updated_by UUID,
  migration_source TEXT CHECK (migration_source IN ('legacy', 'local', 'migration_script')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX employees_company_id_idx ON employees(company_id);
CREATE INDEX employees_admin_id_idx ON employees(admin_id) WHERE admin_id IS NOT NULL;
CREATE INDEX employees_active_idx ON employees(company_id, is_active) WHERE is_active = true;
```

#### `time_entries` — Control de horas (inmutable)

```sql
CREATE TABLE time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  -- RESTRICT: nunca borrar entries si el employee se desactiva
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  notes TEXT,
  legacy_supabase_id TEXT UNIQUE,
  updated_by UUID,
  migration_source TEXT CHECK (migration_source IN ('legacy', 'local', 'migration_script')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX time_entries_company_id_idx ON time_entries(company_id);
CREATE INDEX time_entries_employee_id_idx ON time_entries(employee_id);
CREATE INDEX time_entries_date_range_idx ON time_entries(employee_id, start_time DESC);
-- Para queries de nómina: "todas las entries de esta semana para esta company"
CREATE INDEX time_entries_company_period_idx ON time_entries(company_id, start_time DESC);
```

### 3.3 Migración de PriceOverride → fixed_routes

| PriceOverride (Supabase) | fixed_routes (Local)                              |
| ------------------------ | ------------------------------------------------- |
| originLabel              | name (concatenar origin → dest)                   |
| originLat/Lng            | origin_lat/lng → origin_geog (trigger automático) |
| destLat/Lng              | dest_lat/lng → dest_geog (trigger automático)     |
| price                    | fixed_price                                       |
| radiusMiles              | radius_meters (× 1609.34)                         |
| isActive                 | is_active (nuevo campo)                           |
| note                     | note (nuevo campo)                                |

### 3.4 Diagrama de Relaciones Post-Unificación

```
companies (tenant root)
├── admins (auth dashboard, password-based)
│   └── employees (RRHH/oficina, link opcional via admin_id)
│       └── time_entries (control de horas, ON DELETE RESTRICT)
├── drivers (auth OTP primario, password opcional)
│   ├── vehicles
│   ├── commissions
│   ├── driver_metrics
│   └── [employee_id] ──→ employees (opcional, future: driver en nómina)
├── riders (auth password, OTP para verificación)
│   └── riders_auth (passwords separadas)
├── rides (core business)
│   └── trip_offers
│   └── payments
│   └── ratings
├── pricing_rules (1:1 per company)
├── zone_minimums (geo pricing)
└── fixed_routes (rutas fijas + metadata para pricing dinámico futuro)
```

---

## 4. Decisiones Arquitectónicas Revisadas

### D1: ¿Dónde vive la auth? → **Todo en DB local, métodos múltiples**

- Admins: password + bcrypt (migrar hashes de Supabase)
- Drivers: **OTP por WhatsApp/SMS como método primario** (como ya funciona hoy)
- Drivers: password como método secundario/opcional (nullable)
- Riders: password + bcrypt (mantener riders_auth)
- Riders: OTP para verificación de teléfono (ya existe phone_verified)
- **Un solo JWT** para todos, firmado por Fastify

### D2: ¿Sesiones de drivers? → **Refresh tokens + sesión persistente**

- Login por OTP → JWT de acceso (corta vida, ~1h) + refresh token (larga vida, ~90 días)
- La app almacena el refresh token y renueva automáticamente
- El driver no necesita volver a logear a menos que desinstale la app o pasen 90 días
- Mismo patrón que Uber/Lyft
- `drivers.refresh_token` + `drivers.refresh_token_expires_at`

### D3: ¿Driver token auth (Supabase) vs password? → **OTP wins, password es fallback**

- Token estático de Supabase → se descarta (inseguro)
- OTP por WhatsApp → método primario (ya están acostumbrados)
- Password → nullable, solo si el driver lo prefiere
- Migración de los 2 drivers de Supabase: se les envía OTP para re-registrarse

### D4: ¿Employee vs Driver? → **Separados con link opcional**

- Hoy: drivers son self-employed, employees son oficina. **Silos es correcto.**
- Futuro: `drivers.employee_id` (nullable FK → employees) permite modelo mixto
- Si un driver pasa a nómina, se crea un Employee y se linkea
- El link es opcional y no se usa hasta que sea necesario
- **Costo: 1 columna nullable. Beneficio: zero schema changes cuando llegue el momento.**

### D5: ¿ON DELETE CASCADE en time_entries? → **RESTRICT + soft deletes**

- `time_entries.employee_id ON DELETE RESTRICT` → no se puede borrar employee con entries
- `employees.deactivated_at` → soft delete con timestamp para auditoría
- `employees.is_active` → se mantiene para backward compat con el frontend actual
- **El frontend ya maneja desactivar en vez de eliminar → no fue en vano, es el patrón correcto**
- El RESTRICT es un safety net a nivel de DB por si alguien intenta DELETE directo

### D6: ¿IDs? → **UUID nativo + legacy_supabase_id para trazabilidad**

- Todos los registros migrados obtienen nuevo UUID como PK
- `legacy_supabase_id` guarda el ID original de Supabase
- No se reusan text IDs como PKs (evita incompatibilidades)

### D7: ¿Multi-tenancy y RLS? → **Application-level hoy, DB-level después**

- Hoy: 1 sola company, acceso solo vía dashboard → RLS es overkill
- El middleware `requireCompanyScope()` ya filtra por `company_id` en toda query
- **Cuando** se agreguen BI tools o agentes AI → implementar RLS policies
- El schema ya está preparado (`company_id` en toda tabla)
- Agregar RLS es una migración futura, no requiere cambios de schema

### D8: ¿Pricing dinámico? → **Schema preparado, lógica después**

- `fixed_routes.is_dynamic_enabled` → flag para activar pricing dinámico por ruta
- `fixed_routes.base_price` → precio base antes de ajustes
- `fixed_routes.rules_config` (JSONB) → motor de reglas futuro (hora del día, demanda, etc.)
- Hoy todo es `is_dynamic_enabled = false`, `fixed_price` funciona igual que antes
- **Costo: 3 columnas. Beneficio: zero migrations cuando implementemos surge pricing.**

### D9: ¿Auditoría durante migración? → **updated_by + migration_source**

- `updated_by UUID` → quién modificó el registro por última vez
- `migration_source` → 'legacy' | 'local' | 'migration_script'
- Se agrega en tablas operativas clave: admins, employees, time_entries, drivers
- Durante migración: `migration_source = 'migration_script'`, `updated_by = NULL`
- Post-migración: la API escribe `migration_source = 'local'`, `updated_by = admin.id`
- PriceOverride.createdById → se preserva en fixed_routes.updated_by durante migración

### D10: ¿Trips de Supabase? → **No migrar (data de testing)**

- 13 trips (8 completed, 5 cancelled) — data de prueba de marzo-abril 2026
- `clientName` es NULL en el 100% de los trips
- `rides.rider_id` es NOT NULL pero trips no tienen rider, solo clientPhone/clientJid
- Crear riders phantom para 13 rows no tiene valor
- Si se necesita historial: query de Supabase read-only hasta el cutover final

### D11: ¿WhatsAppContact? → **Proto-riders para cutover futuro**

- 2 contacts hoy (son los 2 drivers mismos)
- Cuando Drivly reemplace excellent-taxi, esta tabla tendrá clientes reales
- Mapeo futuro: WhatsAppContact.phone → riders.phone, tripCount, lastPickupAddr
- No impacta fases 1-4, pero se documenta para el plan de cutover

### D12: ¿Tablas vacías de Supabase? → **No migrar**

- Client (0), Location (0), Project (0), EmployeeAssignment (0), PendingBooking (0)
- Son features de control-de-horas que nunca se usaron o son transitorias (PendingBooking)
- TimeEntry.projectId y TimeEntry.locationId son 100% NULL → no se agregan a time_entries local

---

## 4b. Hallazgos de Auditoría Supabase (2026-04-05)

### Schema real: 13 tablas (no 7)

| Tabla              | Rows | Migrar? | Destino                    |
| ------------------ | ---- | ------- | -------------------------- |
| Company            | 1    | ✅      | companies                  |
| User               | 10   | ✅      | admins                     |
| Employee           | 9    | ✅      | employees                  |
| TimeEntry          | 279  | ✅      | time_entries               |
| Driver             | 2    | ✅      | drivers                    |
| PriceOverride      | 279  | ✅      | fixed_routes               |
| Trip               | 13   | ❌      | Data de testing, no migrar |
| WhatsAppContact    | 2    | 🔜      | riders (futuro cutover)    |
| Client             | 0    | ❌      | Vacía                      |
| Location           | 0    | ❌      | Vacía                      |
| Project            | 0    | ❌      | Vacía                      |
| EmployeeAssignment | 0    | ❌      | Vacía                      |
| PendingBooking     | 0    | ❌      | Transitoria (bot WhatsApp) |

### IDs: formato mixto confirmado

| Tabla                              | Formato                                     | Longitud |
| ---------------------------------- | ------------------------------------------- | -------- |
| Company, Employee, User, TimeEntry | UUID-like con prefijo custom (u, e, te, c1) | 36       |
| PriceOverride                      | UUID standard real                          | 36       |
| Driver, Trip, WhatsAppContact      | Prisma CUID                                 | 25       |

Todos van como TEXT en `legacy_supabase_id`. PKs nuevos son UUID nativo.

### Data quality: limpia

- 0 orphans (FKs intactas)
- 10/10 hashes bcrypt $2b$10$ (60 chars) — copiables directo
- 1 TimeEntry abierta (sin end_time) — tabla permite NULL, OK
- TimeEntry.projectId/locationId: 100% NULL (features no usadas)

---

## 5. Auth Flow Revisado para Drivers

### 5.1 Flujo OTP (primario)

```
Driver abre la app
  → ¿Tiene refresh_token válido?
    → SÍ: Renovar JWT automáticamente (sin interacción del usuario)
    → NO: Pantalla de login

Pantalla de login:
  1. Driver ingresa número de teléfono
  2. POST /auth/driver/otp/send { phone, channel: 'whatsapp' }
     → Enviar OTP por WhatsApp (hoy: baileys, mayo: Business API)
     → Guardar otp_code + otp_expires_at en drivers (hash del código)
  3. Driver recibe código por WhatsApp, lo ingresa
  4. POST /auth/driver/otp/verify { phone, code }
     → Verificar código contra drivers.otp_code
     → Limpiar otp_code, set phone_verified = true
     → Generar JWT (access token, ~1h) + refresh token (~90 días)
     → Guardar refresh_token en drivers
     → Return { accessToken, refreshToken, driverId }
  5. App almacena refresh_token en secure storage
  6. Cada request: Authorization: Bearer {accessToken}
  7. Cuando accessToken expira: POST /auth/driver/refresh { refreshToken }
     → Verificar refresh_token contra DB
     → Generar nuevo JWT + nuevo refresh_token (rotación)
     → Return { accessToken, refreshToken }
```

### 5.2 Flujo Password (fallback)

```
POST /auth/driver/login { email, password }
  → Mismo flujo actual, pero ahora genera refresh_token también
  → password_hash es nullable, solo funciona si el driver tiene password
```

### 5.3 Sesión Persistente

- **Access token:** ~1 hora (seguro, corta vida)
- **Refresh token:** ~90 días (larga vida, almacenado en secure storage del dispositivo)
- **Rotación:** Cada refresh genera un nuevo refresh_token (el anterior se invalida)
- **Logout:** Limpia refresh_token de la DB
- **Forzar re-login:** Admin puede limpiar refresh_token desde el dashboard
- **Resultado:** Driver logea una vez → queda abierto indefinidamente (como Uber)

---

## 6. Plan de Migración por Fases

### Fase 0 — Preparación (sin downtime, sin riesgo)

**Objetivo:** Crear tablas nuevas, agregar columnas, sin tocar funcionalidad existente.

**Migration file:** `0010_schema_unification_prep.sql`

1. ALTER TABLE admins: +legacy_supabase_id, +updated_by, +migration_source
2. ALTER TABLE drivers: password_hash nullable, +phone_verified, +otp_code, +otp_expires_at, +otp_channel, +last_login_at, +refresh_token, +refresh_token_expires_at, +employee_id, +deactivated_at, +legacy_supabase_id, +updated_by
3. ALTER TABLE fixed_routes: +is_dynamic_enabled, +base_price, +rules_config, +note, +is_active, +legacy_supabase_id
4. CREATE TABLE employees (con ON DELETE RESTRICT patterns)
5. CREATE TABLE time_entries (employee_id ON DELETE RESTRICT)
6. Actualizar Drizzle schema en `packages/db/src/schema/index.ts`
7. `pnpm db:migrate`

**Riesgo:** Cero. Solo agrega columnas y tablas. Nada existente se modifica.

### Fase 1 — Migrar Admin Auth a Local

**Objetivo:** Admin login contra DB local. Eliminar dependencia de Supabase para auth.

1. Crear Company de Excellent Taxi en DB local (si no existe)
2. Script `scripts/migrate-supabase-admins.ts`:
   - Leer 10 Users de Supabase con LEFT JOIN Employee
   - INSERT INTO admins con role mapping + bcrypt hashes copiados byte-a-byte
   - migration_source = 'migration_script'
3. Modificar `adminAuth.ts` → query `admins` local con Drizzle
4. Feature flag `ADMIN_AUTH_SOURCE=local|supabase` para rollback
5. Test: login con los 10 usuarios

**Riesgo:** Bajo (hashes bcrypt se copian directo, misma librería bcryptjs).

### Fase 2 — Migrar Datos Operativos + Driver OTP Auth

**Objetivo:** PriceOverride y Drivers migrados. Driver auth por OTP funcional.

1. Script `scripts/migrate-supabase-operational.ts`:
   - PriceOverride → fixed_routes (279 total, migrar activas, convertir miles→meters)
   - PriceOverride.createdById → fixed_routes.updated_by (preservar audit trail)
   - Driver → drivers (2 rows, sin password, se re-registran por OTP)
   - **Trip → NO migrar** (13 rows de testing, clientName NULL en todos, no hay riderId para mapear al FK NOT NULL de rides)
2. Implementar endpoints OTP para drivers:
   - `POST /auth/driver/otp/send`
   - `POST /auth/driver/otp/verify`
   - `POST /auth/driver/refresh`
3. Actualizar endpoints legacy para leer de DB local
4. Los 2 drivers de Supabase reciben OTP para activar su cuenta en el nuevo sistema

**Nota sobre Trips:** Los 13 trips son data de prueba (8 completed, 5 cancelled). `rides.rider_id` es NOT NULL pero los trips solo tienen `clientPhone`/`clientJid` (sin rider). No vale la pena crear riders phantom para 13 rows de test.

**Riesgo:** Medio. El OTP auth es funcionalidad nueva. Requiere testing con WhatsApp real.

### Fase 3 — Migrar Datos RRHH

**Objetivo:** Employee y TimeEntry en DB local. Control de horas 100% local.

1. Script `scripts/migrate-supabase-hr.ts`:
   - Employee → employees (9 rows, link admin_id donde corresponda)
   - TimeEntry → time_entries (279 rows, mapear employeeId)
   - migration_source = 'migration_script' en todos
2. Actualizar endpoints legacy para queries locales
3. Verificar que `/legacy/time-entries/summary` calcula mismos totales

**Riesgo:** Bajo. Data histórica, volumen pequeño.

### Fase 4 — Cleanup

**Objetivo:** Cortar el cordón con Supabase.

1. Remover `supabaseClient.ts` y `SUPABASE_DATABASE_URL`
2. Remover LEFT JOIN User↔Employee del auth
3. Batch-upgrade SHA-256 hashes restantes a bcrypt
4. Renombrar/consolidar endpoints `/legacy/*`
5. Mantener `legacy_supabase_id` para auditoría (no borrar)
6. Documentar en CLAUDE.md que Supabase ya no se usa

---

## 7. Orden de Ejecución

```
Semana 1: Fase 0 (prep) + Fase 1 (admin auth local)
  → Tablas creadas, columnas agregadas
  → Admin login funciona contra DB local
  → Supabase auth ya no es crítico

Semana 2: Fase 2 (datos operativos + driver OTP)
  → PriceOverrides migrados a fixed_routes
  → Driver auth por OTP implementado
  → 2 drivers migrados (trips NO se migran — data de testing)

Semana 3: Fase 3 (RRHH) + Fase 4 (cleanup)
  → 9 employees + 279 time_entries migrados
  → Supabase completamente desconectado
  → Código legacy removido
```

---

## 8. Checklist de Verificación Post-Migración

### Auth

- [ ] Admin login funciona con los 10 usuarios (contra DB local)
- [ ] Driver OTP por WhatsApp funciona (send + verify)
- [ ] Driver sesión persistente funciona (refresh token)
- [ ] Driver login por password funciona (fallback)
- [ ] Rider login funciona (sin cambios)

### Data Integrity

- [ ] fixed_routes tiene PriceOverrides activas migradas (con createdById preservado en updated_by)
- [ ] employees tiene 9 rows con legacy_supabase_id
- [ ] time_entries tiene 279 rows con ON DELETE RESTRICT
- [ ] Intentar DELETE employee con time_entries → falla (RESTRICT funciona)
- [ ] `/legacy/stats` retorna mismos números que antes
- [ ] `/legacy/time-entries/summary` calcula mismas horas/pay
- [ ] Trips de Supabase NO migrados (confirmado: data de testing)

### Cleanup

- [ ] No hay referencias a `SUPABASE_DATABASE_URL` en código
- [ ] `supabaseClient.ts` eliminado
- [ ] Todos los endpoints usan Drizzle
- [ ] SHA-256 hashes: cero restantes
- [ ] `migration_source` y `updated_by` poblados en registros migrados

### Future-Proof

- [ ] `drivers.employee_id` existe (nullable, sin uso aún)
- [ ] `fixed_routes.rules_config` existe (JSONB, default {})
- [ ] `employees.deactivated_at` existe (soft delete con timestamp)
- [ ] Todos los `company_id` son NOT NULL en tablas nuevas
