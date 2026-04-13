# Drivly — Database Audit & Draft Plan

**Fecha:** 2026-04-11
**Estado:** DECISIONES TOMADAS — 2026-04-12. Listo para ejecución.
**Supersede parcialmente:** `docs/schema-unification-plan.md` (ver §8)

---

## 0. Contexto

Este documento consolida los hallazgos de una auditoría multi-especialista del schema de Drivly + control-de-horas, más el plan borrador en fases derivado de esos hallazgos. La auditoría se disparó por dos decisiones estratégicas del usuario:

1. **Reusar el proyecto Supabase existente de control-de-horas** (no crear uno separado para Drivly ni migrar datos hacia afuera).
2. **Mapas son core** — Google Maps Platform como primario, sin optimizar por costo free.

Esas dos decisiones invalidan gran parte del `schema-unification-plan.md` original, que asumía Drivly viviendo en su propio Postgres local/droplet con migración OUT de Supabase. La realidad nueva: **Drivly se consolida EN el Supabase que ya existe**, y hay que auditar ese schema con rigor antes de construir encima.

### Descubrimiento clave durante la auditoría

**Control-de-horas no es solo un sistema de control horario.** Ya contiene las tablas `Driver`, `Trip`, `PendingBooking`, `WhatsAppContact`, `PriceOverride` — es decir, **control-de-horas ya es un taxi dispatch funcional**. Drivly no lo reemplaza desde cero: lo extiende. Esto cambia el framing completo del trabajo — de "migración" a "consolidación con hardening".

---

## 1. Decisiones estratégicas

| Área                  | Decisión                                                         | Implicación                                                                        |
| --------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Base de datos**     | Reusar Supabase de control-de-horas                              | No hay migración OUT, es consolidación IN                                          |
| **Supabase tier**     | Free ahora, Pro ($25/mes) antes de launch                        | Workaround anti-pause durante desarrollo                                           |
| **Auth**              | **Supabase Auth completo**                                       | OAuth (Google/Apple), phone OTP, biométrico/PIN cada 7 días. Reemplaza auth custom |
| **Real-time**         | **WebSocket custom + Redis**                                     | Se mantienen. Supabase Realtime descartado por límite 200 conexiones               |
| **Mapas**             | Google Maps Platform primario                                    | Descarta OSRM/MapTiler/Geoapify/Photon del stack                                   |
| **Navegación driver** | Evaluar Mapbox Navigation SDK                                    | Única opción de calidad Uber-level embeddable                                      |
| **Location pings**    | Quedan en Redis hub en Fastify, NO en Postgres                   | Arquitectura ya correcta — confirmado por audit                                    |
| **Deployment**        | Droplet DO actual                                                | Con upgrade a 2vCPU/4GB antes de tocar Supabase Pro                                |
| **Storage**           | **Híbrido**: Supabase Storage (liviano) + Cloudflare R2 (pesado) | Clasificación específica pendiente                                                 |
| **Edge / tunnel**     | Cloudflare Tunnel + Pages                                        | Admin dashboard en Pages, API sin puertos abiertos                                 |
| **Migraciones**       | **Supabase CLI + Drizzle generate + CI diff check**              | Drizzle genera, CLI aplica, CI valida                                              |
| **ORM**               | **Unificar en Drizzle**                                          | Migrar control-de-horas de Prisma a Drizzle                                        |
| **Tabla de viajes**   | **Drivly trabaja sobre `Trip`**                                  | No se crea tabla `rides` separada, se extiende Trip                                |
| **Audit log**         | **Triggers + hash-chain desde el inicio**                        | Tamper-evident, PCI DSS Req. 10                                                    |
| **IA**                | **Base y features IA en paralelo**                               | Correcciones mecánicas no bloquean desarrollo IA                                   |

---

## 2. Metodología de auditoría

Se despacharon 4 agentes independientes en paralelo, cada uno con un ángulo distinto, leyendo directamente los schemas (Prisma de control-de-horas + Drizzle de Drivly) y docs relacionados:

1. **Ride-hailing domain expert** — benchmark contra estándares de la industria (Uber/Lyft/Bolt/Grab/Didi)
2. **PostgreSQL DBA / data modeler** — auditoría pura de calidad Postgres
3. **Scale & performance engineer** — proyección de crecimiento S1→S5
4. **Security & compliance engineer** — PII, PCI DSS, GDPR, audit trail

