# ── Stage 1: build ─────────────────────────────────────────────────────────────
# Installs and builds only the admin and the workspace packages it imports.
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@revelation-srs/admin..."
RUN pnpm --filter "@revelation-srs/admin..." build

# ── Stage 2: production image ──────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

COPY infra/docker/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost/index.html || exit 1
