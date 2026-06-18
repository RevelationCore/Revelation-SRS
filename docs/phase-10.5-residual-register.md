# Phase 10.5 Residual Register

Published: 2026-06-17

This register records known gaps, sub-optimal approaches, and Phase 11 hardening items identified during Phase 10.5 implementation. It is unconditional — produced regardless of whether any load-time budgets were breached.

---

## Open items

### RR-001 — Story-marker presence not validated at DB level

**Severity**: Low  
**Area**: `packages/demo-data/src/validate.ts`

Story markers (e.g., `S0:standard-enrolled`) are embedded in `workflow_instances.context` for S0, and implicitly represented by deterministic enrolment IDs for S1–S6. The `validateScenario` function does not currently verify that every marker declared in `manifest.storyMarkers` has a corresponding row in the database.

**Proposed fix**: Add a story-marker resolution check per scenario that verifies each marker's expected record (by deterministic ID) exists with the correct data.

**Prerequisite**: Each scenario must document which table and deterministic ID corresponds to each story marker.

---

### RR-002 — RLS tenant-isolation not checked at the SQL policy level

**Severity**: Medium  
**Area**: `packages/demo-data/src/validate.ts`

The current `validateScenario` checks tenant_id data values but does not verify PostgreSQL row-level security (RLS) policies are active on the demo tenant. A misconfigured RLS policy could leak data between tenants without any validation error from the current checks.

**Proposed fix**: Add a pre-validation step that:
1. Connects using a restricted role (not superuser).
2. Sets `SET app.tenant_id = '<other_tenant>'`.
3. Verifies that `SELECT COUNT(*) FROM person` returns 0 (no cross-tenant leakage via RLS).

**Prerequisite**: A dedicated read-only validation role with RLS enforcement. Phase 11 security hardening.

---

### RR-003 — No live external endpoint check implemented

**Severity**: Medium  
**Area**: `packages/demo-data/src/validate.ts`

The Stage 10 plan specifies a check that "no live external endpoints" exist in the demo data (integration contracts, VLE registrations). This check is not implemented. It would prevent demo scenarios from accidentally triggering real external systems if loaded against a misconfigured environment.

**Proposed fix**: Add a check that all `integration_contract` rows for the demo tenant have a `base_url` that matches a known demo/stub domain (e.g., `*.demo.srs`, `http://localhost`, or `stub.*`).

**Prerequisite**: Review of what domain patterns are used in the S4 VLE integration data.

---

### RR-004 — Wellbeing role-gate validation not implemented

**Severity**: Medium  
**Area**: `packages/demo-data/src/validate.ts`

Phase 10.5 plan specifies that wellbeing role gates are validated. The validate.ts does not currently verify that wellbeing tables (in the `wellbeing` schema) have correct RLS policies or that special-category data is inaccessible without the `wellbeing-practitioner` role.

**Proposed fix**: Add a validate check that attempts to read wellbeing data as a non-privileged role and asserts access is denied. Requires the restricted-role infrastructure from RR-002.

**Prerequisite**: RR-002 infrastructure; Phase 8 wellbeing access-control documentation.

---

### RR-005 — S6 load time not measured against budget in CI

**Severity**: Low  
**Area**: `packages/demo-data/test/institution-year.int.test.ts`

The `institution-year.int.test.ts` test measures load time against the 30-minute budget within the same Testcontainers run. However, CI does not run this test on every pull request (it runs on a weekly schedule) because its load time exceeds PR budgets. No absolute load-time measurement is persisted across runs.

**Proposed fix**: Emit a `load_time_ms` metric from the test to a CI artifact, and create a trend chart (Grafana or similar) that flags regressions against the 30-minute budget before release.

**Prerequisite**: CI metrics pipeline; Phase 11 performance infrastructure.

---

### RR-006 — Playwright golden suite requires a running stack

**Severity**: Low  
**Area**: `e2e/golden/s0-smoke.spec.ts`, `playwright.golden.config.ts`

