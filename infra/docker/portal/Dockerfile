# ── Stage 1: build ─────────────────────────────────────────────────────────────
# Installs and builds only the portal and the workspace packages it imports.
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@revelation-srs/portal..."
RUN pnpm --filter "@revelation-srs/portal..." build

# ── Stage 2: production image ──────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

COPY infra/docker/portal/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/portal/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost/index.html || exit 1
