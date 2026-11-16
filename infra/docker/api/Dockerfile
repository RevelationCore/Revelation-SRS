# ── Stage 1: build ─────────────────────────────────────────────────────────────
# Installs and builds only the API and the workspace packages it imports, then
# `pnpm deploy` produces a pruned production copy with those packages inlined.
FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

# The Temporal SDK's native bridge needs glibc, so Debian slim rather than Alpine.
# Install scripts are skipped: nothing the API runs needs a native build.
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@revelation-srs/api..."
RUN pnpm --filter "@revelation-srs/api..." build
RUN pnpm --filter @revelation-srs/api deploy --prod --ignore-scripts /out

# ── Stage 2: production image ──────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

# Non-root user
RUN groupadd --system srs && useradd --system --gid srs srs
# The runtime needs only node: drop the bundled npm, npx and corepack (and their advisories).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
WORKDIR /app

COPY --from=build --chown=srs:srs /out ./

USER srs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://localhost:3000/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", "dist/main.js"]
