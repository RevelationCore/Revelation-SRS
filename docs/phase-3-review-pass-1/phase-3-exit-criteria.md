# Phase 3 Exit Criteria Assessment

## Roadmap Exit Criterion

> CI pipeline green. All platform infrastructure components deployed locally. Bitemporal, audit, workflow, and integration layer proven by tests before any domain code is written.

Assessment: **Not yet met**.

## Work-Item Assessment

| Work item | Status | Notes |
|---|---:|---|
| Repository structure and CI/CD pipeline | Partial | Monorepo and CI workflow exist, but local verification could not run because `pnpm` is unavailable in the review environment. Migration validation is not meaningful until migrations are committed. |
| Database foundation | Partial | Drizzle schema and helpers exist, but no migrations are committed. RLS and bitemporal constraints are test-bootstrap SQL, not production DDL. |
| Authentication and authorisation | Partial | RBAC map and middleware exist. Health exemption and production Keycloak JWKS validation are not implemented. |
| Workflow engine integration | Scaffold | Worker package exists, but no executable workflows or working audit bridge are present. |
| Integration layer core | Scaffold/partial | Publisher exists. Subscription framework, retry/DLQ, file exchange, schema validation, exchange ledger writes, health polling, and lifecycle management are missing. |
| Configuration-driven rules engine | Partial | Runtime lookup scaffold exists, but storage schema, administration API, audit of rule changes, and temporally safe caching are missing. |
| Observability stack | Partial | Compose includes Prometheus/Grafana/Loki/Promtail. API lacks `/metrics`; readiness checks only database; alert rules are absent. |
| Containerisation and deployment | Partial | API Dockerfile and compose stack exist. Compose has missing/empty bootstrap mounts; Docker image and pnpm versions are not fully pinned. |

## Tests Claimed Versus Tests Present

| Claimed proof | Present? | Review note |
|---|---:|---|
| Bitemporal scenarios | Partial | Tests cover manual SQL scenarios. The shared `bitemporalUpdate()` helper is imported but not called. |
| RLS cross-tenant isolation | Partial | Raw DB helper tests exist. There is no API-level tenant isolation test and no migration test proving production policies are applied. |
| Health endpoints | Partial | Tests exist, but the auth skip mechanism appears unimplemented in the JWT hook. |
| Audit trail | Not proven | Audit service inserts rows, but append-only enforcement and write/read audit obligations are not tested. |
| Workflow | Not proven | No executable workflow tests. |
| Integration layer | Not proven | No NATS/Testcontainers tests, consumer tests, DLQ tests, schema validation tests, or exchange-ledger tests. |
| OpenAPI contract validation | Not proven | CI placeholder exists; generation and Dredd validation are not configured. |

## Recommended Gate Before Phase 4

Phase 4 can proceed only after the following are resolved or explicitly reclassified as deferred scope:

1. Migrations can provision the Phase 3 schema from an empty database.
2. RLS, tenant context, and auth probe/JWKS behavior are tested end to end.
3. `bitemporalUpdate()` and current/historical bitemporal reads are tested through the shared helper.
4. The minimum workflow and integration foundations required by Phase 4 are executable, not comments.
5. `/ready` and `/metrics` reflect the deployed services Prometheus and orchestration expect.

