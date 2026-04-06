# Droplet Capacity Analysis — Drivly + Excellent Taxi

**Fecha:** 2026-04-06
**Droplet:** DO-Premium-Intel, ubuntu-s-1vcpu-2gb-70gb-intel-nyc1-01
**Uptime:** 765 días

---

## Estado actual del droplet

### Hardware

| Recurso | Total   | Usado                   | Disponible  |
| ------- | ------- | ----------------------- | ----------- |
| CPU     | 1 vCPU  | 0% idle (load avg 0.04) | ~100% libre |
| RAM     | 1.9 GiB | 516 MiB                 | 1.2 GiB     |
| Swap    | 2.0 GiB | 252 MiB                 | 1.8 GiB     |
| Disco   | 68 GB   | 19 GB (28%)             | 50 GB       |

### Procesos PM2 actuales (Excellent Taxi)

| Proceso                     | RAM         | CPU    | Puerto |
| --------------------------- | ----------- | ------ | ------ |
| taxi-backend (Express)      | 86.9 MB     | 0%     | 3000   |
| taxi-frontend (Nuxt SSR)    | 135.3 MB    | 0%     | 3001   |
| taxi-whatsapp (baileys bot) | 89.6 MB     | 0%     | 3002   |
| **Total Excellent**         | **~312 MB** | **0%** | —      |

### Servicios del sistema

| Servicio         | Estado                |
| ---------------- | --------------------- |
| nginx            | ✅ Corriendo (80/443) |
| PostgreSQL local | ❌ No instalado       |
| Redis            | ❌ No instalado       |
| Docker           | ❌ No instalado       |
| Node.js          | v22.22.0              |

### Disco por proyecto

| Ruta                      | Tamaño      | node_modules |
| ------------------------- | ----------- | ------------ |
| /var/www/control-de-horas | 735 MB      | 726 MB       |
| /var/www/excellent-app-fe | 617 MB      | 435 MB       |
| **Total**                 | **1.35 GB** | **1.16 GB**  |

---

## Lo que Drivly necesita

### Procesos nuevos

| Componente           | RAM estimada   | Puerto |
| -------------------- | -------------- | ------ |
| drivly-api (Fastify) | 80–120 MB      | 4000   |
| PostgreSQL + PostGIS | 100–200 MB     | 5432   |
| Redis                | 30–50 MB       | 6379   |
| **Total Drivly**     | **210–370 MB** | —      |

### Notas

- **Admin dashboard (React + Vite)**: build estático, servido por nginx. No necesita proceso PM2.
- **Driver/Rider apps**: React Native/Expo, corren en los teléfonos. No consumen recursos del servidor.
- **Bot de WhatsApp**: se comparte con Excellent (mismo proceso en puerto 3002). 0 MB adicional.

### Disco adicional

| Componente                              | Estimado         |
| --------------------------------------- | ---------------- |
| /var/www/drivly (código + node_modules) | ~800 MB – 1 GB   |
| PostgreSQL data (base + PostGIS)        | ~200 MB – 500 MB |
| Redis data                              | < 10 MB          |
| **Total**                               | **~1 – 1.5 GB**  |

---

## Proyección con ambos proyectos

### RAM

| Componente                      | RAM                |
| ------------------------------- | ------------------ |
| Sistema operativo + nginx + SSH | ~200 MB            |
| Excellent Taxi (3 procesos PM2) | ~312 MB            |
| Drivly API (1 proceso PM2)      | ~100 MB            |
| PostgreSQL + PostGIS            | ~150 MB            |
| Redis                           | ~40 MB             |
| **Total estimado**              | **~800 MB**        |
| **Disponible (de 1.9 GiB)**     | **~1.1 GiB libre** |
| **Margen de seguridad**         | **~58% libre**     |

### CPU

La carga actual es prácticamente 0 (load avg 0.04). Drivly con tráfico bajo
(1 company, 2 drivers, ~10 admins) no va a mover la aguja. La única operación
CPU-intensive sería bcrypt hashing en login, que es esporádica.

**Veredicto CPU: sobra.**

### Disco

| Concepto                    | Valor    |
| --------------------------- | -------- |
| Usado hoy                   | 19 GB    |
| Excellent + Drivly estimado | +1.5 GB  |
| Total proyectado            | ~20.5 GB |
| Espacio libre               | ~48 GB   |

**Veredicto disco: sobra.**

---

## Veredicto final

### ✅ EL DROPLET AGUANTA AMBOS PROYECTOS

Con 1.1 GiB de RAM libre después de correr todo, 48 GB de disco disponible,
y CPU prácticamente sin carga, el droplet tiene capacidad de sobra para la
escala actual (1 empresa, 2 drivers, ~10 admins, tráfico bajo-medio).

### Lo que hay que instalar

1. **PostgreSQL 16 + PostGIS 3.4** — instalación nativa (no Docker, no está disponible)
2. **Redis** — instalación nativa
3. **Configuración de nginx** — nuevo server block para el dominio de Drivly API

### Limitación a futuro

El cuello de botella será la RAM si:

- Se agregan más empresas al white-label (más conexiones a PostgreSQL)
- El tráfico sube significativamente (más procesos PM2 o clustering)
- Se activa monitoreo (Sentry, Prometheus, etc.)

**Recomendación**: si el negocio crece y necesitan más de ~3-4 empresas activas
simultáneamente, upgrade al droplet de 4 GB RAM ($24/mes → $48/mes).

---

## Alertas secundarias

### 1. taxi-backend tiene 325,091 restarts

Esto indica un proceso inestable históricamente (crash loops). El uptime actual
es de 4 días, así que se estabilizó recientemente, pero vale la pena investigar
la causa raíz (posiblemente el error de `pickupLat must not be null` en los logs).

### 2. Intentos de escaneo en taxi-frontend

Los logs muestran requests a `/wp-content/`, `/file.php`, `/.env` — son bots
escaneando vulnerabilidades WordPress/PHP. No es un problema real, pero se podría
agregar un rate limiter o bloqueo en nginx para esas rutas.

### 3. Errores "Bad MAC" en taxi-whatsapp

Son errores de sesión de baileys al descifrar mensajes. Se resuelven solos
("Closing open session in favor of incoming prekey bundle"). Es comportamiento
normal de baileys con sesiones antiguas.
