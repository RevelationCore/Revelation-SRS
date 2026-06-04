# Phase 3 Review Findings

## High Findings

### P3-001 - High - The migration path cannot create the reviewed Phase 3 database foundation

`packages/db/src/migrate.ts` applies migrations from `./migrations`, and `packages/db/drizzle.config.ts` also outputs to `./migrations`, but the repository does not contain a `packages/db/migrations` directory. The only executable DDL found is test bootstrap SQL in `packages/db/test/setup.ts`, where the test table, bitemporal constraints, and RLS policy are created manually.

References:
- `packages/db/src/migrate.ts:10`
- `packages/db/drizzle.config.ts:4`
- `packages/db/test/setup.ts:24`
- `packages/db/test/setup.ts:90`
- `packages/db/test/setup.ts:91`

Impact: `pnpm migrate` cannot deterministically provision the Phase 3 schema described by the roadmap. More importantly, the reusable `rlsPolicySql()` and `bitemporalConstraintsSql()` functions are not tied into production migrations, so Phase 4 tables can be created without the constraints Phase 3 was meant to establish.

Recommendation: Add committed Drizzle migrations for `tenant`, `audit_record`, `integration_contract`, `integration_registration`, and `integration_exchange`. Include the RLS policies, `FORCE ROW LEVEL SECURITY`, bitemporal checks/indexes, integration unique constraints, and append-only audit protections in those migrations. Add a migration smoke test that runs `packages/db/src/migrate.ts` against a clean Testcontainers database.

### P3-002 - High - Authentication does not implement the documented health exemption or production Keycloak JWKS path

Health routes set `skipAuth: true`, but the global JWT hook does not check `request.routeOptions.config.skipAuth` before verifying a token. The same plugin advertises production RS256 verification through Keycloak JWKS, but registers `@fastify/jwt` with `opts.secret ?? 'replace-with-keycloak-jwks'`; `opts.jwksUrl` is never used. The API passes only `config.jwtSecret` when registering the plugin, so `KEYCLOAK_JWKS_URL` from config is not wired in.

References:
- `apps/api/src/routes/health.ts:19`
- `apps/api/src/routes/health.ts:31`
- `packages/auth/src/plugins/jwt.ts:30`
- `packages/auth/src/plugins/jwt.ts:34`
- `packages/auth/src/plugins/jwt.ts:42`
- `apps/api/src/config.ts:40`
- `apps/api/src/app.ts:69`

Impact: `/health` and `/ready` are likely protected despite being documented as unauthenticated probes, which breaks container/orchestrator health checks. In production, tokens would not be validated against tenant Keycloak realms as required by the security architecture, creating either startup failure pressure or a dangerous fallback to symmetric secrets.

Recommendation: Make the JWT hook return early for route configs with `skipAuth`. Pass `keycloakJwksUrl` into the auth plugin and implement JWKS/OIDC verification for production, including issuer/audience validation and key rotation caching. Add tests for unauthenticated health/readiness, invalid tokens, valid HS256 test tokens, and JWKS-mode configuration.

### P3-003 - High - Tenant context is not actually applied by the Fastify tenant plugin

The tenant plugin comment says it sets `app.current_tenant_id` for every request, but the hook is a no-op. The real RLS setter exists as `withTenantContext()`, but there is no application-level guard requiring routes or services to use it before database calls.

References:
- `packages/auth/src/plugins/tenant.ts:5`
- `packages/auth/src/plugins/tenant.ts:12`
- `packages/auth/src/plugins/tenant.ts:14`
- `packages/db/src/rls.ts:32`
- `apps/api/src/app.ts:49`

Impact: Phase 4 route code can call `fastify.db` directly and either bypass the intended tenant-context wrapper or fail unpredictably once RLS is enabled. The platform foundation does not yet make secure tenant-scoped access the default.

Recommendation: Provide a request-scoped database accessor that always wraps calls in `withTenantContext(request.tenantId, ...)`, or introduce repository/service conventions that make direct `fastify.db` access impossible outside platform administration. Add an integration test through an API route proving cross-tenant isolation at the HTTP boundary, not only at the raw DB helper boundary.

### P3-004 - High - The shared bitemporal update helper is unproven and has incorrect current-state semantics

