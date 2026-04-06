#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Drivly — Droplet Setup Script (DigitalOcean)
# ═══════════════════════════════════════════════════════════════════════════════
#
# Prerequisitos verificados:
#   - Ubuntu 20.04, 1 vCPU, 2GB RAM, 70GB disco
#   - Node.js v22, pnpm 10.x, PM2 5.x, nginx 1.18, git 2.25
#   - PostgreSQL 12 corriendo en :5432
#   - PostGIS 3.0 instalado (postgresql-12-postgis-3)
#   - Redis 5.0.7 corriendo en :6379
#   - Excellent Taxi corriendo en PM2 (puertos 3000, 3001, 3002)
#
# Uso:
#   1. Editar las variables de configuración abajo
#   2. Copiar al droplet: scp droplet-setup-drivly.sh root@<IP>:~/
#   3. chmod +x ~/droplet-setup-drivly.sh
#   4. Ejecutar por secciones (copiar y pegar) o todo de una vez
#
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ─── VARIABLES DE CONFIGURACIÓN (editar antes de ejecutar) ───────────────────

DB_NAME="drivly"
DB_USER="drivly"
DB_PASS="CAMBIA_ESTE_PASSWORD"          # ← Genera uno seguro: openssl rand -base64 24
JWT_SECRET="CAMBIA_ESTE_SECRETO"        # ← Genera uno seguro: openssl rand -base64 32

# Supabase — necesario para los scripts de migración Phase 2
# Formato: postgresql://user:pass@host:5432/dbname
SUPABASE_DATABASE_URL=""                # ← URL de la DB de Supabase (read-only)

# WhatsApp bot — ya corre en el droplet como taxi-whatsapp (puerto 3002)
WHATSAPP_BOT_URL="http://localhost:3002"
INTERNAL_API_SECRET=""                  # ← Secret compartido con el bot de WhatsApp

# APIs externas (pueden quedar vacías inicialmente)
GOOGLE_MAPS_API_KEY=""
STRIPE_SECRET_KEY=""
STRIPE_WEBHOOK_SECRET=""
EXPO_ACCESS_TOKEN=""

# Git
GIT_REPO="https://github.com/rafael1599/taxi-app.git"
GIT_BRANCH="desk"
DEPLOY_DIR="/var/www/drivly"

# Puertos — Drivly usa 4000 para no chocar con Excellent Taxi (3000)
DRIVLY_PORT=4000

# Dominio (para nginx). Dejar vacío si aún no hay dominio.
DRIVLY_DOMAIN=""                        # ← ej: api.drivly.com

# ─── COLORES ─────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; }
step() { echo -e "\n${CYAN}═══ $1 ═══${NC}\n"; }

# ═════════════════════════════════════════════════════════════════════════════
# STEP 0 — Pre-flight Checks
# ═════════════════════════════════════════════════════════════════════════════

step "STEP 0: Pre-flight checks"

# Verificar que corremos como root (necesario para sudo -u postgres, systemctl, etc.)
if [[ $EUID -ne 0 ]]; then
  err "Este script debe ejecutarse como root"
  exit 1
fi

# Verificar variables obligatorias
if [[ "$DB_PASS" == "CAMBIA_ESTE_PASSWORD" ]]; then
  err "Debes cambiar DB_PASS antes de ejecutar. Genera uno con: openssl rand -base64 24"
  exit 1
fi

if [[ "$JWT_SECRET" == "CAMBIA_ESTE_SECRETO" ]]; then
  err "Debes cambiar JWT_SECRET antes de ejecutar. Genera uno con: openssl rand -base64 32"
  exit 1
fi

# Verificar servicios
for cmd in node pnpm pm2 git nginx psql redis-cli; do
  if command -v "$cmd" &>/dev/null; then
    log "$cmd encontrado: $(command -v "$cmd")"
  else
    err "$cmd NO encontrado. Instálalo antes de continuar."
    exit 1
  fi
done

# Verificar PostgreSQL corriendo
if sudo systemctl is-active --quiet postgresql; then
  log "PostgreSQL está corriendo"