Los 4 reportes completos están en los logs de tasks del 2026-04-11.

---

## 3. Veredictos por lente

| Lente                 | Grade                                 | Headline                                                                          |
| --------------------- | ------------------------------------- | --------------------------------------------------------------------------------- |
| Domain (ride-hailing) | 55-60% production-ready               | Esqueleto sólido, gaps additivos (8-10 tablas nuevas, ~15 columnas), no rewrite   |
| PostgreSQL DBA        | **C+** (Drizzle C-/D-, Prisma D)      | Bomba latente en timestamps, Float para dinero, PostGIS mal declarado             |
| Scale & performance   | Sobrevive S4 con 3 cambios baratos    | Arquitectura actual de pings es correcta, no tocar                                |
| Security & compliance | control-de-horas **B+**, Drivly **D** | **No listo para riders reales.** Passwords rotos, sin audit log, tokens plaintext |

**Combinación final proyectada post-plan:** B+/A-. Suficiente para pre-Series-A con pagos reales. **Estimado: 3 semanas focused.**

---

## 4. Hallazgos cruzados (múltiples agentes coincidieron)

### 4.1 🚨 SHA-256 password hashing — P0 absoluto

**Flagged por agentes 1, 2 y 4.** `CLAUDE.md:63` dice literalmente _"SHA-256 with JWT_SECRET as salt"_. Esto no es un password hash — es un hash rápido sin salt por usuario, trivialmente rainbow-table-able. Aplica a `admins.passwordHash`, `drivers.passwordHash`, `ridersAuth.passwordHash`, `User.password_hash` (si Drivly está escribiendo allí).

**Fix:** `argon2id` (OWASP-blessed, memory-hard). Backfill rehash-on-login.

### 4.2 `rejected_driver_ids` anti-patrón — P0

**Flagged por los 4 agentes.**

- Domain: debe drenar por `trip_offers` con unique `(ride_id, driver_id)` + `rejection_reason` + `auto_rejected`
- DBA: mínimo `uuid[]` con GIN, mejor tabla normalizada
- Scale: textbook de "cheap now, expensive later"
- Security: bloquea RLS porque no se puede escribir policies sobre un text joined

**Fix:** tabla `ride_driver_rejections(ride_id, driver_id, rejected_at, reason)` + drop de la columna.

### 4.3 PostGIS columns declaradas como `text` en Drizzle — P0

**Flagged por DBA y Scale.** `pickup_geog`, `dropoff_geog`, y la ausencia de GiST en `drivers.current_lat/lng` (la query más hot del sistema).

**Fix:**

```sql
ALTER TABLE drivers ADD COLUMN current_geog geography(Point,4326)
  GENERATED ALWAYS AS (
    CASE WHEN current_lng IS NOT NULL AND current_lat IS NOT NULL
         THEN ST_SetSRID(ST_MakePoint(current_lng, current_lat),4326)::geography
         ELSE NULL END
  ) STORED;
CREATE INDEX drivers_current_geog_gix ON drivers USING gist (current_geog)
  WHERE is_available AND is_active AND status='idle';
```

Y `customType` o `drizzle-postgis` en Drizzle para `pickup_geog`/`dropoff_geog`.

### 4.4 Tokens y OTP en plaintext — P0

**Flagged por DBA y Security.**

- `drivers.refresh_token` plaintext sin family tracking
- `drivers.otp_code` plaintext
- `Otp.code` plaintext
- `RefreshToken.token` plaintext (incluso en control-de-horas)
- `Driver.authToken` plaintext bearer indexado

**Fix:** hash SHA-256 con pepper server-side, indexar por hash, nunca el valor raw.

### 4.5 Sin audit log — P0

**Flagged por Domain y Security.** No hay trazabilidad de quién cambió precios, reasignó rides, accedió a PII. Bloquea PCI DSS Req. 10 y SOC2. El agente 4 dejó DDL completo con hash-chain tamper evidence (§5.3).

---

## 5. Bomba latente única (solo DBA la vio)

