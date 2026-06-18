# Phase 11 Licence Compliance Report

> Date: 2026-06-18
> Status: Complete
> Stage: 9 — Open-Source Release Preparation

---

## 1. Root licence

The root `LICENSE` file is **GNU Affero General Public License v3.0 (AGPL-3.0)**. Verified present and unmodified.

## 2. Workspace `package.json` licence fields

All 14 workspace packages carry `"license": "AGPL-3.0-or-later"`. Verified by automated scan:

| Package | Licence field |
|---|---|
| `revelation-srs` (root) | `AGPL-3.0-or-later` |
| `@revelation-srs/api` | `AGPL-3.0-or-later` |
| `@revelation-srs/admin` | `AGPL-3.0-or-later` |
| `@revelation-srs/portal` | `AGPL-3.0-or-later` |
| `@revelation-srs/wellbeing` | `AGPL-3.0-or-later` |
| `@revelation-srs/vle-connector` | `AGPL-3.0-or-later` |
| `@revelation-srs/domain` | `AGPL-3.0-or-later` |
| `@revelation-srs/db` | `AGPL-3.0-or-later` |
| `@revelation-srs/ui` | `AGPL-3.0-or-later` |
| `@revelation-srs/auth` | `AGPL-3.0-or-later` |
| `@revelation-srs/workflow` | `AGPL-3.0-or-later` |
| `@revelation-srs/demo-data` | `AGPL-3.0-or-later` |
| `@revelation-srs/testing` | `AGPL-3.0-or-later` |
| `@revelation-srs/migration-tools` | `AGPL-3.0-or-later` |

Per the Stage 0 decision, no per-file copyright headers are required. The AGPL notice is in the root `LICENSE` file.

## 3. Third-party dependency licence scan

### Compatibility matrix

AGPL v3 is compatible with: MIT, BSD-2-Clause, BSD-3-Clause, ISC, Apache-2.0, and MPL-2.0. It is incompatible with proprietary licences.

### Runtime dependencies

| Dependency | Licence | Compatible |
|---|---|---|
| `fastify` | MIT | Yes |
| `@fastify/cors`, `@fastify/helmet`, `@fastify/jwt`, `@fastify/rate-limit`, `@fastify/swagger`, `@fastify/swagger-ui` | MIT | Yes |
| `drizzle-orm` | Apache-2.0 | Yes |
| `nats` (NATS.js client) | Apache-2.0 | Yes |
| `pino` | MIT | Yes |
| `@sinclair/typebox` | MIT | Yes |
| `fastify-plugin` | MIT | Yes |
| `@opentelemetry/sdk-node`, `@opentelemetry/api`, `@opentelemetry/auto-instrumentations-node` | Apache-2.0 | Yes |
| `react`, `react-dom` | MIT | Yes |
| `@radix-ui/*` | MIT | Yes |
| `tailwindcss` | MIT | Yes |
| `vite` | MIT | Yes |
| `@temporalio/client`, `@temporalio/worker`, `@temporalio/workflow` | MIT | Yes |
| `keycloak-js` | Apache-2.0 | Yes |
| `zod` | MIT | Yes |
| `i18next`, `react-i18next` | MIT | Yes |
| `@tanstack/react-query` | MIT | Yes |
| `react-router-dom` | MIT | Yes |
| `@tanstack/react-table` | MIT | Yes |

### Build and tooling dependencies (dev-only, not shipped in production artefacts)

| Dependency | Licence | Note |
|---|---|---|
| `typescript` | Apache-2.0 | Dev-only |
| `vitest` | MIT | Dev-only |
| `playwright` | Apache-2.0 | Dev-only |
| `testcontainers` | Apache-2.0 | Dev-only |
| `drizzle-kit` | Apache-2.0 | Dev-only |
| `eslint` and plugins | MIT / Apache-2.0 | Dev-only |
| `@lhci/cli` | Apache-2.0 | Dev-only |
| `k6` | AGPL-3.0 | External binary, not bundled |
| `axe-core` | MPL-2.0 | Dev-only |

### Infrastructure components (operator-provided, not bundled in release artefacts)

| Component | Licence | Note |
|---|---|---|
| PostgreSQL | PostgreSQL Licence (BSD-like) | Operator-provided |
| NATS Server | Apache-2.0 | Operator-provided |
| Temporal Server | MIT | Operator-provided |
| Keycloak | Apache-2.0 | Operator-provided |
| OpenBao | MPL-2.0 | Operator-provided; compatible with AGPL v3 |
| Prometheus | Apache-2.0 | Operator-provided |
| Grafana | AGPL-3.0 | Operator-provided; same licence |
| Loki | AGPL-3.0 | Operator-provided; same licence |
| Grafana Tempo | AGPL-3.0 | Operator-provided; same licence |
| nginx | BSD-2-Clause | Used in production Docker images for portal and admin |

## 4. Findings

**No incompatible licences found.**

All runtime dependencies use MIT, Apache-2.0, BSD-2-Clause, or MPL-2.0 licences, all of which are compatible with AGPL v3. Infrastructure components are operator-provided and not bundled in release artefacts.

OpenBao (MPL-2.0) was explicitly reviewed at Stage 0 and confirmed compatible.

k6 is an external load testing binary used in CI only; it is not bundled into any production artefact and does not affect the AGPL compatibility of the released software.

## 5. Disposition

| Category | Count | Issues |
|---|---|---|
| Workspace packages with `AGPL-3.0-or-later` | 14/14 | None |
| Runtime dependencies scanned | ~40 | None |
| Incompatible licences found | 0 | — |
| Exceptions accepted | 0 | — |

**Exit criterion met**: licence compatibility check is clean. No AGPL-incompatible runtime dependencies are present.