else
  err "PostgreSQL no está corriendo. Inícialo con: sudo systemctl start postgresql"
  exit 1
fi

# Verificar Redis corriendo
if sudo systemctl is-active --quiet redis-server; then
  log "Redis está corriendo en :6379"
else
  err "Redis no está corriendo. Inícialo con: sudo systemctl start redis-server"
  exit 1
fi

# Verificar que Excellent Taxi sigue corriendo (no romper nada)
if pm2 pid taxi-backend &>/dev/null && [[ $(pm2 pid taxi-backend) -gt 0 ]]; then
  log "Excellent Taxi (taxi-backend) corriendo OK en PM2"
else
  warn "taxi-backend no detectado en PM2. Verifica con: pm2 list"
fi

# Verificar que puerto 4000 está libre
if ss -tlnp | grep -q ":${DRIVLY_PORT} "; then
  err "Puerto ${DRIVLY_PORT} ya está en uso. Revisa con: ss -tlnp | grep :${DRIVLY_PORT}"
  exit 1
fi
log "Puerto ${DRIVLY_PORT} está libre"

# Verificar versión de Node >= 22
NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  err "Node.js >= 22 requerido. Actual: $(node -v)"
  exit 1
fi
log "Node.js $(node -v) OK"

echo ""
log "Pre-flight checks completados"

# ═════════════════════════════════════════════════════════════════════════════
# STEP 1 — PostgreSQL: crear DB, usuario y extensiones
# ═════════════════════════════════════════════════════════════════════════════

step "STEP 1: PostgreSQL — crear DB, usuario y extensiones"

# Verificar si el usuario ya existe
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
  warn "Usuario '${DB_USER}' ya existe, actualizando password..."
  sudo -u postgres psql -c "ALTER USER ${DB_USER} WITH PASSWORD '${DB_PASS}';"
else
  sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';"
  log "Usuario '${DB_USER}' creado"
fi

# Verificar si la DB ya existe
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  warn "Database '${DB_NAME}' ya existe, saltando creación..."
else
  sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"
  log "Database '${DB_NAME}' creada"
fi

# Permisos
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"

# Extensiones (deben crearse como superuser en la DB target)
sudo -u postgres psql -d "${DB_NAME}" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"
sudo -u postgres psql -d "${DB_NAME}" -c "CREATE EXTENSION IF NOT EXISTS postgis;"

# Verificar extensiones
log "Extensiones instaladas:"
sudo -u postgres psql -d "${DB_NAME}" -c "SELECT extname, extversion FROM pg_extension WHERE extname IN ('pgcrypto', 'postgis');"

# Verificar que pg_hba.conf permite conexión por password via TCP (localhost)
# Por defecto en Ubuntu 20.04, las conexiones TCP (host) usan md5 — esto debería funcionar
PG_HBA=$(sudo -u postgres psql -tAc "SHOW hba_file")
if grep -qE "^host\s+all\s+all\s+127\.0\.0\.1" "$PG_HBA"; then
  log "pg_hba.conf permite conexiones TCP desde localhost"
else
  warn "pg_hba.conf podría no permitir conexiones TCP. Verificar manualmente:"
  warn "  sudo cat $PG_HBA | grep -v '^#' | grep -v '^\$'"
fi

# Test de conexión con password via TCP
if PGPASSWORD="${DB_PASS}" psql -h 127.0.0.1 -U "${DB_USER}" -d "${DB_NAME}" -c "SELECT 1;" &>/dev/null; then
  log "Conexión via TCP con password: OK"
else
  err "No se pudo conectar via TCP con password."
  err "Revisa pg_hba.conf (${PG_HBA}) — la línea para host/127.0.0.1 debe usar md5 o scram-sha-256"
  err "Después: sudo systemctl reload postgresql"
  exit 1
fi

# ═════════════════════════════════════════════════════════════════════════════
# STEP 2 — Clonar/actualizar repositorio
# ═════════════════════════════════════════════════════════════════════════════

step "STEP 2: Clonar/actualizar repositorio"