`currentVersionWhere()` only filters by logical id, tenant id, and `recorded_until IS NULL`; it does not enforce valid-time currentness with `valid_from <= now` and `(valid_to IS NULL OR valid_to > now)`. The `bitemporalUpdate()` test imports the helper but does not call it; it manually closes and inserts rows instead.

References:
- `packages/db/src/temporal.ts:57`
- `packages/db/src/temporal.ts:60`
- `packages/db/src/temporal.ts:63`
- `packages/db/src/temporal.ts:108`
- `packages/db/test/bitemporal.test.ts:7`
- `packages/db/test/bitemporal.test.ts:51`

Impact: Future Phase 4 student, enrolment, status, and rule tables could read future-dated or expired-valid records as "current". The most important shared persistence helper is not covered by the test that claims to verify it.

Recommendation: Update `currentVersionWhere()` to include valid-time predicates or rename it to make transaction-current semantics explicit. Change the test to call `bitemporalUpdate()` directly against a Drizzle table object, assert old/new valid and recorded intervals, and add tests for future-dated rows, expired rows, missing current rows, and tenant isolation.

### P3-005 - High - Workflow integration is scaffold-only but marked as Phase 3 complete

The Temporal worker points to `./workflows/index.js`, but no workflows directory or workflow implementation exists. The audit activity is a no-op with a comment saying the body will be injected later.

References:
- `packages/workflow/src/worker.ts:20`
- `packages/workflow/src/worker.ts:21`
- `packages/workflow/src/activities/audit.activities.ts:15`
- `packages/workflow/src/activities/audit.activities.ts:18`
- `docs/project-roadmap.md:142`
- `docs/project-roadmap.md:171`

Impact: Durable execution, human task assignment, deadlines, escalation, compensation, and workflow-to-audit bridging are not proven by tests before domain workflows are built. This misses a core Phase 3 dependency for admissions, enrolment, wellbeing, and exam-board workflows.

Recommendation: Either downgrade the Phase 3 claim to "Temporal package scaffolded" or add a minimal executable workflow with a tested audit activity, retry policy, deadline/timeout path, and worker startup test against Temporal Testcontainers or the local Temporal service.

## Medium Findings

### P3-006 - Medium - Integration registry schema still diverges from the canonical data model

The implementation defines `integration_exchange.attempt_count` as `TEXT NOT NULL DEFAULT '0'`, while the data model specifies `SMALLINT NOT NULL DEFAULT 0`. The data model also requires a unique constraint on `(tenant_id, integration_registration_id, idempotency_key)`, but the Drizzle schema does not declare it. `integration_registration` similarly lacks the tenant-scoped uniqueness expected for registration codes.

References:
- `packages/db/src/schema/integration.ts:26`
- `packages/db/src/schema/integration.ts:60`
- `packages/db/src/schema/integration.ts:71`
- `docs/architecture/data-model.md:651`
- `docs/architecture/data-model.md:660`

Impact: Retry accounting becomes stringly typed, idempotency is not enforced at the database layer, and duplicate tenant registrations can be created.

Recommendation: Change `attemptCount` to a numeric type and add the missing unique indexes/constraints in the schema and migrations.

### P3-007 - Medium - Integration bus publisher lacks the Phase 3 subscription, retry, DLQ, schema validation, and exchange-ledger foundations

`IntegrationBusPublisher` can connect and publish an envelope, but it does not provision JetStream streams, validate payloads against event schemas, create consumers, manage retry/dead-letter handling, or write `integration_exchange` records.

References:
- `apps/api/src/platform/integration-bus/publisher.ts:27`
- `apps/api/src/platform/integration-bus/publisher.ts:36`
- `apps/api/src/platform/integration-bus/publisher.ts:64`
- `docs/project-roadmap.md:145`
- `docs/project-roadmap.md:147`

Impact: Outbound events can be emitted, but the integration layer core is not yet a reliable integration substrate. Phase 4/5 features could publish events without replay, idempotency, reconciliation, or contract validation.

Recommendation: Add stream provisioning, schema validation, exchange-ledger writes, retry/DLQ policies, and at least one consumer test. If those are intentionally deferred, update the roadmap and review gate to say Phase 3 delivered publisher scaffolding only.

### P3-008 - Medium - Rules engine cache and storage do not satisfy the Phase 3 rules-framework deliverable