**Drizzle timestamp drift.** Las ~50 columnas `timestamp('col')` sin `{ withTimezone: true }` compilan a `TIMESTAMP` (sin TZ), pero las migraciones SQL crearon `TIMESTAMPTZ`. Hoy funciona por coincidencia. El día que alguien corra `drizzle-kit generate` contra la DB viva va a emitir `ALTER COLUMN ... TYPE timestamp` y **arrancar silenciosamente la zona horaria de cada fila**, convirtiendo UTC en "lo que sea la session TZ".

**Fix inmediato:**

1. Agregar `{ withTimezone: true }` a todos los `timestamp()` en `packages/db/src/schema/`
2. CI check que falle si `drizzle-kit diff` muestra cambios contra la DB real
3. Prohibir `drizzle-kit push` en cualquier npm script

---

## 6. Crédito a control-de-horas (8 cosas ya bien)

Los agentes 1 y 4 coinciden: control-de-horas ya hace 8 cosas mejor que el promedio de la industria para una startup chica. **Drivly NO debe reinventar ninguna — las hereda tal cual.**

1. `RefreshToken.family` con replay detection (patrón Auth0/Uber)
2. `RevokedToken.jti` con cleanup automático (cada 5 min)
3. `SseTicket` single-use 30s — patrón correcto que casi nadie implementa
4. `Otp` en Postgres con `attempts` counter (sobrevive restarts, auditable)
5. `PriceOverride.createdById` — audit trail en cambios de precio
6. `time_entries ON DELETE RESTRICT` — HR immutability correcto
7. Indexing generoso en `Trip` — production-grade
8. 8 capas de middleware documentadas (rate limiters, Zod, helmet+CSRF, SSRF, logger que enmascara PII, pinned deps, token management)

---

## 7. P0 Blocker List (ordenado)

Ningún rider real debe tocar el sistema hasta que estos estén resueltos:

1. **SHA-256 → argon2id** en todas las tablas de passwords
2. **Drizzle timestamp drift** — agregar `withTimezone: true` + CI check
3. **Tokens plaintext** — hashear `refresh_token`, `otp_code`, `Otp.code`, `RefreshToken.token`, `Driver.authToken`
4. **JWT 7d → 15min + refresh rotation** en Drivly (replicar patrón de control-de-horas)
5. **Audit log con triggers** — DDL con hash-chain (ver §9)
6. **PostGIS real columns + GiST** en `drivers.current_geog` y `rides.pickup_geog/dropoff_geog`
7. **Float → numeric(10,2)** en todo lo que sea dinero (`PriceOverride.price`, `Trip.price`, `Employee.hourly_rate`, etc.)
8. **CHECK constraints** — lat/lng ranges, `ratings.score BETWEEN 1 AND 5`, ride timeline coherente, `price > 0`
9. **`stripe_webhook_events`** — `company_id NOT NULL`, agregar `signature`, `raw_payload_hash`, `idempotency_status`
10. **`rides.idempotency_key text UNIQUE`** scoped por company — evita duplicados por retries del bot/webhooks
11. **`rejected_driver_ids` → tabla normalizada** `ride_driver_rejections`
12. **`rides.rider_id` relajar `NOT NULL`** o implementar upsert-from-phone

---

## 8. Plan borrador en fases

### **Fase 0 — Parar la sangría (2-3 días)**

Todo lo que evita corrupción o breach.

- [ ] Agregar `{ withTimezone: true }` a los ~50 `timestamp()` de Drizzle
- [ ] `customType` o `drizzle-postgis` para geography columns (pickup_geog, dropoff_geog, etc.)
- [ ] Configurar Supabase CLI como runner de migraciones (reemplaza `migrate.ts`)
- [ ] CI check: `drizzle-kit diff` contra DB real + `supabase db diff` limpio
- [ ] Prohibir `drizzle-kit push` en scripts
- [ ] **Migrar auth a Supabase Auth**: mover usuarios a `auth.users`, configurar OAuth (Google/Apple), phone OTP
- [ ] Eliminar auth custom (SHA-256, JWT 7d, tokens plaintext) — Supabase Auth maneja bcrypt, refresh rotation, JWT corto
- [ ] `stripe_webhook_events.company_id NOT NULL` + columnas de verificación

