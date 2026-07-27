# Technology Stack

> All components are open source and free to use under this project's AGPL v3 licence.
> Detailed rationale and alternatives considered for each decision are in the individual ADRs.

## Summary

| Concern | Technology | Licence | ADR |
|---|---|---|---|
| Language / runtime | TypeScript + Node.js 22 LTS | MIT | ADR-001 |
| API framework | Fastify | MIT | ADR-002 |
| Database | PostgreSQL 16 | PostgreSQL Licence | ADR-003 |
| ORM / migrations | Drizzle ORM + drizzle-kit | Apache 2.0 | ADR-003 |
| Message broker | NATS JetStream | Apache 2.0 | ADR-004 |
| Workflow engine | Temporal | MIT | ADR-005 |
| Identity provider | Keycloak (Quarkus distribution) | Apache 2.0 | ADR-006 |
| Frontend framework | React 18 + TypeScript + Vite | MIT | ADR-007 |
| UI component primitives | Radix UI | MIT | ADR-007 |
| CSS / styling | Tailwind CSS | MIT | ADR-007 |
| Observability — instrumentation | OpenTelemetry (Node.js SDK) | Apache 2.0 | ADR-008 |
| Observability — metrics | Prometheus + Alertmanager | Apache 2.0 | ADR-008 |
| Observability — dashboards / alerting | Grafana | AGPL v3 | ADR-008 |
| Observability — log aggregation | Grafana Loki + Promtail | AGPL v3 | ADR-008 |
| Test runner | Vitest | MIT | ADR-009 |
| Integration test infrastructure | Testcontainers (Node.js) | Apache 2.0 | ADR-009 |
| HTTP API testing | Supertest | MIT | ADR-009 |
| Contract testing | Dredd | MIT | ADR-009 |
| E2E browser testing | Playwright | Apache 2.0 | ADR-009 |
| Accessibility testing | axe-core + @axe-core/playwright | MPL 2.0 | ADR-009 |
| Load / performance testing | k6 | AGPL v3 | ADR-009 |
| SAST | ESLint security plugins + Semgrep | MIT / LGPL 2.1 | ADR-009 |
| Container image scanning | Trivy | Apache 2.0 | ADR-009 |
| Secrets — development | .env + Docker Compose env_file | — | ADR-010 |
| Secrets — production | OpenBao | MPL 2.0 | ADR-010 |
| CI/CD | GitHub Actions | Free for open source | ADR-011 |
| Container registry | GitHub Container Registry (ghcr.io) | Free for open source | ADR-011 |
| Local development runtime | Docker (via OrbStack on macOS) | — | — |
| Architectural style | Modular monolith (core); separate services (modules + adapters) | — | ADR-012 |
| Bitemporal storage pattern | Four-column explicit timestamps (`valid_from/to`, `recorded_at/until`) | — | ADR-013 |
| Multi-tenancy isolation | PostgreSQL Row-Level Security (RLS) + `tenant_id` column | — | ADR-014 |
| Workflow/platform controls | SRS domain state + SRS workflow records + Temporal orchestration | — | ADR-015, ADR-016 |
| Sensitive case boundary | Minimum-necessary SRS outcome; restricted specialist evidence | — | ADR-017 |
| Regulatory lineage | Versioned collection snapshot, field lineage and sign-off | — | ADR-018 |
| Integration assurance | Per-target exchange ledger and state reconciliation | — | ADR-019 |
| Assessment authority | Staged marks/results with immutable ratification lock | — | ADR-020 |
| Record governance | Linked identity, rights, retention and audit controls | — | ADR-021 |
| Sponsor compliance | Governed CAS/compliance decisions reconciled with UKVI SMS | — | ADR-022 |

## Local Development Stack

Running `docker compose up -d` from `infra/compose` on a Mac Mini with OrbStack starts the local platform services:

| Service | Purpose | Port (default) |
|---|---|---|
| PostgreSQL 16 | Primary database | 5432 |
| NATS JetStream | Message broker | 4222 (client), 8222 (monitoring) |
| Temporal Server | Workflow engine | 7233 (gRPC) |
| Temporal UI | Workflow visibility | 8233 |
| Keycloak (Quarkus) | Identity provider | 8081 |
| Prometheus | Metrics | 9090 |
| Grafana | Dashboards | 3001 |
| Loki | Log aggregation | 3100 |
| Promtail | Log shipper | — |
| SRS API | Backend service, run separately with `corepack pnpm --filter @revelation-srs/api dev` | 3000 |
| SRS Frontend | Student portal / admin UI, added in the frontend phase | 5173 (dev server) |

## Key Architectural Constraints from Stack Choices

1. **TypeScript strict mode throughout** — no `any`, no unchecked index access. Type errors are build failures.
2. **Schema-first APIs** — Fastify JSON Schema on all routes; OpenAPI spec generated from schema, not hand-written.
3. **Real infrastructure in integration tests** — Testcontainers for PostgreSQL in Phase 3; NATS and Temporal container tests are added when adapter and workflow behaviours are implemented.
4. **Bitemporal via Drizzle + explicit timestamp columns** — reusable column helpers; query helpers tested independently.
5. **Temporal workflows are code** — versioned, unit-tested, and reviewed in PRs like any other code.
6. **One realm per tenant in Keycloak** — tenant provisioning automates realm creation via Keycloak Admin API.
7. **Secrets never in images or source** — enforced by Trivy scanning and `git-secrets` pre-commit hook in CI.
