# ── Stage 1: dependencies ──────────────────────────────────────────────────────
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

# Copy workspace manifests only (cache busts only when deps change)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/ui/package.json     ./packages/ui/
COPY apps/admin/package.json      ./apps/admin/

RUN pnpm install --frozen-lockfile --prod=false

# ── Stage 2: build ─────────────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/ui/      ./packages/ui/
COPY apps/admin/       ./apps/admin/

# Vite reads UI sources via path alias — no pre-build of packages/ui required
RUN pnpm --filter @revelation-srs/admin build

# ── Stage 3: production image ──────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

COPY infra/docker/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost/index.html || exit 1