if [[ -d "${DEPLOY_DIR}/.git" ]]; then
  warn "Repositorio ya existe en ${DEPLOY_DIR}"
  cd "${DEPLOY_DIR}"
  CURRENT_BRANCH=$(git branch --show-current)
  if [[ "$CURRENT_BRANCH" != "$GIT_BRANCH" ]]; then
    warn "Branch actual es '${CURRENT_BRANCH}', cambiando a '${GIT_BRANCH}'..."
    git fetch origin
    git checkout "${GIT_BRANCH}"
  fi
  git pull origin "${GIT_BRANCH}"
  log "Repositorio actualizado en branch '${GIT_BRANCH}'"
else
  git clone --branch "${GIT_BRANCH}" "${GIT_REPO}" "${DEPLOY_DIR}"
  log "Repositorio clonado en ${DEPLOY_DIR} (branch: ${GIT_BRANCH})"
fi

cd "${DEPLOY_DIR}"

# Ajustar ownership (mismo usuario que Excellent Taxi usa)
if id "github" &>/dev/null; then
  chown -R github:github "${DEPLOY_DIR}"
  log "Ownership set to github:github"
fi

# ═════════════════════════════════════════════════════════════════════════════
# STEP 3 — Instalar dependencias
# ═════════════════════════════════════════════════════════════════════════════

step "STEP 3: Instalar dependencias (pnpm install)"

cd "${DEPLOY_DIR}"
pnpm install --frozen-lockfile
log "Dependencias instaladas"

# ═════════════════════════════════════════════════════════════════════════════
# STEP 4 — Crear archivo .env de producción
# ═════════════════════════════════════════════════════════════════════════════

step "STEP 4: Crear archivo .env"

ENV_FILE="${DEPLOY_DIR}/.env"

if [[ -f "$ENV_FILE" ]]; then
  warn ".env ya existe. Creando backup: .env.bak.$(date +%s)"
  cp "$ENV_FILE" "${ENV_FILE}.bak.$(date +%s)"
fi

cat > "$ENV_FILE" <<ENVEOF
# ═══ Drivly Production Environment ═══
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")

# ─── Database ─────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}

# ─── Redis ────────────────────────────────────────────────────────────────────
REDIS_URL=redis://localhost:6379

# ─── App ──────────────────────────────────────────────────────────────────────
JWT_SECRET=${JWT_SECRET}
PORT=${DRIVLY_PORT}
NODE_ENV=production
API_BASE_URL=http://localhost:${DRIVLY_PORT}

# ─── Supabase (legacy — read-only, needed for migration scripts) ─────────────
SUPABASE_DATABASE_URL=${SUPABASE_DATABASE_URL}

# ─── WhatsApp Bot (OTP delivery — shared with Excellent Taxi) ─────────────────
WHATSAPP_BOT_URL=${WHATSAPP_BOT_URL}
INTERNAL_API_SECRET=${INTERNAL_API_SECRET}

# ─── Google Maps ──────────────────────────────────────────────────────────────
GOOGLE_MAPS_API_KEY=${GOOGLE_MAPS_API_KEY}

# ─── Stripe ───────────────────────────────────────────────────────────────────
STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}
STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET}
STRIPE_CONNECT_WEBHOOK_SECRET=

# ─── Expo Push ────────────────────────────────────────────────────────────────
EXPO_ACCESS_TOKEN=${EXPO_ACCESS_TOKEN}

# ─── Sentry ───────────────────────────────────────────────────────────────────
SENTRY_DSN=
ENVEOF

# Permisos restrictivos (contiene secretos)
chmod 600 "$ENV_FILE"
log ".env creado en ${ENV_FILE} (permisos 600)"

# ═════════════════════════════════════════════════════════════════════════════
# STEP 5 — Ejecutar migraciones de DB
# ═════════════════════════════════════════════════════════════════════════════

step "STEP 5: Ejecutar migraciones de DB (schema)"

cd "${DEPLOY_DIR}"
pnpm db:migrate
log "Migraciones de schema ejecutadas"

