# Developer Setup Guide

> Target: a developer following this guide from a clean machine should be able to run the full test suite in under 15 minutes (NFR-OPS-001).

---

## Prerequisites

| Tool | Minimum version | Install |
|---|---|---|
| Node.js | 22 LTS | [nodejs.org](https://nodejs.org) |
| pnpm | 9 | `npm install -g pnpm` |
| Docker | 24 | [docs.docker.com](https://docs.docker.com/get-docker/) |
| Git | 2.40 | system package manager |

On macOS, [OrbStack](https://orbstack.dev) is a faster Docker-compatible runtime that works without any configuration changes.

---

## Quick start

```bash
# 1. Clone
git clone https://github.com/RevelationCore/Revelation-SRS.git
cd Revelation-SRS

# 2. Install dependencies
pnpm install

# 3. Copy environment template
cp .env.example .env

# 4. Start platform services (PostgreSQL, NATS, Temporal, Keycloak, observability)
docker compose -f infra/compose/docker-compose.yml up -d

# 5. Run database migrations
pnpm migrate

# 6. Start application services in watch mode
pnpm dev
```

The API will be available at `http://localhost:3000`. See the [service endpoints table](#service-endpoints) below.

---

## Running the test suite

```bash
# Unit tests — no Docker required
pnpm test

# Integration tests — Docker required (Testcontainers spins up ephemeral PostgreSQL)
pnpm test:int

# TypeScript type checking
pnpm typecheck

# Lint (zero errors required)
pnpm lint

# All checks together (what CI runs)
pnpm typecheck && pnpm lint && pnpm test && pnpm test:int
```

Integration tests use [Testcontainers](https://node.testcontainers.org/) and manage their own ephemeral PostgreSQL instances. The `docker compose` services from step 4 are **not** required for integration tests.

---

## Service endpoints (local development)

| Service | URL | Default credentials |
|---|---|---|
| SRS API | `http://localhost:3000` | — |
| API health | `http://localhost:3000/health` | — |
| Swagger UI | `http://localhost:3000/documentation` | — |
| Temporal UI | `http://localhost:8233` | — |
| Keycloak admin | `http://localhost:8081` | admin / admin |
| Grafana | `http://localhost:3001` | admin / admin |
| Prometheus | `http://localhost:9090` | — |
| NATS monitoring | `http://localhost:8222` | — |

---

## Demo data

The demo-data platform provides pre-seeded scenario datasets for local development:

```bash
# Load the CI golden scenario (small, fast)
pnpm demo:reset ci-golden

# Load the full institution-year scenario (50,000 students — takes several minutes)
pnpm demo:reset institution-year

# Check what scenario is currently loaded
pnpm demo:status

# Validate the loaded scenario
pnpm demo:validate ci-golden
```

Available scenarios: `ci-golden`, `applicant-pipeline`, `enrolment-induction`, `module-selection`, `assessment-marks`, `graduation-ceremony`, `institution-year`.

---

## Repository structure

```
apps/
  api/          Fastify REST API — core SRS platform
  admin/        React admin UI
  portal/       React student portal
modules/
  wellbeing/    First-party wellbeing module (separate Fastify service)
adapters/
  vle/          VLE integration adapter (separate Fastify service)
packages/
  domain/       Shared domain types, permissions, value sets
  ui/           Shared React component library
  migration-tools/  Data migration tooling
infra/
  compose/      Docker Compose configuration
  docker/       Multi-stage Dockerfiles for production images
  k8s/          Kustomize manifests (base + overlays)
  k6/           Load testing suites
  prometheus/   Alert rules
schemas/
  events/       NATS JetStream event schemas
docs/           Architecture, requirements, runbooks, and release evidence
e2e/            Playwright end-to-end tests
```

---

## Making a contribution

1. Fork the repository and create a feature branch from `main`.
2. Make your change with tests.
3. Run `pnpm typecheck && pnpm lint && pnpm test && pnpm test:int`.
4. Commit with `-s` to sign off: `git commit -s -m "feat: ..."`.
5. Open a PR using the PR template.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full contribution guide and sign-off requirements.

---

## Monorepo commands

| Command | Description |
|---|---|
| `pnpm install` | Install all workspace dependencies |
| `pnpm build` | Build all packages |
| `pnpm dev` | Start all services in watch mode |
| `pnpm test` | Run all unit tests |
| `pnpm test:int` | Run all integration tests |
| `pnpm typecheck` | TypeScript type check across all packages |
| `pnpm lint` | ESLint across all packages |
| `pnpm migrate` | Apply all pending database migrations |
| `pnpm generate:openapi` | Regenerate `apps/api/openapi/v1.json` |
| `pnpm demo:reset <slug>` | Load a named demo scenario |
| `pnpm demo:validate <slug>` | Validate a named demo scenario |
| `pnpm demo:status` | Show which scenario is currently loaded |
| `pnpm test:e2e` | Run Playwright E2E tests (requires running stack) |

---

## Troubleshooting

**`pnpm test:int` times out**
Docker must be running. Testcontainers pulls images on first run — allow extra time.

**`pnpm migrate` fails with connection refused**
The `docker compose up -d` services may not be healthy yet. Run `docker compose -f infra/compose/docker-compose.yml ps` and wait for PostgreSQL to show `healthy`.

**Port conflicts**
If port 3000, 5432, or 4222 is already in use, stop the conflicting service or edit `infra/compose/docker-compose.yml` to remap ports.

**`pnpm dev` shows `cannot find module`**
Run `pnpm build` once to compile shared packages before starting watch mode.
