# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Copy workspace manifests first for better layer caching
COPY package.json package-lock.json ./
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/

RUN npm ci

# Copy source
COPY tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/

# Build
RUN npm run build -w apps/api
RUN npm run build -w packages/db
RUN npm run build -w packages/shared

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

# Only production deps
COPY package.json package-lock.json ./
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/

RUN npm ci --omit=dev

# Copy compiled output
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "apps/api/dist/index.js"]