# Verificar que las tablas existen
TABLES=$(PGPASSWORD="${DB_PASS}" psql -h 127.0.0.1 -U "${DB_USER}" -d "${DB_NAME}" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';")
log "Tablas creadas en DB: ${TABLES}"

# Verificar PostGIS funciona
POSTGIS_VER=$(PGPASSWORD="${DB_PASS}" psql -h 127.0.0.1 -U "${DB_USER}" -d "${DB_NAME}" -tAc \
  "SELECT postgis_version();" 2>/dev/null || echo "ERROR")
log "PostGIS version: ${POSTGIS_VER}"

# Verificar gen_random_uuid() funciona (via pgcrypto en PG 12)
UUID_TEST=$(PGPASSWORD="${DB_PASS}" psql -h 127.0.0.1 -U "${DB_USER}" -d "${DB_NAME}" -tAc \
  "SELECT gen_random_uuid();" 2>/dev/null || echo "ERROR")
log "gen_random_uuid() test: ${UUID_TEST}"

# ═════════════════════════════════════════════════════════════════════════════
# STEP 6 — Ejecutar scripts de migración Phase 2 (Supabase → local)
# ═════════════════════════════════════════════════════════════════════════════

step "STEP 6: Migración Phase 2 — datos de Supabase → local"

if [[ -z "$SUPABASE_DATABASE_URL" ]]; then
  warn "SUPABASE_DATABASE_URL está vacía. Saltando Phase 2."
  warn "Para ejecutar después:"
  warn "  cd ${DEPLOY_DIR}"
  warn "  pnpm db:migrate-price-overrides"
  warn "  pnpm db:migrate-drivers"
else
  log "Ejecutando Phase 2a: PriceOverrides → fixed_routes..."
  pnpm db:migrate-price-overrides

  log "Ejecutando Phase 2b: Drivers → drivers..."
  pnpm db:migrate-drivers

  log "Phase 2 completada"
fi

# ═════════════════════════════════════════════════════════════════════════════
# STEP 7 — Build de producción
# ═════════════════════════════════════════════════════════════════════════════

step "STEP 7: Build de producción"

cd "${DEPLOY_DIR}"

# Build API (TypeScript → JavaScript)
pnpm --filter @drivly/api build
log "API build completado (apps/api/dist/)"

# Build Admin Dashboard (Vite → static files)
pnpm --filter @drivly/admin build
log "Admin dashboard build completado (apps/admin/dist/)"

# ═════════════════════════════════════════════════════════════════════════════
# STEP 8 — PM2: registrar Drivly API
# ═════════════════════════════════════════════════════════════════════════════

step "STEP 8: PM2 — registrar Drivly API"

# Detener si ya existe
pm2 delete drivly-api 2>/dev/null || true

pm2 start "${DEPLOY_DIR}/apps/api/dist/index.js" \
  --name "drivly-api" \
  --cwd "${DEPLOY_DIR}" \
  --env "${ENV_FILE}" \
  --node-args="--env-file=${ENV_FILE}" \
  --max-memory-restart "200M" \
  --time

# Esperar un momento y verificar que arrancó
sleep 3

if pm2 pid drivly-api &>/dev/null && [[ $(pm2 pid drivly-api) -gt 0 ]]; then
  log "drivly-api corriendo en PM2 (puerto ${DRIVLY_PORT})"
else
  err "drivly-api no arrancó. Revisar logs:"
  err "  pm2 logs drivly-api --lines 50"
  exit 1
fi

# Health check
if curl -sf "http://localhost:${DRIVLY_PORT}/health" &>/dev/null; then
  log "Health check OK: http://localhost:${DRIVLY_PORT}/health"
else
  warn "Health check falló. Puede ser normal si Redis/DB necesitan un momento."
  warn "Verificar con: curl http://localhost:${DRIVLY_PORT}/health"
fi

# Guardar config de PM2 para auto-start
pm2 save
log "PM2 config guardada (auto-restart on reboot)"

# ═════════════════════════════════════════════════════════════════════════════
# STEP 9 — Nginx: configurar reverse proxy + static files
# ═════════════════════════════════════════════════════════════════════════════

step "STEP 9: Nginx — configurar reverse proxy"

# Solo crear config si hay dominio definido
if [[ -z "$DRIVLY_DOMAIN" ]]; then
  warn "DRIVLY_DOMAIN no configurado. Saltando nginx."
  warn "Cuando tengas el dominio, crea la config manualmente:"
  warn "  /etc/nginx/sites-available/drivly"
  warn "Ejemplo de config generado en: ${DEPLOY_DIR}/docs/nginx-drivly.conf"

  # Generar config de referencia
  cat > "${DEPLOY_DIR}/docs/nginx-drivly.conf" <<'NGINXEOF'
# Drivly — Nginx config (copiar a /etc/nginx/sites-available/drivly)
# Luego: ln -s /etc/nginx/sites-available/drivly /etc/nginx/sites-enabled/
# Y: sudo certbot --nginx -d TU_DOMINIO_API -d TU_DOMINIO_ADMIN

# API (reverse proxy a PM2)
server {
    listen 80;
    server_name api.TUDOMINIO.com;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;  # WebSocket keepalive
    }
}

