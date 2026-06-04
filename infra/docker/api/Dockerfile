# ── Stage 1: dependencies ──────────────────────────────────────────────────────
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Copy workspace manifests only (cache busts only when deps change)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/domain/package.json  ./packages/domain/
COPY packages/db/package.json      ./packages/db/
COPY packages/auth/package.json    ./packages/auth/
COPY packages/workflow/package.json ./packages/workflow/
COPY apps/api/package.json         ./apps/api/

RUN pnpm install --frozen-lockfile --prod=false

# ── Stage 2: build ─────────────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/domain/  ./packages/domain/
COPY packages/db/      ./packages/db/
COPY packages/auth/    ./packages/auth/
COPY packages/workflow/ ./packages/workflow/
COPY apps/api/         ./apps/api/

RUN pnpm -r build

# ── Stage 3: production image ──────────────────────────────────────────────────
FROM node:22-alpine AS runtime

# Non-root user
RUN addgroup -S srs && adduser -S srs -G srs
WORKDIR /app

# Production-only node_modules
COPY --from=build /app/node_modules      ./node_modules
COPY --from=build /app/packages/domain/dist  ./packages/domain/dist
COPY --from=build /app/packages/db/dist      ./packages/db/dist
COPY --from=build /app/packages/auth/dist    ./packages/auth/dist
COPY --from=build /app/packages/workflow/dist ./packages/workflow/dist
COPY --from=build /app/apps/api/dist         ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/

USER srs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "apps/api/dist/main.js"]
