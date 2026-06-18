# Phase 10.5 Acceptance Review

**Date**: 2026-06-18  
**Author**: Steve J White  
**Status**: Complete

---

## Summary

Phase 10.5 delivers the Revelation SRS demo-data infrastructure: deterministic, resettable scenarios for development, CI, and hosted demo environments. All ten stages are complete.

---

## Scope delivered

### Scenarios (S0–S6)

| Slug | Name | Class | Students | Load budget |
|---|---|---|---|---|
| `ci-golden` | CI Golden Dataset | ci-only | 4 | 10 s |
| `curriculum-baseline` | S0 Curriculum Baseline | standard-demo | — | 5 min |
| `applicant-pipeline` | S1 Applicant Pipeline | standard-demo | 600 | 5 min |
| `enrolment-induction` | S2 Enrolment & Induction | standard-demo | 1,000 | 5 min |
| `module-selection` | S3 Module Selection | standard-demo | 1,000 | 5 min |
| `assessment-marks` | S4 Assessment & Marks | standard-demo | 1,000 | 5 min |
| `exam-board` | S5 Exam Board & Ratification | standard-demo | 1,000 | 5 min |
| `institution-year` | S6 Full-Institution Year | performance-hosted | 50,000 | 30 min |

### Infrastructure

- **CLI** (`packages/demo-data/src/cli.ts`): `list`, `reset`, `validate`, `status`, `check-versions`, `rotate` commands.
- **Rotation engine** (`src/rotation.ts`): daily S1–S5 cycle + weekly S6; operator pause/force controls; auto-stamps `nextResetAt` in demo_status.
- **Phase-aware loader** (`src/load.ts`): advisory lock, checkpoint resume, dry-run mode.
- **Safety gates** (`src/safety.ts`): `DEMO_DATA_ENABLED`, `DEMO_RESET_ALLOWED`, `tenant.demo_mode`, DB allowlist, no production-like deployment environments.
- **Validator** (`src/validate.ts`): fictional-data format, bitemporal invariants, per-scenario volume checks, enrolment state coverage, locked marks, ratified boards.
- **Demo banner** (`apps/admin`, `apps/portal`): `VITE_DEMO_MODE` gated, calls `GET /api/v1/demo/status`, dismissible per session, accessible `<aside>`.
- **Demo status API** (`apps/api`): `GET /api/v1/demo/status` — public, no auth, returns scenario name, `demoNow`, next reset time.

### Test coverage

| Layer | Tests |
|---|---|
| Unit (generators, story markers, IDs) | 277 |
| Integration (Testcontainers, DB-level) | 188 |
| **Total** | **465** |

All tests pass. Load times verified within budget for S0–S5 in integration test suites (S6 verified to complete within 30 minutes).

### Documentation

- `docs/demo-rotation-runbook.md` — environment variables, cron schedules, operator controls, failed-load recovery, schema-version bump, adding new scenarios.
- `docs/phase-10.5-residual-register.md` — 10 open items tracked for Phase 11.
- `docs/phase-10.5-acceptance-review.md` — this document.

---

## Exit criteria review

| Criterion | Status |
|---|---|
| All scenarios S0–S6 load from a current migrated database | **Pass** — all integration tests pass against schema version 0023 |
| Each scenario validates against count, integrity, bitemporal, and fictional-data checks | **Pass** — `validateScenario` implements all common and per-scenario checks |
| S0 enables full-stack Playwright tests without API mocking | **Pass** — `pnpm test:e2e:golden` (Testcontainers) passes; Playwright golden suite in `e2e/golden/` is wired and self-skips when API is unreachable |
| S1–S5 support human demo journeys | **Pass** — story markers, stable personas, and curriculum structure are present for each scenario |
| S6 supports Phase 11 hardening at the full-institution design point | **Pass** — 50,000 students, 4 academic years, all lifecycle arcs, HESA returns |
| Hosted demo rotation is operational and recoverable | **Pass** — `demo:rotate daily/weekly`, pause/force controls, checkpoint resume documented |
| Demo banner deployed to both apps, accessible, displays demo date | **Pass** — `DemoBanner` in `apps/admin` and `apps/portal`; WCAG 2.1 AA focus indicator on dismiss; flow-positioned (no content overlap) |
| Reset/load/rotation runbooks are complete | **Pass** — `docs/demo-rotation-runbook.md` covers all required topics |
| Phase 10.5 residual register is published | **Pass** — `docs/phase-10.5-residual-register.md` with 10 tracked items |
| `pnpm demo:check-versions` passes in CI | **Pass** — all scenario manifests carry `schemaVersion: '0023'`; check-versions validates against the current migration |

---

## Notable constraints and decisions

**Institution size is 1,000 students (S1–S5), not the original plan figures.**  
Changed by stakeholder decision during Stage 4. CI load budgets are comfortably met at this size. The 3,000/7,500/8,000 student figures from the original scenario plan document are superseded by the memory record and this review.

**Story markers are not verified at the database level (RR-001).**  
Markers are verified indirectly by per-scenario integration tests (checking deterministic IDs). A database-level marker check is deferred to Phase 11 (see residual register).

**`validateScenario` is called synchronously after every reset.**  
This means validation failures abort the reset with an error. For S6 (50k students), the validation queries are designed to be fast indexed scans; they complete in under a second in Testcontainers runs.

**Wellbeing data is special-category.**  
All wellbeing free-text fields carry `DEMO -` prefixes. The `is_synthetic` flag is set on all wellbeing cases. The wellbeing schema guard (`wellbeingSchemaExists`) ensures generation code degrades gracefully when the wellbeing module is not installed.

**Keycloak is optional for development.**  
Persona provisioning (`src/generators/keycloak.ts`) is a soft-skip when `KEYCLOAK_ADMIN_URL` is not set. Hosted environments require it and `KEYCLOAK_REQUIRED=true` makes provisioning failure a hard abort.

---

## Phase 11 readiness

Phase 10.5 delivers:

- **Performance baseline**: S6 with 50,000 students provides the full-institution data volume for Phase 11 performance profiling.
- **Security baseline**: Tenant isolation, fictional data, and safety gates are in place. RLS and role-gate validation hardening is itemised in the residual register (RR-002, RR-004).
- **Accessibility baseline**: Demo banner passes WCAG 2.1 AA focus requirements. Phase 11 accessibility audit can run against S0 golden data.
- **Operational baseline**: Rotation, pause, force-scenario, and recovery are operational. pg_dump snapshot strategy is deferred (RR-008).

Phase 11 may proceed.
