# Steps Required To Complete Phase 3

## 1. Restore Build Integrity

1. Add missing dependencies:
   - `jose` to `packages/auth`
   - `@revelation-srs/db` to `packages/auth` if the auth package continues to import it dynamically
2. Add Fastify request augmentation for `request.withDb`.
3. Add Fastify instance augmentation for `valueSetService`.
4. Register `ValueSetService` and `valueSetsRoutes` in `apps/api/src/app.ts`.
5. Pass `config.keycloakJwksUrl` into `jwtPlugin`.
6. Run `pnpm typecheck` and fix all resulting TypeScript errors.

## 2. Finish Database And Migration Foundation

1. Add a migration smoke test against a clean Testcontainers PostgreSQL database.
2. Assert the Phase 3 tables exist:
   - `tenant`
   - `audit_record`
   - `integration_contract`
   - `integration_registration`
   - `integration_exchange`
   - `academic_rule`
   - `value_set`
   - `value_set_member`
   - `field_value_set`
3. Assert RLS is enabled and forced on tenant-scoped tables.
4. Assert bitemporal indexes/checks exist on `academic_rule`.
5. Assert integration idempotency and tenant registration uniqueness constraints exist.
6. Decide whether audit append-only is enforced by permissions only or by trigger; document and test the decision.

## 3. Complete Auth And Tenant Isolation

1. Wire JWKS mode into `buildApp()`.
2. Add tests for unauthenticated `/health` and `/ready`.
3. Add tests for protected routes with missing, invalid, and valid tokens.
4. Add a tenant-scoped test route using `request.withDb`.
5. Prove tenant A cannot read tenant B data via HTTP.
6. Document that domain routes must use `request.withDb` and reserve `fastify.db` for explicit platform-admin operations.

## 4. Complete Bitemporal Foundation

1. Replace the manual update logic in `packages/db/test/bitemporal.test.ts` with a direct call to `bitemporalUpdate()`.
2. Verify the helper correctly:
   - closes the previous transaction-current row
   - inserts a new version with the same logical `id`
   - preserves/overrides valid-time windows as requested
   - throws when there is no current row
   - remains tenant-scoped
3. Test `currentVersionWhere()` against future-dated and expired-valid rows.
4. If `sql.raw(..., vals)` fails, replace the helper with a supported insertion approach before Phase 4 uses it.

## 5. Complete Valid-Value Framework

1. Wire value-set routes and service into the API.
2. Add value-set tests listed in [valid-values-review.md](valid-values-review.md).
3. Decide Phase 3 statutory-data scope:
   - framework-only with platform seeds, full HESA deferred; or
   - complete current HESA/Jisc seed now
4. Add source/version metadata and a repeatable update process for statutory value sets.
5. Expand `field_value_set` mappings for all controlled `_code` fields, or document that mappings are added as each domain table is implemented.
6. Add write-time validation conventions for Phase 4 services.

## 6. Complete Rules Engine Minimum

1. Update stale comments saying `academic_rule` is Phase 4-only.
2. Add tests for:
   - tenant default rule lookup
   - programme-specific override
   - historical `asOfDate`
   - missing rule error
   - cache invalidation
3. Decide whether rule administration API and audit are Phase 3 scope. If yes, implement; if no, update roadmap wording.

## 7. Complete Integration Layer Minimum

1. Decide the minimum Phase 3 integration proof:
   - publisher-only scaffold; or
   - publisher plus stream provisioning, schema validation, exchange-ledger writes, retry/DLQ
2. If Phase 3 remains "integration layer core", implement:
   - stream creation/provisioning
   - schema validation hook
   - `integration_exchange` write on publish/receive
   - basic consumer group setup
   - retry/DLQ test
3. Add NATS Testcontainers coverage.

## 8. Complete Workflow Minimum

1. Add a minimal workflow module at the path the worker references, or change the worker path.
2. Replace the no-op audit activity with an executable implementation or injectable test implementation.
3. Add a worker startup test.
4. Add a minimal workflow test covering activity retry/audit behaviour.
5. If human tasks/deadlines/escalation are deferred, update Phase 3 roadmap text.

## 9. Complete Observability And Readiness

1. Add `/metrics` for Prometheus.
2. Add readiness checks for:
   - database
   - NATS
   - Temporal
   - Keycloak/JWKS when configured
3. Add alert-rule files or explicitly defer alerting.
4. Confirm Prometheus scrape targets match actual service endpoints.

## 10. Clean Up Local Infrastructure

1. Fix or remove the missing `infra/compose/init` mount.
2. Add a Keycloak dev realm/client/role import or document manual setup.
3. Fix Promtail Docker service discovery by mounting the Docker socket or using file-based scraping only.
4. Pin Docker base images and pnpm activation versions.

## 11. Final Verification Gate

Phase 3 should only be marked complete after:

1. `pnpm install --frozen-lockfile`
2. `pnpm typecheck`
3. `pnpm lint`
4. `pnpm test`
5. `pnpm test:int`
6. clean database migration test passes
7. `docker compose -f infra/compose/docker-compose.yml up -d` starts required services
8. `/health`, `/ready`, and `/metrics` behave as documented
9. the roadmap is updated to reflect any deliberate deferrals