# Admin Dashboard (static files)
server {
    listen 80;
    server_name admin.TUDOMINIO.com;

    root /var/www/drivly/apps/admin/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
NGINXEOF
  log "Config de referencia guardada en docs/nginx-drivly.conf"
else
  NGINX_CONF="/etc/nginx/sites-available/drivly"

  cat > "$NGINX_CONF" <<NGINXEOF
# Drivly API — reverse proxy to PM2
server {
    listen 80;
    server_name ${DRIVLY_DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:${DRIVLY_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400;
    }
}
NGINXEOF

  # Habilitar site
  ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/drivly

  # Test config
  if nginx -t 2>/dev/null; then
    systemctl reload nginx
    log "Nginx configurado y recargado para ${DRIVLY_DOMAIN}"
    warn "Falta SSL. Ejecuta: sudo certbot --nginx -d ${DRIVLY_DOMAIN}"
  else
    err "Nginx config inválida. Revisar: $NGINX_CONF"
    nginx -t
    exit 1
  fi
fi

# ═════════════════════════════════════════════════════════════════════════════
# STEP 10 — Resumen final
# ═════════════════════════════════════════════════════════════════════════════

step "SETUP COMPLETADO"

echo -e "
${GREEN}╔══════════════════════════════════════════════════════════════════╗
║                    Drivly — Deploy Summary                     ║
╚══════════════════════════════════════════════════════════════════╝${NC}

  ${CYAN}Servicios:${NC}
    API:             http://localhost:${DRIVLY_PORT}
    Health:          http://localhost:${DRIVLY_PORT}/health
    API Docs:        http://localhost:${DRIVLY_PORT}/docs
    Admin Dashboard: ${DEPLOY_DIR}/apps/admin/dist/ (static)

  ${CYAN}Base de datos:${NC}
    PostgreSQL 12:   localhost:5432/${DB_NAME} (user: ${DB_USER})
    PostGIS:         $(PGPASSWORD="${DB_PASS}" psql -h 127.0.0.1 -U "${DB_USER}" -d "${DB_NAME}" -tAc "SELECT postgis_version();" 2>/dev/null || echo "verificar")
    Redis:           localhost:6379

  ${CYAN}PM2:${NC}
    $(pm2 list 2>/dev/null | grep -E "drivly|taxi" || echo "    pm2 list para ver procesos")

  ${CYAN}Archivos:${NC}
    Código:          ${DEPLOY_DIR}
    .env:            ${DEPLOY_DIR}/.env
    Logs:            pm2 logs drivly-api

  ${CYAN}Próximos pasos:${NC}
    1. Verificar health: curl http://localhost:${DRIVLY_PORT}/health
    2. Configurar dominio DNS → IP del droplet
    3. Configurar nginx con dominio (docs/nginx-drivly.conf)
    4. SSL: sudo certbot --nginx -d <dominio>
    5. Ejecutar Phase 3 (RRHH): pnpm db:migrate-hr (cuando el script exista)

  ${YELLOW}Excellent Taxi sigue corriendo sin cambios en puertos 3000/3001/3002${NC}
"