### **Fase 1 — Correcciones estructurales + migración Prisma→Drizzle (semana 2)**

Los "cheap now, expensive later" + unificación de ORMs.

- [ ] **Migrar control-de-horas de Prisma a Drizzle** — schema unificado, un solo ORM
- [ ] **Drivly trabaja sobre `Trip`** — agregar columnas PostGIS, fare breakdown, etc. a Trip existente
- [ ] PostGIS real: generated columns + GiST en `drivers`, `Trip`, `fixed_routes`
- [ ] `Float` money → `numeric(10,2)` en schema unificado
- [ ] `rejected_driver_ids` → tabla `trip_driver_rejections`
- [ ] `Trip.rider_id` nullable o upsert-from-phone
- [ ] `Trip.idempotency_key` unique por company
- [ ] CHECK constraints: lat/lng ranges, ratings score, ride timeline, price positivo
- [ ] FK indexes faltantes: `vehicles.driver_id`, `vehicles.company_id`, `ratings.from_*`, `riders_auth.rider_id`, `stripe_webhook_events.company_id`, `driver_metrics.ride_id`
- [ ] Colapsar `rideStatusEnum` (eliminar duplicados: `accepted` vs `driver_assigned`, `en_route` vs `in_progress`)
- [ ] Agregar estados: `no_show_rider`, `no_show_driver`, `driver_cancelled`, `admin_force_completed`
- [ ] `Trip.cancelled_by`, `Trip.cancel_reason_code`, `Trip.no_show_type`
- [ ] BRIN en append-only: `driver_metrics`, `stripe_webhook_events`, `commissions`
- [ ] Partial unique para soft-delete: `UNIQUE (lower(email)) WHERE deactivated_at IS NULL` en drivers

### **Fase 2 — Capa financiera (semana 3)**

Lo que hoy es single-row se vuelve event-sourced.

- [ ] Tabla `fare_items` — breakdown: base, distance, time, surge, tolls, tip, discount, tax, commission, platform_fee
- [ ] Tabla `payment_events` append-only (source-of-truth para webhooks Stripe)
- [ ] Tabla `driver_ledger_entries` estilo doble-entrada
- [ ] Tabla `payouts(stripe_transfer_id, status, failure_code, retry_count, period_start, period_end)`
- [ ] `commissions` mantiene su forma pero con referencias al ledger
- [ ] Idempotency key en `payments(stripe_pi_id)` — composite unique para Stripe webhook retries

### **Fase 3 — Compliance y trazabilidad (semana 3-4)**

Lo que habilita que riders reales toquen el sistema.

- [ ] Tabla `audit_log` con DDL del §9 (hash-chain tamper evidence, INSERT-only policies)
- [ ] Triggers `AFTER INSERT/UPDATE/DELETE` en `admins`, `drivers`, `riders`, `Trip`, `payments`, `pricing_rules`, `fixed_routes`, `PriceOverride`, `commissions`
- [ ] Driver compliance columns: `license_expires_at`, `insurance_expires_at`, `background_check_status`, `background_check_at`, `kyc_status`, `onboarding_step`, `acceptance_rate`, `cancel_rate`, `completion_rate`, `last_active_at`
- [ ] Tabla `driver_documents(driver_id, kind, url, expires_at, verified_at, verified_by)` — referencia a Supabase Storage o R2 según peso
- [ ] Tabla `incidents(ride_id, reporter_type, reporter_id, category, severity, description, status, resolution)`
- [ ] Tabla `notifications(channel, recipient_type, recipient_id, template, payload, provider_id, status, timestamps)`
- [ ] Column-level encryption en `drivers.license_number`, `drivers.tlc_license` vía `pgcrypto`
- [ ] Configurar Supabase Storage para docs livianos autenticados + Cloudflare R2 para pesados
- [ ] Retention jobs con `pg_cron`:
  - OTP >15min post-expiry → delete (si quedan OTPs custom post-migración a Supabase Auth)
  - SseTicket expirados → delete
  - `PendingBooking.conversationLog` >24h → delete
  - `Trip.pickup/dropoff_address` >90d → truncate a zip only

### **Fase 4 — Hardening de dispatch (semana 4+)**

