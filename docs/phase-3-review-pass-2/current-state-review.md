# Current State Review

## Findings

### P3P2-001 - High - Current remediation likely does not compile

The auth plugin imports `jose`, but `packages/auth/package.json` does not declare `jose` as a dependency. The tenant plugin dynamically imports `@revelation-srs/db`, but `packages/auth/package.json` also does not declare that dependency. The tenant plugin decorates `request.withDb`, but `packages/auth/src/types.ts` does not augment `FastifyRequest` with a `withDb` property. The value-set routes use `fastify.valueSetService`, but `apps/api/src/app.ts` neither imports/decorates `ValueSetService` nor registers `valueSetsRoutes`, and the Fastify instance augmentation does not include `valueSetService`.

References:
- `packages/auth/src/plugins/jwt.ts:1`
- `packages/auth/package.json:14`
- `packages/auth/src/plugins/tenant.ts:36`
- `packages/auth/src/types.ts:20`
- `apps/api/src/routes/value-sets.ts:42`
- `apps/api/src/app.ts:43`
- `apps/api/src/app.ts:97`

Required step: Add the missing dependencies, add the missing Fastify type augmentations, decorate `valueSetService`, register value-set routes under `/api/v1`, and run `pnpm typecheck`.

### P3P2-002 - High - Keycloak JWKS remediation is implemented in the plugin but not wired into the API

`JwtPluginOptions` now supports `jwksUrl`, and the plugin creates a remote JWK set when it is present. But `buildApp()` still registers the JWT plugin with only `{ secret: config.jwtSecret }`, so production JWKS mode is never used.

References:
- `packages/auth/src/plugins/jwt.ts:11`
- `packages/auth/src/plugins/jwt.ts:53`
- `apps/api/src/config.ts:10`
- `apps/api/src/app.ts:69`

Required step: Register `jwtPlugin` with both `secret` and `jwksUrl`, and ensure production configuration prefers JWKS while development/test can use HS256. Add tests for `skipAuth`, HS256, and JWKS-mode configuration.

### P3P2-003 - High - `bitemporalUpdate()` remains unproven and still uses suspicious raw parameter binding

`currentVersionWhere()` now includes valid-time predicates, which addresses part of pass-1. But `bitemporalUpdate()` still builds a raw SQL insert with positional placeholders and passes `vals` to `sql.raw()`. Drizzle's `sql.raw()` is not a normal parameterized query builder, so this needs direct execution proof. The existing test still imports `bitemporalUpdate()` and manually performs the update instead of calling the helper.

References:
- `packages/db/src/temporal.ts:70`
- `packages/db/src/temporal.ts:124`
- `packages/db/src/temporal.ts:173`
- `packages/db/test/bitemporal.test.ts:7`
- `packages/db/test/bitemporal.test.ts:51`

Required step: Replace the simulated test with direct helper coverage. If the helper fails, reimplement insert construction using a supported Drizzle insert path, a typed repository helper, or safely composed SQL chunks.

### P3P2-004 - High - Migration files exist now, but migration execution is still unverified

The repository now contains `packages/db/migrations/0000_initial_platform_schema.sql` and `0001_seed_value_sets.sql`, which is progress. However, no migration smoke test exists and local verification could not run. The migration also uses hand-written SQL that must be kept in sync with Drizzle schema files.

References:
- `packages/db/migrations/0000_initial_platform_schema.sql:10`
- `packages/db/migrations/0000_initial_platform_schema.sql:124`
- `packages/db/migrations/0001_seed_value_sets.sql:16`
- `packages/db/src/migrate.ts:10`

Required step: Add a Testcontainers migration test that starts from an empty database, runs `pnpm --filter @revelation-srs/db migrate`, asserts the expected tables/indexes/policies exist, and verifies seeded value sets are queryable with tenant RLS context.

### P3P2-005 - Medium - Tenant-context accessor is present but not yet enforced or tested end to end

The tenant plugin now decorates a request-scoped `withDb` function, which is good progress. But no route uses it yet, `fastify.db` remains available everywhere, and there is no API-level tenant isolation test proving route code cannot accidentally bypass tenant RLS.

References:
- `packages/auth/src/plugins/tenant.ts:22`
- `packages/auth/src/plugins/tenant.ts:39`
- `apps/api/src/app.ts:49`

Required step: Add API-level test routes that use `request.withDb`, prove cross-tenant isolation through HTTP requests, and document/directly lint against unwrapped `fastify.db` usage in domain routes.

### P3P2-006 - Medium - Rules schema exists but the rules engine is still partly Phase-4-shaped

`academic_rule` now exists in schema and migration, and the cache key includes `asOfDate` by day. But the rules engine comment still says the table is defined in Phase 4 migrations, there is no rules administration API, no seed/test rule data, and no audit of rule changes.

References:
- `packages/db/src/schema/rules.ts:13`
- `packages/db/migrations/0000_initial_platform_schema.sql:182`
- `apps/api/src/platform/rules-engine/engine.ts:34`
- `apps/api/src/platform/rules-engine/engine.ts:51`

Required step: Update comments, add tests for tenant defaults/programme overrides/historical lookup/cache invalidation, and decide whether rule administration API and write audit are Phase 3 required or explicitly deferred.

### P3P2-007 - Medium - Readiness and observability remain incomplete

`/ready` still checks only the database. Prometheus is configured to scrape `/metrics`, but the API still does not expose a metrics endpoint. NATS, Temporal, and Keycloak readiness are not checked.

References:
- `apps/api/src/routes/health.ts:35`
- `apps/api/src/routes/health.ts:38`
- `infra/compose/prometheus/prometheus.yml:6`
- `infra/compose/prometheus/prometheus.yml:9`

Required step: Add `/metrics`; add readiness checks for NATS connection state, Temporal worker or service reachability, and JWKS/Keycloak when configured.

### P3P2-008 - Medium - Workflow and integration foundations are still scaffold-only

The workflow worker still points at a missing `./workflows/index.js`; the audit activity is a no-op; the integration bus still only publishes events and does not provision streams, consumers, schema validation, retry/DLQ, or exchange-ledger writes.

References:
- `packages/workflow/src/worker.ts:21`
- `packages/workflow/src/activities/audit.activities.ts:15`
- `apps/api/src/platform/integration-bus/publisher.ts:27`
- `apps/api/src/platform/integration-bus/publisher.ts:64`

Required step: Either implement a minimal executable workflow and minimal integration proof, or update the roadmap to explicitly classify these as Phase 4+ scaffolds rather than Phase 3 completion criteria.

## Pass-1 Status

| Pass-1 finding | Current status |
|---|---|
| P3-001 migrations absent | Partially addressed: migrations exist, but not verified. |
| P3-002 auth health/JWKS | Partially addressed: plugin supports both, app wiring incomplete. |
| P3-003 tenant context | Partially addressed: `withDb` accessor exists, types/tests/enforcement missing. |
| P3-004 bitemporal helper | Partially addressed: current predicate fixed, helper still untested. |
| P3-005 workflow scaffold-only | Still open. |
| P3-006 integration schema mismatch | Mostly addressed for `attempt_count` and unique constraints in migration. |
| P3-007 integration bus incomplete | Still open. |
| P3-008 rules engine incomplete | Partially addressed: schema exists, admin/audit/tests still missing. |
| P3-009 readiness/observability | Still open. |
| P3-010 compose inconsistencies | Not reviewed as remediated; likely still open. |
| P3-011 OpenAPI tooling | Still open unless intentionally deferred. |
| P3-012 pinned images/pnpm | Still open unless intentionally accepted. |

