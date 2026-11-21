# Image for the attendance and engagement service (modules/attendance), built like the API image (BL-176): install and build
# only this package and the workspace packages it imports, then `pnpm deploy`
# a pruned production copy with those packages inlined.

# ── Stage 1: build ─────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@revelation-srs/attendance..."
RUN pnpm --filter "@revelation-srs/attendance..." build
RUN pnpm --filter @revelation-srs/attendance deploy --prod --ignore-scripts /out

# ── Stage 2: production image ──────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

# Non-root user
RUN groupadd --system srs && useradd --system --gid srs srs
# The runtime needs only node: drop the bundled npm, npx and corepack (and their advisories).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
WORKDIR /app

COPY --from=build --chown=srs:srs /out ./

USER srs
EXPOSE 3004

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://localhost:3004/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", "dist/main.js"]