- [ ] `SELECT ... FOR UPDATE SKIP LOCKED` en candidate selection del dispatcher
- [ ] Composite `trip_offers (driver_id, status, expires_at) WHERE status='pending'`
- [ ] Composite `Trip (company_id, status, requested_at DESC)` — crítico para admin dashboard
- [ ] Exclusion constraint en `time_entries` (no intervalos solapados por empleado):

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE time_entries ADD CONSTRAINT time_entries_no_overlap
  EXCLUDE USING gist (
    employee_id WITH =,
    tstzrange(start_time, coalesce(end_time, 'infinity'::timestamptz)) WITH &&
  );
```

- [ ] `moddatetime` trigger para `updated_at` en todas las tablas mutables (no confiar en ORMs)

### **Fase 5 — Auth móvil avanzada (paralela a Fase 1+)**

- [ ] Integrar OAuth (Google/Apple) en apps driver y rider (Supabase Auth + `expo-auth-session`)
- [ ] Biométrico: `expo-local-authentication` (huella/Face ID) + `expo-secure-store` para refresh token
- [ ] PIN como fallback cuando biométrico no disponible
- [ ] Reauth cada 7 días (guardar timestamp de última verificación en secure store)
- [ ] Flujo: primer login OAuth/OTP → biométrico en aperturas subsecuentes → reauth a los 7 días

---

## 9. Audit log DDL (aprobado del agente 4)

```sql
CREATE TABLE audit_log (
  id               bigserial PRIMARY KEY,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  company_id       uuid,
  actor_type       text NOT NULL,  -- 'admin' | 'driver' | 'rider' | 'system' | 'stripe_webhook' | 'bot'
  actor_id         uuid,
  actor_ip_hash    bytea,          -- SHA-256(ip || daily_salt) — no IP en claro
  action           text NOT NULL,  -- 'create' | 'update' | 'delete' | 'login' | 'export' | 'impersonate'
  entity_type      text NOT NULL,  -- 'ride' | 'driver' | 'payment' | 'price_override' | ...
  entity_id        uuid,
  before_hash      bytea,          -- SHA-256 del JSON previo (no PII en audit)
  after_hash       bytea,
  diff_summary     text,           -- solo nombres de campos, nunca valores
  request_id       uuid,
  user_agent_hash  bytea,
  prev_row_hash    bytea,          -- hash-chain para tamper evidence
  row_hash         bytea NOT NULL
);

REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_append_only ON audit_log FOR INSERT WITH CHECK (true);
CREATE POLICY audit_read_same_company ON audit_log FOR SELECT
  USING (company_id = current_setting('app.company_id', true)::uuid
         OR current_setting('app.role', true) = 'platform_admin');

CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_log_actor_idx  ON audit_log (actor_type, actor_id, occurred_at DESC);
CREATE INDEX audit_log_created_brin ON audit_log USING brin (occurred_at);
```

**Por qué triggers y no app-level:**

1. No se bypassa desde SQL raw de un app comprometida
2. Captura cambios durante migraciones
3. Single point of truth para PCI DSS Req. 10.2
4. Hash-chain (`prev_row_hash`/`row_hash`) hace que tampering post-hoc sea detectable

---

## 10. Anti-recomendaciones explícitas (qué NO hacer)

Los 4 agentes coinciden en no hacer estas cosas — están acá para que no se cuelen por impulso o por leer tutoriales que no aplican a esta escala.

- ❌ **No partitionar** hasta S4+ (año 2, >1M rides acumulados). 110k rows/año está 5 órdenes de magnitud debajo del threshold donde `pg_partman` paga.
- ❌ **No TimescaleDB.** Overkill para tu volumen, complica migraciones en Supabase, sin beneficio real hasta S5+.
- ❌ **No RLS completo** — solo en read paths (Fase 4+, no ahora). Mantener `requireCompanyAccess` middleware como defense in depth.
- ❌ **No persistir location pings en Postgres.** La arquitectura actual (Redis hub + `drivers.current_*` last-known) es la razón por la que el schema escala graciosamente. A 200 drivers × 1 Hz serían 17M rows/día.
- ❌ **No materialized views para driver availability.** Partial indexes en `drivers` son mejores — el MV refresh churna más que la base.
- ❌ **No rewrite del schema.** Todos los gaps son additivos.
- ❌ **No `drizzle-kit push`** ni **`prisma migrate dev`** contra la DB compartida. Ambos se pelean.
- ❌ **No migrar a Postgres local.** Quedate en Supabase con las reglas de supervivencia del Free tier.
- ❌ **No self-host Supabase en el droplet.** Necesita 4-5 GiB RAM idle, el droplet tiene 1.9 GiB totales (ver `docs/droplet-capacity-analysis.md`).
- ❌ **No Sentry Node SDK pesado** hasta que tengas problemas reales — envelope poster de 40 líneas basta para errores básicos.

---

## 11. Decisiones resueltas (2026-04-12)

| #   | Pregunta                               | Decisión                                                                                                                                       |
| --- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | ¿Auth custom o Supabase Auth?          | **Supabase Auth completo** — OAuth (Google/Apple), phone OTP, biométrico/PIN cada 7 días. Reemplaza SHA-256, tokens plaintext, JWT 7d de golpe |
| 2   | ¿WebSocket custom o Supabase Realtime? | **WebSocket custom + Redis** — sin límite de conexiones, Redis necesario para BullMQ de todas formas                                           |
| 3   | ¿Storage centralizado o híbrido?       | **Híbrido** — Supabase Storage para docs livianos autenticados, Cloudflare R2 para pesados                                                     |
| 4   | ¿Supabase Free o Pro?                  | **Free ahora, Pro antes de launch** — workaround anti-pause durante desarrollo                                                                 |
| 5   | ¿Tooling de migraciones?               | **Supabase CLI + Drizzle generate + CI diff check** — elimina migrate.ts custom                                                                |
| 6   | ¿Audit log con hash-chain?             | **Sí, desde el inicio** — 30 líneas SQL extra, tamper-evident, PCI DSS Req. 10                                                                 |
| 7   | ¿Fix Drizzle schema?                   | **Fix timestamps + PostGIS + CI check** — withTimezone:true, customType para geography                                                         |
| 8   | ¿Trip o rides?                         | **Drivly trabaja sobre Trip** — no se crea tabla rides, se extiende Trip directamente                                                          |
| 9   | ¿Prisma + Drizzle coexisten?           | **Unificar en Drizzle** — migrar control-de-horas de Prisma ahora                                                                              |
| 10  | ¿Base primero o IA en paralelo?        | **En paralelo** — correcciones mecánicas no bloquean features IA                                                                               |

### Decisiones diferidas (sin cambio)

- **RLS parcial**: skip ahora, middleware + CI test de ownership alcanza hasta S4
- **Atlas/sqitch**: decidir cuando el tooling actual moleste (ahora es Supabase CLI)
- **schema-unification-plan.md**: archivar a `docs/archive/` con marker superseded
- **Google Maps vs OSRM**: Maps primario, OSRM variable en .env para emergencias
- **Mapbox Nav SDK**: cuando haya feedback de drivers pidiendo mejor nav UX
- **Cloudflare R2/Pages timing**: R2 y Pages en Fase 0, Tunnel en Fase 3

---

## 12. Diferido explícitamente (con trigger de re-evaluación)

| Item                            | Cuándo re-evaluar                                             |
| ------------------------------- | ------------------------------------------------------------- |
| RLS policies completas          | Cuando haya 4ta company O BI tool O agente AI con acceso a DB |
| Partitioning de `rides`         | Año 2 o >1M rides acumulados                                  |
| TimescaleDB                     | Nunca (salvo pivote de producto a telematics)                 |
| Read replica                    | Cuando "el dashboard está lento" sea queja recurrente         |
| Materialized views de analytics | Cuando admin dashboard explote en N+1                         |
| Supabase Pro upgrade            | Egress >3 GB/mes sostenido O DB >350 MB post-pruning          |
| Droplet upgrade a 2vCPU/4GB     | Antes de Supabase Pro, cuando Fastify CPU sature              |
| Self-host OSRM                  | Solo si Google Maps se vuelve prohibitivamente caro a escala  |
| Mapbox Nav SDK                  | Cuando haya feedback de drivers pidiendo mejor nav UX         |
| Unificar Prisma/Drizzle         | Después de 2-3 merges con conflictos reales                   |

---

## 13. Resumen ejecutivo (TL;DR)

**Problema:** Drivly se construyó sobre un schema legacy (control-de-horas) con partes buenas (dispatch funcional, pricing, WhatsApp bot) y partes rotas (passwords SHA-256, tokens plaintext, sin audit log, drift Drizzle/SQL).

**Diagnóstico:** El schema no necesita rewrite. Necesita **Fase 0 (parar sangría) + Fase 1 (correcciones + unificación ORM) + Fase 2 (capa financiera) + Fase 3 (compliance)** antes de que un rider real pague con su tarjeta. Features de IA avanzan en paralelo. Total base: ~3 semanas.

**Arquitectura a preservar:**

- Redis hub en Fastify para location pings (NO persistir en Postgres)
- WebSocket custom para GPS y trip offers (sin límite de conexiones)
- BullMQ para job queues (offer/search timeouts)
- Tabla `Trip` como tabla única de viajes (Drivly extiende, no reemplaza)

**Arquitectura a migrar:**

- Auth custom → **Supabase Auth** (OAuth, OTP, biométrico/PIN cada 7 días)
- Prisma (control-de-horas) → **Drizzle** (ORM unificado)
- migrate.ts custom → **Supabase CLI** (+ Drizzle generate + CI diff check)

**Arquitectura a agregar:**

- 8-10 tablas nuevas (fare breakdown, ledger, payouts, audit, incidents, driver docs, notifications)
- ~15 columnas en Trip (compliance, idempotency, cancellation reasons)
- Constraints y CHECK que debieron existir desde el día 1
- PostGIS real (no text masquerading)
- Audit log con hash-chain tamper-evident
- Storage híbrido: Supabase Storage (liviano) + Cloudflare R2 (pesado)

**Arquitectura a NO tocar:**

- Partitioning, TimescaleDB, RLS completo, read replicas, materialized views, location pings en PG

---

## 14. Referencias

### Schemas auditados

- `C:/Users/user/Documents/Projects/excellent-taxi/control-de-horas/packages/backend/prisma/schema.prisma`
- `C:/Users/user/Documents/Projects/confi-tec/taxi-app/packages/db/src/schema/index.ts`
- `C:/Users/user/Documents/Projects/confi-tec/taxi-app/packages/db/src/migrations/*.sql`

### Docs relacionados

- `C:/Users/user/Documents/Projects/confi-tec/taxi-app/docs/schema-unification-plan.md` (parcialmente superseded)
- `C:/Users/user/Documents/Projects/confi-tec/taxi-app/docs/droplet-capacity-analysis.md`
- `C:/Users/user/Documents/Projects/confi-tec/taxi-app/docs/adr/001-tech-stack.md`
- `C:/Users/user/Documents/Projects/confi-tec/taxi-app/CLAUDE.md` (contiene línea P0-1: SHA-256)
- `C:/Users/user/Documents/Projects/excellent-taxi/control-de-horas/CLAUDE.md` (8 capas de seguridad documentadas)

### Agentes de auditoría (2026-04-11)

Los 4 agentes especializados dejaron reportes completos en los task logs:

- Ride-hailing domain benchmark
- PostgreSQL DBA quality audit
- Scale/performance projection S1→S5
- Security/compliance audit

### Stack de servicios free decidido en investigación previa

- **Storage:** Cloudflare R2 (10 GB free, zero egress)
- **Admin hosting:** Cloudflare Pages (unlimited req, 500 builds/mo)
- **API tunnel:** Cloudflare Tunnel + Zero Trust (50 users free)
- **Monitoring:** Grafana Cloud free (50 GB logs, 10k metrics, 50 GB traces — underused)
- **Errors:** Sentry free (5k errors, 50 replays)
- **Uptime:** Better Stack free (10 monitors + status page)
- **Analytics + flags + replay:** PostHog free (1M events)
- **Email:** AWS SES ($0.10/1k)
- **Maps:** Google Maps Platform (primario, con $200/mo credit) + posible Mapbox Nav SDK

---

**Próximo paso:** ejecutar Fase 0 (parar sangría) + iniciar Fase 5 (auth móvil) en paralelo. Features IA avanzan simultáneamente.