The rules engine queries an `academic_rule` table that is not in the implemented Drizzle schema or migrations. Its cache key omits `asOfDate`, so a historical lookup and current lookup for the same tenant/programme/rule can return the same cached value. The roadmap also called for rule storage schema, administration API, and audit of rule changes, none of which are implemented.

References:
- `apps/api/src/platform/rules-engine/engine.ts:51`
- `apps/api/src/platform/rules-engine/engine.ts:58`
- `apps/api/src/platform/rules-engine/engine.ts:62`
- `apps/api/src/platform/rules-engine/engine.ts:81`
- `docs/project-roadmap.md:152`

Impact: Rule evaluation is not safe for bitemporal reconstruction and cannot run until a later schema adds the table. Assessment/enrolment rules built on this cache could return stale or temporally incorrect decisions.

Recommendation: Include `asOfDate` in the cache key, or separate current-rule caching from historical lookups. Add the `academic_rule` schema/migration or mark the rules engine as Phase 4+ dependent. Add tests for programme-specific precedence, tenant defaults, cache invalidation, and historical lookups.

### P3-009 - Medium - Readiness and observability are materially incomplete

`/ready` checks only the database. It does not check NATS, Temporal worker health, or Keycloak JWKS reachability, although the deployment architecture defines all of those as readiness dependencies. Prometheus is configured to scrape `/metrics`, but the API does not register a metrics endpoint in the reviewed files.

References:
- `apps/api/src/routes/health.ts:35`
- `apps/api/src/routes/health.ts:38`
- `apps/api/src/routes/health.ts:44`
- `infra/compose/prometheus/prometheus.yml:6`
- `infra/compose/prometheus/prometheus.yml:9`
- `docs/architecture/deployment-architecture.md:220`

Impact: Orchestration can route traffic to a process that cannot publish events, run workflows, or validate production tokens. Prometheus will scrape a missing endpoint for the API.

Recommendation: Add NATS, Temporal, and Keycloak checks to `/ready`, implement `/metrics`, and include alert rules for the critical metrics required by NFR-OBS-005.

### P3-010 - Medium - Docker Compose local stack is incomplete or internally inconsistent

The PostgreSQL service mounts `./init`, but no `infra/compose/init` directory exists. Keycloak imports from `infra/compose/keycloak`, which contains only `.gitkeep`, so no realm/client/role bootstrap is available. Promtail config uses Docker service discovery through `/var/run/docker.sock`, but the compose service does not mount the Docker socket.

References:
- `infra/compose/docker-compose.yml:27`
- `infra/compose/docker-compose.yml:101`
- `infra/compose/promtail/promtail.yml:12`
- `infra/compose/promtail/promtail.yml:13`
- `infra/compose/docker-compose.yml:160`

Impact: `docker compose up -d` may not provide the complete identity/logging development environment claimed by Phase 3. Keycloak starts without the SRS tenant realm/client/role mappings required for realistic auth testing.

Recommendation: Add the missing init directory or remove the mount, provide a development realm export, and align Promtail discovery with mounted volumes.

## Low Findings

### P3-011 - Low - API standards/OpenAPI tooling is dependency-only

The API package depends on Swagger libraries, and CI has a placeholder OpenAPI job, but no route schemas, OpenAPI generation script, committed `apps/api/openapi/v1.json`, or Dredd validation are present.

References:
- `apps/api/package.json:20`
- `.github/workflows/ci.yml:146`
- `.github/workflows/ci.yml:148`
- `docs/architecture/api-standards.md:238`
- `docs/architecture/api-standards.md:246`

Impact: The Phase 3 gateway exists, but API contract governance is not yet operational.

Recommendation: Add the OpenAPI generator before Phase 4 public resources are added, so student/enrolment APIs start contract-first.

### P3-012 - Low - Container base and pnpm activation are not pinned as tightly as the roadmap states

The Dockerfile uses `node:22-alpine` and `corepack prepare pnpm@latest --activate`. The roadmap calls for pinned base images.

References:
- `infra/docker/api/Dockerfile:2`
- `infra/docker/api/Dockerfile:3`
- `infra/docker/api/Dockerfile:28`
- `docs/project-roadmap.md:156`

Impact: Builds can change as upstream tags and `pnpm@latest` move.

Recommendation: Pin Node images to a patch/digest and activate a fixed pnpm version matching CI.

