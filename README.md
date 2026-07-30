# Revelation SRS

An open source Student Records System for UK Higher Education.

> **Status**: Alpha — the implemented application is being reconciled with the reviewed UK HE business-process and target data models. See [Current Capabilities](docs/product/current-capabilities.md).

[![AGPL v3](https://img.shields.io/badge/licence-AGPL--v3-blue.svg)](LICENSE)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](CODE_OF_CONDUCT.md)

---

## What is Revelation SRS?

Revelation SRS is a fully open source Student Information System designed specifically for the UK HE sector. It provides institutions with a standards-aligned, adaptable alternative to proprietary SRS platforms, built from the ground up on the [Revelation Student Records Enterprise Reference Model](docs/reference/revelation-student-records-reference-model.md) — a published reference architecture covering 33 systems, actors, and 70 integration flows across the UK HE enterprise.

### Key characteristics

- **UK HE-native** — domain model, terminology, regulatory obligations (HESA, UCAS, SLC, UKVI, OfS), and workflow design follow UK HE conventions throughout.
- **Pluggable architecture** — external systems and SRS modules integrate through a versioned, event-driven integration layer. Institutions substitute their own VLE, Finance, HR, or other systems without modifying core code.
- **Bitemporal foundations** — implemented core records use valid-time and transaction-time history; the reviewed target model identifies additional entities that require the same treatment.
- **Workflow platform** — durable workflow definitions, tasks and gateways are implemented; several reviewed domain processes still require decomposition or migration from service-driven behaviour.
- **Feature-flagged process variation** — tenant administrators can enable modules, process variants, workflow steps, communications, and staged rollouts without forking the core platform.
- **Environment promotion** — the same release artefacts can move through test, UAT, pre-production, and production with isolated data, secrets, integrations, and feature flag state.
- **Multi-tenant** — a single deployment serves multiple institutions with complete database-layer data isolation.
- **AGPL v3** — modifications made available over a network must be published under the same licence, keeping the ecosystem open.

---

## Documentation

| Document | Description |
|---|---|
| [Documentation Home](docs/README.md) | Collaborator-oriented guide to the current documentation set |
| [Core Principles](docs/core-principles.md) | 21 non-negotiable principles governing design, development, and operation |
| [Current Capabilities](docs/product/current-capabilities.md) | Authoritative implemented, partial and proposed capability status |
| [Domain Glossary](docs/domain-glossary.md) | Authoritative definitions of all UK HE domain terms used in the system |
| **Requirements** | |
| [Functional Requirements](docs/requirements/functional-requirements.md) | 140+ testable requirements traced to reference model flows |
| [P0 Business Process Requirements](docs/requirements/business-process-p0-functional-requirements.md) | Detailed controls derived from the UK HE process library |
| [Non-Functional Requirements](docs/requirements/non-functional-requirements.md) | Performance, security, accessibility, privacy, and compliance requirements |
| [Actor Catalogue](docs/requirements/actor-catalogue.md) | Human and system actors; RBAC role hierarchy |
| [Workflow Catalogue](docs/requirements/workflow-catalogue.md) | 12 fully specified business process workflows with state machines |
| [UK HE Business Process Library](docs/business-processes/README.md) | Evidence-based, UK-wide processes across actors and systems, including national variations |
| [Data Subject Register](docs/requirements/data-subject-register.md) | Personal data categories, lawful basis, sensitivity, and retention |
| **Architecture** | |
| [System Architecture](docs/architecture/system-architecture.md) | Component diagram, modular monolith design, repository structure |
| [Data Model](docs/architecture/data-model.md) | Entity model, bitemporal schema pattern, multi-tenancy via RLS |
| [Business Process Data-Model Delta](docs/architecture/business-process-data-model-delta.md) | BPR-D01–D19 assessment against logical and implemented schemas |
| [Business Process Target Data Model](docs/architecture/business-process-target-data-model.md) | Proposed aggregates and ER relationships |
| [Business Process Data Migration Plan](docs/architecture/business-process-data-migration-plan.md) | Staged expand/backfill/cutover plan from migration 0033 |
| [Integration Layer](docs/architecture/integration-layer.md) | Event bus topology, REST API gateway, file exchange framework, plugin registry |
| [Domain Events](docs/architecture/domain-events.md) | Complete event taxonomy (~95 events) with payload schemas and consumers |
| [Integration Contract Catalogue](docs/architecture/integration-contract-catalogue.md) | Named contracts for all 69 reference model flows with failure handling and replay |
| [Event Coverage Matrix](docs/architecture/event-coverage-matrix.md) | Every entity/operation mapped to its domain event or no-event rationale |
| [Workflow Traceability Matrix](docs/architecture/workflow-traceability-matrix.md) | W001–W012 mapped to entities, events, contracts, and audit obligations |
| [API Resource Catalogue](docs/architecture/api-resource-catalogue.md) | All entities mapped to REST resource class, endpoints, and permissions |
| [Data Subject Coverage Matrix](docs/architecture/data-subject-coverage-matrix.md) | Data model reconciled against data subject register |
| [API Standards](docs/architecture/api-standards.md) | URL conventions, RFC 7807 errors, cursor pagination, OpenAPI toolchain |
| [Security Architecture](docs/architecture/security-architecture.md) | Keycloak multi-realm, RBAC, RLS, auth flows, secrets management |
| [Configuration Rules Framework](docs/architecture/configuration-rules-framework.md) | Institutional business rules stored as bitemporal, versioned configuration |
| [Workflow Engine Integration](docs/architecture/workflow-engine-integration.md) | Temporal integration: workflow patterns, human tasks, audit bridge |
| [Deployment Architecture](docs/architecture/deployment-architecture.md) | Docker Compose (local + single institution), Kubernetes (multi-institution) |
| **Reference Model** | |
| [Reference Model Article](docs/reference/revelation-student-records-reference-model.md) | The Revelation Student Records Enterprise Reference Model (v2.1) |
| [Reference Model JSON](docs/reference/revelation-student-records-enterprise-reference-model-3.0.json) | Full model JSON (33 systems, 69 flows) |
| **Decisions** | |
| [Technology Stack](docs/decisions/technology-stack.md) | Complete stack summary with licence and ADR references |
| [ADR Index](#architecture-decision-records) | All architecture decision records |

---

## Technology Stack

All components are open source and free to use under this project's licence.

| Concern | Technology |
|---|---|
| Language / runtime | TypeScript + Node.js 22 LTS |
| API framework | Fastify |
| Database | PostgreSQL 16 + Drizzle ORM |
| Message broker | NATS JetStream |
| Workflow engine | Temporal |
| Identity provider | Keycloak (Quarkus) |
| Frontend | React 18 + Vite + Radix UI + Tailwind CSS |
| Observability | OpenTelemetry + Prometheus + Grafana + Loki |
| Testing | Vitest + Testcontainers + Playwright + axe-core |
| CI/CD | GitHub Actions |

Full rationale: [docs/decisions/technology-stack.md](docs/decisions/technology-stack.md)

---

## Project Status

Revelation SRS has substantial implemented foundations, services, integrations and user interfaces, but it is not currently represented as production-complete. The UK-wide process review identified material gaps in business authority, process decomposition, data modelling and cross-system reconciliation.

| Current classification | Position |
|---|---|
| Implemented baseline | Tenant/temporal foundations, workflow platform and core identity/profile |
| Partial | Admissions, CAS, registration, curriculum/modules, support, assessment/boards, awards, regulatory exchange, integrations and governance |
| Proposed target | Attendance/engagement, PGR lifecycle and the newly reviewed P0 architecture |
| Verification | Documentation checks, repository-wide typecheck and unit tests pass; clean-clone application bootstrap is not yet verified |

The [Current Capability Matrix](docs/product/current-capabilities.md) is the authority for project status. Superseded plans and review evidence are available through the preservation references described in [Documentation History](docs/history.md).

---

## Getting Started

> **First-time setup takes around 15 minutes**, mostly waiting for Docker to pull images. Subsequent starts take under a minute.

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Docker | 24+ | [Docker Desktop](https://docs.docker.com/get-docker/) or [OrbStack](https://orbstack.dev) (macOS) |
| Node.js | 22 LTS | [nodejs.org](https://nodejs.org) |
| pnpm | 9+ | `npm install -g pnpm` |
| Git | 2.40+ | System package manager |

### Step 1 — Clone and install (~3 min)

```bash
git clone https://github.com/RevelationCore/Revelation-SRS.git
cd Revelation-SRS
pnpm install
```

### Step 2 — Configure environment (~1 min)

```bash
cp .env.example .env
```

The `.env.example` file contains working defaults for local development. No changes are required to get a running system. Edit the file if you need to change ports or connect to an external service.

### Step 3 — Start platform services (~10 min first run, ~30 sec after)

```bash
docker compose -f infra/compose/docker-compose.yml up -d
```

This starts PostgreSQL, NATS JetStream, Temporal, Keycloak, and the observability stack (Grafana, Prometheus, Loki). Docker pulls images on first run — Keycloak in particular is large. Subsequent starts use cached images and are much faster.

Wait for all services to report healthy before continuing:

```bash
docker compose -f infra/compose/docker-compose.yml ps
```

### Step 4 — Apply database migrations (~30 sec)

```bash
pnpm migrate
```

This applies all pending [Drizzle ORM](https://orm.drizzle.team) schema migrations to PostgreSQL, creating the full SRS table structure. Migrations are idempotent — safe to run again at any time and required after each `git pull` that includes schema changes.

### Step 5 — Load data (~30 sec to ~10 min depending on scenario)

Choose one of two approaches depending on your goal:

**Option A — Demo scenario (recommended for exploration and development)**

Pre-seeded datasets that represent realistic points in the academic year:

| Scenario | Slug | Students | Load time | Walkthroughs |
|---|---|---|---|---|
| CI Golden | `ci-golden` | 4 | ~5 sec | Tests only |
| S1 — Applicant Pipeline | `applicant-pipeline` | ~200 | ~20 sec | [s1-applicant-pipeline.md](docs/demo-scenarios/s1-applicant-pipeline.md) |
| S2 — Enrolment and Induction | `enrolment-induction` | 1,000 | ~30 sec | [s2-enrolment-induction.md](docs/demo-scenarios/s2-enrolment-induction.md) |
| S3 — Module Selection Peak | `module-selection` | 1,000 | ~30 sec | [s3-module-selection.md](docs/demo-scenarios/s3-module-selection.md) |
| S4 — Assessment Marks | `assessment-marks` | 1,000 | ~45 sec | [s4-assessment-marks.md](docs/demo-scenarios/s4-assessment-marks.md) |
| S5 — Exam Board and Ratification | `exam-board` | 1,000 | ~45 sec | [s5-exam-board.md](docs/demo-scenarios/s5-exam-board.md) |
| S6 — Full-Institution Year | `institution-year` | 50,000 | ~10 min | [s6-institution-year.md](docs/demo-scenarios/s6-institution-year.md) |

Each S1–S6 walkthrough document describes the user personas, demo accounts, and step-by-step stories for that scenario. See [docs/demo-scenarios/README.md](docs/demo-scenarios/README.md) for instructions on how to run through them.

```bash
# Load a scenario (replace the slug with your choice above)
pnpm demo:reset assessment-marks

# Check what is currently loaded
pnpm demo:status

# Validate the loaded data is consistent
pnpm demo:validate assessment-marks
```

**Option B — Historical data migration (for institutions moving from an existing SRS)**

The `migration-tools` package imports student records from SITS or Banner exports into Revelation SRS:

```bash
# Validate an export file before importing
pnpm --filter @revelation-srs/migration-tools migrate:import validate \
  --source sits \
  --file /path/to/export.xml \
  --tenant-id <your-tenant-uuid>

# Import (add --dry-run first to preview changes)
pnpm --filter @revelation-srs/migration-tools migrate:import import \
  --source sits \
  --file /path/to/export.xml \
  --tenant-id <your-tenant-uuid> \
  --dry-run

# Run without --dry-run to apply
pnpm --filter @revelation-srs/migration-tools migrate:import import \
  --source sits \
  --file /path/to/export.xml \
  --tenant-id <your-tenant-uuid>
```

Supported source systems: `sits`, `banner`. See [docs/migration-runbook.md](docs/migration-runbook.md) for field mapping details, pre-import validation checks, and rollback procedure.

### Step 6 — Start the application (~30 sec)

```bash
pnpm dev
```

This starts the API, admin console, student portal, wellbeing module, and VLE adapter in watch mode. File changes restart the affected service automatically.

### Service endpoints

| Service | URL | Credentials |
|---|---|---|
| Admin console | http://localhost:5173 | Keycloak demo accounts |
| Student portal | http://localhost:5174 | Keycloak demo accounts |
| SRS API | http://localhost:3000 | — |
| API health | http://localhost:3000/health | — |
| Swagger UI | http://localhost:3000/documentation | — |
| Keycloak admin | http://localhost:8081 | admin / admin |
| Temporal UI | http://localhost:8233 | — |
| Grafana | http://localhost:3001 | admin / admin |
| Prometheus | http://localhost:9090 | — |
| NATS monitoring | http://localhost:8222 | — |

### Running tests

```bash
# Unit tests — no Docker required (~2 min)
pnpm test

# Integration tests — Docker required, Testcontainers manages its own DB (~5 min)
pnpm test:int

# Type check
pnpm typecheck

# Lint
pnpm lint
```

Full developer setup guide, including troubleshooting and monorepo commands: [docs/developer-setup.md](docs/developer-setup.md)

---

## Architecture Decision Records

| ADR | Decision |
|---|---|
| [ADR-001](docs/decisions/ADR-001-programming-language-and-runtime.md) | TypeScript + Node.js 22 LTS |
| [ADR-002](docs/decisions/ADR-002-api-framework.md) | Fastify |
| [ADR-003](docs/decisions/ADR-003-database-and-orm.md) | PostgreSQL 16 + Drizzle ORM |
| [ADR-004](docs/decisions/ADR-004-message-broker.md) | NATS JetStream |
| [ADR-005](docs/decisions/ADR-005-workflow-engine.md) | Temporal |
| [ADR-006](docs/decisions/ADR-006-identity-provider.md) | Keycloak (Quarkus) |
| [ADR-007](docs/decisions/ADR-007-frontend.md) | React 18 + Vite + Radix UI + Tailwind CSS |
| [ADR-008](docs/decisions/ADR-008-observability.md) | OpenTelemetry + Prometheus + Grafana + Loki |
| [ADR-009](docs/decisions/ADR-009-testing.md) | Vitest + Testcontainers + Playwright + axe-core + k6 |
| [ADR-010](docs/decisions/ADR-010-secrets-management.md) | `.env` (dev) + OpenBao (production) |
| [ADR-011](docs/decisions/ADR-011-ci-cd.md) | GitHub Actions |
| [ADR-012](docs/decisions/ADR-012-architectural-style.md) | Modular monolith (core); separate services (modules + adapters) |
| [ADR-013](docs/decisions/ADR-013-bitemporal-storage.md) | Four-column bitemporal timestamps |
| [ADR-014](docs/decisions/ADR-014-multitenancy-isolation.md) | PostgreSQL Row-Level Security |
| [ADR-015](docs/decisions/ADR-015-workflow-feature-flags-and-environment-promotion.md) | Workflow, feature flags, and environment promotion |
| [ADR-016](docs/decisions/ADR-016-authoritative-business-state-and-workflow-separation.md) | Authoritative business state separated from workflow state |
| [ADR-017](docs/decisions/ADR-017-minimum-necessary-outcomes-and-restricted-evidence.md) | Minimum-necessary outcomes and restricted evidence |
| [ADR-018](docs/decisions/ADR-018-versioned-regulatory-submission-lineage.md) | Versioned regulatory submissions with field lineage |
| [ADR-019](docs/decisions/ADR-019-per-target-exchange-ledger-and-reconciliation.md) | Per-target exchange ledger and reconciliation |
| [ADR-020](docs/decisions/ADR-020-staged-assessment-authority-and-ratification-lock.md) | Staged assessment authority and ratification lock |
| [ADR-021](docs/decisions/ADR-021-governed-identity-rights-retention-and-audit.md) | Governed identity, rights, retention and audit |
| [ADR-022](docs/decisions/ADR-022-cas-and-sponsor-compliance-evidence-boundary.md) | CAS and sponsor-compliance evidence boundary |

---

## Reference Model

Revelation SRS is built on the **Revelation Student Records Enterprise Reference Model v2.1** — a published reference architecture for UK HE student records ecosystems.

- [Reference model article](https://revelationcore.com/blogs/the-revelation-student-records-reference-model.html)
- [Local copy — article](docs/reference/revelation-student-records-reference-model.md)
- [Local copy — JSON model](docs/reference/revelation-student-records-enterprise-reference-model-3.0.json)

The reference model is © RevelationCore 2026, licensed [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/).

---

## Contributing

Revelation SRS welcomes contributions. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide, including setup instructions, branching strategy, test requirements, and the DCO sign-off process.

Before contributing, please read the [Code of Conduct](CODE_OF_CONDUCT.md). For security vulnerabilities, follow the responsible disclosure process in [SECURITY.md](SECURITY.md) rather than opening a public issue.

## Verifying release artefacts

All production container images released under `v1.0.0` and later are signed with [Sigstore/cosign](https://docs.sigstore.dev/). To verify an image:

```bash
cosign verify \
  --certificate-identity-regexp="https://github.com/RevelationCore/Revelation-SRS/.github/workflows/release.yml" \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com" \
  ghcr.io/revelationcore/revelation-srs/api:v1.0.0
```

Each release also includes an SPDX 2.3 software bill of materials (`sbom.spdx.json`) attached as a release asset.

---

## Licence

Revelation SRS is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

Under this licence:
- You may use, study, modify, and distribute the software freely.
- If you make a modified version available over a network, you must publish the source under the same licence.
- Commercial use is permitted; closed-source derivatives are not.

See [LICENSE](LICENSE) for the full licence text.