The golden Playwright suite (`pnpm test:e2e:playwright:golden`) requires a live API server, admin app, and demo data loaded. It skips automatically when the API is unreachable, but has not been verified to pass in a full-stack environment in CI.

**Proposed fix**: Wire the golden suite to a dedicated CI job that:
1. Starts the API and frontend containers.
2. Loads S0 golden data via `pnpm demo:reset --scenario ci-golden`.
3. Runs `pnpm test:e2e:playwright:golden`.

This is a Phase 11 CI infrastructure task.

---

### RR-007 — `clock.now()` callsite audit incomplete

**Severity**: Medium  
**Area**: `apps/api` broadly

The Stage 0 plan specifies auditing all `new Date()` / `Date.now()` callsites in the API to ensure they use `clockNow(offset)` rather than wall time. This audit was not completed during Phase 10.5.

**Proposed fix**: Add a custom ESLint rule (or grep CI check) that flags `new Date()` and `Date.now()` in `apps/api/src/**` unless in a comment or within `clock.ts` itself.

**Prerequisite**: ESLint custom rule authoring; Phase 11 code quality pass.

---

### RR-008 — Snapshot/restore strategy not implemented

**Severity**: Low  
**Area**: `docs/demo-rotation-runbook.md`

The Stage 9 plan specified a "backup/snapshot strategy for fast restore if a scenario load fails." The current runbook documents the checkpoint-resume mechanism but does not provide a pg_dump-based snapshot/restore procedure for fast rollback.

**Proposed fix**: Add a runbook section and optional pre-rotation snapshot script:
```sh
pg_dump -Fc "$DATABASE_URL" -f /tmp/demo-snapshot-$(date +%Y%m%d-%H%M%S).dump
```
And a corresponding restore command for the ops team.

**Prerequisite**: Hosted environment access; Phase 11 operations runbook pass.

---

### RR-009 — S1–S5 scenario validators are minimal

**Severity**: Low  
**Area**: `packages/demo-data/src/validate.ts`

The `SCENARIO_CHECKS` for `applicant-pipeline` and `enrolment-induction` only verify person counts and enrolment state presence. They do not validate admissions application records, SLC trigger counts, UCAS application statuses, or EC claim structures.

**Proposed fix**: Extend per-scenario checks to cover domain-specific records:
- `applicant-pipeline`: applications exist, offer statuses are covered
- `enrolment-induction`: SLC rows exist, fee liabilities exist
- `module-selection`: exam entries exist, waitlisted registrations exist
- `assessment-marks`: wellbeing cases exist (with `DEMO -` prefixes), EC claims exist

---

### RR-010 — Golden Playwright spec tenant_id is hardcoded

**Severity**: Low  
**Area**: `e2e/golden/s0-smoke.spec.ts`

The `injectStaffAuth` helper in the S0 golden spec falls back to `'test-golden'` as the tenant_id when the API `tenantId` field is not in the demo status response. The current `DemoStatusResponse` does not include `tenantId`.

**Proposed fix**: Extend `DemoStatusResponse` and `GET /api/v1/demo/status` to return the tenant ID (non-sensitive; the tenant_id is already in the JWT claims). Then remove the fallback in the golden spec.

---

## Resolved items

All Stage 10 primary deliverables are complete:

| Item | Status |
|---|---|
| `LoadPhase` type extended with `progression` and `corrections` | Complete |
| `validateScenario` implemented with fictional-data, bitemporal, volume, and per-scenario checks | Complete |
| `demo:rotate` CLI command and root workspace script | Complete |
| Playwright golden suite (`e2e/golden/s0-smoke.spec.ts`, `playwright.golden.config.ts`) | Complete |
| Phase 10.5 residual register (this document) | Complete |
| Phase 10.5 acceptance review | Complete |
| Local reset / scenario authoring runbook extended | Complete (via `docs/demo-rotation-runbook.md`) |
