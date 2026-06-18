# Phase 10.5 Implementation Plan - Demo Data Scenarios and Hosted Demo Rotation

> Date: 2026-06-17
> Status: Draft
> Prerequisite: Phase 10 complete
> Roadmap: `docs/project-roadmap.md` Phase 10.5
> Source requirement: `docs/demo-data-scenario-plan.md`

---

## Overview

Phase 10.5 turns the demo-data scenario requirement into an implementation sequence. It creates deterministic, resettable lifecycle datasets for Revelation SRS, ranging from a small CI golden dataset to a full 50,000-student institutional scenario.

This phase sits between Phase 10 and Phase 11. Phase 10 provides the UI journeys that the scenarios must exercise. Phase 11 then uses these scenarios for performance, security, accessibility, deployment, operational runbook, and release validation.

The implementation must keep demo data separate from migration-owned reference data and from small unit/integration test fixtures. Demo data is generated from compact, deterministic scenario manifests and loaders, not committed as large SQL dumps.

---

## Target Outcomes

By the end of Phase 10.5:

- `packages/demo-data` exists as the canonical demo scenario package;
- scenario manifests exist for S0 through S6, with stable slugs, schema versions, target volumes, academic years, and load-time budgets;
- `tenant.demo_mode` and demo load-state/checkpoint storage exist in the database;
- demo reset commands refuse production-like environments and non-demo tenants;
- S0 `ci-golden` supports full-stack Playwright and contract tests against a real API and database;
- S1-S5 provide realistic independent lifecycle snapshots for human demos;
- S6 `institution-year` provides a 50,000-student superset for hosted demo and Phase 11 hardening;
- demo personas are provisioned idempotently in Keycloak or the configured identity provider;
- both `apps/admin` and `apps/portal` show an accessible demo banner when demo mode is enabled;
- hosted demo rotation can reset, validate, recover, pause, and report current scenario status.

---

## Stage Dependency Graph

```text
Stage 0   Scope, safety baseline, and schema gates
    |
Stage 1   Demo data package, CLI, clock utility, status API, and checkpointing
    |
Stage 2   CI golden dataset and full-stack E2E harness
    |
Stage 3   Reference, curriculum, rules, and calendar generator
    |
Stage 4   Student, Admissions, enrolment, and persona provisioning
    |
Stage 5   Module registration, timetable, and exam-candidate data
    |
Stage 6   Assessment, Wellbeing, VLE, and regulatory scenario data
    |
Stage 7   Exam board, progression, award, and locking data
    |
Stage 8   Full-institution scenario (S6)
    |
Stage 9   Hosted demo rotation and demo-site banner
    |
Stage 10  Acceptance, performance measurement, and documentation
```

Stages are sequential because later scenarios depend on shared deterministic identifiers, curriculum structures, academic years, personas, and lifecycle records created earlier. S6 must be built after all sub-scenario generators are complete (Stages 3–7). Stage 9 (hosted rotation) requires S6 as the weekly full-institution load. Stage 10 validates the complete chain.

---

## Stage 0 - Scope, Safety Baseline, and Schema Gates

**Status**: Complete

**Goal**: establish the non-negotiable safety model, scenario contract, and database schema gates before any reset command can delete data.

### Scope

- Confirm the scenario catalogue from `docs/demo-data-scenario-plan.md`:
  - S0 `ci-golden`;
  - S1 `applicant-pipeline`;
  - S2 `enrolment-induction`;
  - S3 `module-selection`;
  - S4 `assessment-marks`;
  - S5 `exam-board`;
  - S6 `institution-year`.
- Classify scenarios:
  - S0 as CI-only;
  - S1-S5 as standard demo;
  - S6 as performance/hosted.
- Confirm target volumes, academic year ranges, load-time budgets, mandatory journeys, and fixed slugs.
- Define fictional data rules:
  - bounded fictional name namespace;
  - `ZZ`-prefix UK postcodes;
  - `demo.srs` email domain;
  - out-of-range synthetic identifiers;
  - `is_synthetic: true` metadata and `DEMO - ` prefix for sensitive free-text fields.
- Add migration `0022_demo_tenant_mode.sql`:
  - add `tenant.demo_mode boolean NOT NULL DEFAULT false`;
  - demo load status and checkpoint tables are owned by Stage 1, not this migration — Stage 0 only delivers `tenant.demo_mode` and the environment gate columns.
- Define protected-environment checks:
  - `DEMO_DATA_ENABLED=true`;
  - `DEMO_RESET_ALLOWED=true`;
  - `tenant.demo_mode=true`;
  - `deployment_environment.production_like=false`;
  - database host/name allow-list.
- Document reset blast radius by table/domain.

### Deliverables

- Scenario slug and volume baseline.
- Demo data safety decision record or section in this plan.
- Migration for `tenant.demo_mode`.
- Initial demo load-state/checkpoint schema decision.
- Fictional data-format rules.

### Exit Criteria

- No reset implementation can proceed without `tenant.demo_mode`.
- Safety gates and environment checks are agreed.
- Scenario slugs, academic years, target volumes, and load-time budgets are baselined.

---

## Stage 1 - Demo Data Package, CLI, Clock Utility, Status API, and Checkpointing

**Status**: Complete

**Goal**: create the reusable implementation substrate for every scenario.

### Scope

- Create `packages/demo-data` with:
  - `cli.ts`;
  - `reset.ts`;
  - `load.ts`;
  - `validate.ts`;
  - `golden-ids.ts`;
  - `story-markers.ts`;
  - `persona-ids.ts`;
  - `generators/`;
  - `scenarios/`.
- Add scenario manifest support:
  - `slug`;
  - `name`;
  - `schemaVersion`;
  - `referenceDate` — fixed "today" string used by all generators in place of `Date.now()`;
  - `academicYears`;
  - `targetVolumes`;
  - `loadTimeBudgetMs`;
  - `storyMarkers`;
  - phase list.
- Add root scripts:
  - `pnpm demo:list`;
  - `pnpm demo:reset --scenario <slug>`;
  - `pnpm demo:reset --scenario <slug> --dry-run`;
  - `pnpm demo:validate --scenario <slug>`;
  - `pnpm demo:status`;
  - `pnpm demo:check-versions`.
- Implement schema-version checks against the current applied migration version.
- Implement advisory locking so concurrent resets cannot run.
- Implement load phases and checkpoints:
  - reference data;
  - persons;
  - enrolments;
  - registrations;
  - assessment;
  - wellbeing;
  - regulatory;
  - boards;
  - integration.
- Implement dry-run output showing reset and load counts before destructive operations.
- Implement `clock.now()` utility at `apps/api/src/platform/clock.ts`:
  - returns `new Date(Date.now() + clockOffsetMs)` when `tenant.demo_mode = true`;
  - returns `new Date()` otherwise;
  - all record creation, audit timestamp, and workflow due-date writes in the API must use this utility from this stage onward.
- Add demo status table to `packages/db` (owned by a new migration in this stage, not Stage 0):
  - `demo_status`: current scenario slug, schema version, reference date, clock offset ms, loaded at, next reset at;
  - `demo_load_checkpoint`: current scenario slug, last committed phase name, updated at.
- Add `GET /api/v1/demo/status` returning:
  - `scenarioSlug`;
  - `scenarioName`;
  - `schemaVersion`;
  - `referenceDate`;
  - `demoNow` — current server time as seen through the demo clock;
  - `loadedAt`;
  - `nextResetAt`.
  - Route this endpoint in `apps/api/src/routes/demo.ts`; no authentication required (public read) so the banner can call it before login; register in `apps/api/src/app.ts`.
- Declare `packages/demo-data` dependencies explicitly:
  - `packages/db` — Drizzle client and schema for direct bulk inserts;
  - `packages/domain` — domain types, event schemas, and value-set constants;
  - `packages/workflow` — workflow definition types for generating task instances;
  - no dependency on `apps/api` — generators write directly to the database, not through the HTTP layer.

### Deliverables

- `packages/demo-data` with declared workspace dependencies.
- `clock.now()` utility in `apps/api`.
- Demo status and checkpoint tables (migration in this stage).
- CLI commands and root `package.json` script wiring.
- Scenario manifest registry.
- Checkpoint/resume implementation.
- Demo status API endpoint, route file, and public registration.
- CI check for manifest schema versions.

### Exit Criteria

- `ci-golden` can be listed and dry-run loaded.
- Reset refuses protected environments.
- `pnpm demo:check-versions` passes.
- Interrupted scenario load can resume from the last committed phase.
- `GET /api/v1/demo/status` returns 200 with current state (or an empty-state response if no scenario is loaded); accessible without authentication.
- `clock.now()` is implemented and used by at least one record-creation path; all other usages audited and tracked as a Stage 1 task.

---

## Stage 2 - CI Golden Dataset and Full-Stack E2E Harness

**Status**: Complete

**Goal**: provide a small deterministic dataset for reliable full-stack automated tests.

### Scope

- Implement `scenarios/ci-golden.ts`.
- Generate approximately 50-100 students covering state-machine breadth rather than volume.
- Publish stable UUIDs in `golden-ids.ts` for:
  - one student per major status;
  - one board per major status;
  - one workflow task per major status;
  - one integration registration;
  - one feature flag per variant type;
  - representative wellbeing, regulatory, mark, and award records.
- Publish shared story-marker UUIDs in `story-markers.ts`.
- Publish demo persona sub-claim UUIDs in `persona-ids.ts`.
- Add `pnpm test:e2e:golden`:
  - start/reset a test database;
  - load S0;
  - start API and required frontends;
  - run authenticated Playwright tests against real backend state;
  - tear down.
- Enforce S0 load time under ten seconds on a standard CI runner.

### Deliverables

- S0 scenario implementation.
- Stable ID exports.
- Golden E2E script and CI job wiring.
- Initial real-backend Playwright smoke coverage.

### Exit Criteria

- `pnpm test:e2e:golden` passes end to end.
- S0 loads under ten seconds.
- Stable IDs do not drift across repeated loads.

---

## Stage 3 - Reference, Curriculum, Rules, and Calendar Generator

**Status**: Complete

**Goal**: establish one canonical academic/curriculum baseline consumed by all standard and full-institution scenarios.

### Scope

- Generate deterministic faculties, schools, departments, programmes, routes, modules, offerings, credits, levels, learning outcomes, prerequisites, co-requisites, and exclusions.
- Generate academic years and academic calendar using **three terms per year** as the default (Autumn: late September–mid-December; Spring: mid-January–late March; Summer: late April–late June), matching the UK HE standard. Term boundaries, registration windows, assessment submission windows, and board dates are properties of the tenant academic calendar record; generators derive all relative dates from these properties rather than hard-coding values per scenario. A two-semester or custom period model can be substituted by changing the tenant calendar configuration without changing any generator.
- Use existing migration-owned value sets; do not duplicate platform reference data.
- Generate tenant-level configuration required by scenarios:
  - feature flag assignments;
  - workflow definitions and assignment rules where tenant overrides are required;
  - academic rules;
  - progression and classification configurations;
  - environment safety configuration.
- Validate that generated curriculum is compatible with S1-S6 target journeys.

### Deliverables

- Curriculum/reference generators.
- Academic-calendar generator.
- Tenant configuration generator.
- Rule and flag fixtures for demo tenants.

### Exit Criteria

- Shared curriculum baseline can be loaded independently.
- Module registration and assessment scenarios can reuse the same baseline.
- Generated data respects migration-owned value sets and tenant scoping.

---

## Stage 4 - Student, Admissions, Enrolment, and Persona Provisioning

**Status**: Complete (2026-06-17)

**Goal**: implement applicant, identity, enrolment, and authentication data needed for S1 and S2.

### Scope

- Implement synthetic person/student generator using Stage 0 fictional data rules.
- Generate source-neutral Admissions applications across:
  - UCAS;
  - direct;
  - agent;
  - international;
  - clearing.
- Generate application states, offers, conditions, decision gateway evidence, communications, and workflow tasks.
- Generate enrolments, lifecycle statuses, fee-liability examples, UCAS confirmations, SLC confirmations, UKVI CAS trigger states, student portal records, contact details, addresses, demographics, identifiers, holds, and audit history.
- Add selected bitemporal history for identity and enrolment changes.
- Provision demo personas through Keycloak Admin REST API or configured identity provider:
  - create-if-not-exists;
  - reset password;
  - assign roles;
  - preserve stable sub-claim UUIDs from `persona-ids.ts`.
- Ensure persona provisioning runs before student records using persona identifiers are written.
- Define Keycloak fallback behaviour explicitly:
  - in local development without a running Keycloak, persona provisioning logs a warning and continues — demo records are still created, but personas cannot authenticate until Keycloak is started separately;
  - in hosted demo environments (`DEMO_RESET_ALLOWED=true`), persona provisioning failure is a hard abort — a reset without working personas is considered incomplete and the demo status endpoint should reflect the failure.

### Deliverables

- S1 `applicant-pipeline`.
- S2 `enrolment-induction`.
- Person, Admissions, and enrolment generators.
- Idempotent persona provisioning step.
- Authentication smoke tests for admin and portal demo users.

### Exit Criteria

- S1 and S2 load and validate at target volume.
- Demo personas can authenticate to both apps.
- Phase 10 staff and student golden paths run against generated data.

---

## Stage 5 - Module Registration, Timetable, and Exam-Candidate Data

**Status**: Complete (2026-06-17)

**Goal**: implement high-volume module-selection data for S3 and support portal/admin registration journeys.

### Scope

- Generate module-selection windows, optional/elective choices, caps, prerequisite failures, co-requisite failures, timetable clashes, waitlists, withdrawals, and staff overrides.
- Generate realistic registration distributions across programmes, cohorts, and periods.
- Generate timetable and exam-candidate records required by student portal and staff admin screens.
- Add audit and workflow records for staff override cases.
- Add reporting distributions for module demand, capacity pressure, and registration completion.

### Deliverables

- S3 `module-selection`.
- Registration/window/capacity generators.
- Timetable and exam-candidate demo records.
- Staff override and reporting seed data.

### Exit Criteria

- S3 loads and validates at target volume.
- Student module-selection journeys have realistic edge cases.
- Reporting pages show non-trivial demand and completion distributions.

---

## Stage 6 - Assessment, Wellbeing, VLE, and Regulatory Scenario Data

**Status**: Pending

**Goal**: implement S4 with assessment volume, Phase 8 Wellbeing coverage, VLE exchanges, and regulatory evidence.

### Scope

- Generate assessment components, submissions, marks, moderation states, provisional aggregation, and publishable/non-publishable result states.
- Generate VLE connector mappings, inbound mark submissions, retry examples, conflict examples, connector health, and integration ledger history.
- Generate Wellbeing data:
  - disability declarations;
  - DSA applications;
  - mental health referrals;
  - support plans;
  - panel decisions;
  - approved adjustment outcomes;
  - EC claims.
- Ensure Wellbeing data is marked as special-category where appropriate, `is_synthetic: true`, and uses `DEMO - ` free-text prefixes.
- Ensure approved adjustments are distributed to VLE and available for exam-board ingestion.
- Generate regulatory examples:
  - HESA draft and submitted returns;
  - validation issues;
  - SLC and UCAS confirmations;
  - UKVI CAS and visa-status examples where applicable.
- Validate role-gated Wellbeing access using Phase 8 permissions.

### Deliverables

- S4 `assessment-marks`.
- Assessment and VLE generators.
- Wellbeing scenario generator.
- Regulatory status/exchange generator.
- Access-control validation for special-category demo data.

### Exit Criteria

- S4 loads and validates at target volume.
- VLE, Wellbeing, regulatory, and operations UI journeys have credible data.
- Wellbeing data is inaccessible to personas without the correct Phase 8 roles.

---

## Stage 7 - Exam Board, Progression, Award, and Locking Data

**Status**: Pending

**Goal**: implement S5 board and ratification data, including progression, awards, locks, and post-ratification examples.

### Scope

- Generate exam board schedules, memberships, agendas, data packs, candidate profiles, external examiner tasks, chair tasks, and board status variations.
- Generate EC, misconduct, and adjustment flags on candidate profiles, drawing from Stage 6 Wellbeing and assessment data.
- Generate progression decisions, resits, compensation/condonement examples, degree classifications, awards, graduation records, HEAR/certificate records, and student-visible results.
- Generate ratified and locked records.
- Generate a small number of correction and appeal workflows.
- Validate record-lock constraints and formal correction paths.

### Deliverables

- S5 `exam-board`.
- Board data-pack and candidate-profile generators.
- Progression, classification, award, lock, correction, and appeal seed data.
- Board workflow validation.

### Exit Criteria

- S5 loads and validates at target volume.
- Record-lock and board workflows can be demonstrated end to end.
- Student result/progression/award portal journeys work against ratified demo records.

---

## Stage 8 - Full-Institution Scenario (S6)

**Status**: Pending

**Goal**: build the `institution-year` superset scenario that is required by Stage 9 hosted rotation (weekly full-institution load) and by Phase 11 performance, security, and accessibility hardening.

### Scope

- Implement `scenarios/institution-year.ts` using the generators from Stages 3–7 combined at full scale.
- Generate four academic years of history (2022/23, 2023/24, 2024/25, 2025/26) to exercise bitemporal queries, year-on-year regulatory comparisons, and multi-cohort progression.
- Generate story-marker students covering the six lifecycle archetypes defined in `story-markers.ts`:
  - standard full-time (Autumn start, linear progression);
  - intercalated year (suspension and return);
  - international student with CAS lifecycle;
  - wellbeing-supported student (disability declaration, DSA, adjusted assessments, board flags);
  - resit path (failed module, resit sit, re-board);
  - graduated with distinction (full arc through to award and HEAR).
- Generate multi-year HESA return history (one submitted per prior year, one in draft for current year).
- Generate VLE exchange ledger across two years with retry and conflict examples.
- Generate full wellbeing caseload at institution scale, using the same generators as Stage 6.
- Generate integration health history including degraded and recovered states.
- S6 is explicitly a superset: every S1–S5 sub-population is present at appropriate relative scale within the total institution.
- Enforce load time under thirty minutes; record actual load time against budget.

### Deliverables

- S6 `institution-year` scenario implementation.
- Story-marker students validated as stable across repeated loads.
- Multi-year regulatory and VLE history.
- Load time measurement against the thirty-minute budget.

### Exit Criteria

- S6 loads and validates at target volume.
- All six story-marker archetypes are present and traceable across lifecycle phases.
- Story-marker UUIDs in `story-markers.ts` are stable across repeated loads.
- S6 can be used as the weekly rotation scenario in Stage 9.
- Load time is under thirty minutes or the breach is documented as a Phase 11 residual.

---

## Stage 9 - Hosted Demo Rotation and Demo-Site Banner

**Status**: Pending

**Goal**: make the demo scenarios operational for a hosted demo site.

### Scope

- Implement scheduled reset jobs for hosted demo environments using the same `packages/demo-data` CLI.
- Add scenario rotation configuration:
  - daily S1-S5 rotation;
  - weekly S6 full-institution load;
  - operator override for forced scenario.
- Add operational controls:
  - pause rotation;
  - force scenario;
  - health check;
  - reset audit log;
  - last-loaded scenario status;
  - failed-load recovery.
- Implement backup/snapshot strategy for fast restore if a scenario load fails.
- Implement demo banner in both `apps/admin` and `apps/portal`:
  - enabled only when `VITE_DEMO_MODE=true`;
  - calls `GET /api/v1/demo/status` and displays: scenario name, current demo date (`demoNow`), next reset time, and "Data resets every 24 hours" notice;
  - dismissible per session (dismissed state stored in `sessionStorage`);
  - does not cover primary content on supported viewports;
  - implemented as `<aside aria-label="Demo environment notice">`;
  - dismiss control has visible focus ring;
  - the `DemoBanner` component lives in each app independently (`apps/admin/src/components/DemoBanner.tsx` and `apps/portal/src/components/DemoBanner.tsx`) — it is not shared via `packages/ui` because the two apps have different layout roots and the banner's positioning differs.
- Document the required environment variables for a hosted demo deployment:
  - `DEMO_DATA_ENABLED=true` — unlocks the reset CLI;
  - `DEMO_RESET_ALLOWED=true` — required for destructive reset in hosted environments;
  - `VITE_DEMO_MODE=true` — enables the demo banner in both frontends (build-time);
  - `DEMO_DB_ALLOWLIST` — comma-separated list of permitted database host patterns;
  - `KEYCLOAK_ADMIN_URL` — Keycloak Admin REST API base URL for persona provisioning;
  - `KEYCLOAK_ADMIN_CLIENT_ID` / `KEYCLOAK_ADMIN_CLIENT_SECRET` — service account credentials for persona provisioning;
  - `DEMO_ROTATION_CRON` — cron expression for the daily reset schedule (default: `0 3 * * *`);
  - `DEMO_S6_ROTATION_CRON` — cron expression for the weekly S6 load (default: `0 1 * * 0`).

### Deliverables

- Hosted demo reset/rotation job configuration.
- Rotation state and operator controls.
- Snapshot/recovery procedure.
- Demo banner in both apps.
- Banner accessibility and viewport tests.
- Hosted environment variable reference documented in the reset runbook.

### Exit Criteria

- Hosted demo can tear down and load a scenario without manual intervention.
- Failed load leaves the environment in a known safe state or restores the previous snapshot.
- Demo banner is visible, accessible, dismissible, and accurate in both apps.
- All required hosted environment variables are documented and validated in a pre-flight check.

---

## Stage 10 - Acceptance, Performance Measurement, and Documentation

**Status**: Pending

**Goal**: prove all scenarios, reset flows, UI journeys, and operational procedures are ready for Phase 11.

### Scope

- Add validation tests for each scenario:
  - record counts by domain;
  - referential integrity;
  - bitemporal invariants;
  - RLS tenant isolation;
  - workflow states;
  - integration ledger consistency;
  - no live external endpoints;
  - Wellbeing role gates;
  - fictional data-format compliance.
- Add Playwright smoke journeys pinned to stable demo personas and story-marker UUIDs for each scenario.
- Measure load times against budgets defined in Stage 0:
  - S0 under ten seconds;
  - S1-S5 under five minutes each;
  - S6 under thirty minutes.
- Produce a Phase 10.5 residual register — **this register is mandatory regardless of whether any budget breaches occur**; it should carry forward any known gaps, sub-optimal generator approaches, or Phase 11 hardening items identified during implementation.
- Add runbooks:
  - local reset/load;
  - hosted rotation;
  - pause/force scenario;
  - failed-load recovery;
  - adding a new scenario;
  - schema-version bump process.
- Produce Phase 10.5 acceptance review.

### Deliverables

- Scenario validators.
- Full demo Playwright smoke suite.
- Load-time report.
- Runbooks and scenario authoring guide.
- Phase 10.5 acceptance review.
- Phase 10.5 residual register (unconditional).

### Exit Criteria

- All scenarios S0-S6 load, validate, and support their mapped UI journeys.
- `pnpm test:e2e:golden` passes without API mocks.
- `pnpm demo:check-versions` passes in CI.
- Hosted rotation is operational in a non-production environment.
- S6 is available for Phase 11 performance, security, accessibility, and runbook validation.
- Phase 10.5 residual register is published and reviewed.

---

## Implementation Notes

### Package Boundary

`packages/demo-data` owns generation, reset orchestration, scenario manifests, stable IDs, validation utilities, and CLI entry points. It depends on `packages/db` (direct Drizzle client for bulk inserts), `packages/domain` (domain types and event schemas), and `packages/workflow` (workflow definition types). It does **not** depend on `apps/api` — generators write directly to the database, not through the HTTP layer. Domain services remain the source of truth where correctness under business rules matters. Bulk inserts are acceptable for high-volume records when followed by invariant validation.

### Scenario Manifests

Each scenario exports a manifest with at least:

```typescript
export const manifest = {
  slug:             'exam-board',
  name:             'S5 - Exam Board and Ratification',
  schemaVersion:    '0022',
  referenceDate:    '2026-06-19',   // fixed "today" for all generated timestamps
  academicYears:    ['2024/25'],
  targetVolumes:    { students: 4000, boards: 120 },
  loadTimeBudgetMs: 300_000,
  storyMarkers:     ['alice-demo', 'carol-demo'],
};
```

### Reset Order

The canonical reset sequence is:

1. Acquire advisory lock.
2. Verify demo environment gates (`DEMO_DATA_ENABLED`, `DEMO_RESET_ALLOWED`, `tenant.demo_mode`, `deployment_environment.production_like=false`, database allow-list).
3. Disable live external dispatch for the demo tenant.
4. Provision identity-provider personas (hard abort on failure in hosted environments; warn-and-continue in local development without Keycloak).
5. Clear demo-owned tenant data in FK-safe dependency order (see §FK-Safe Load Ordering).
6. Preserve migration-owned reference data unless a tenant override is scenario-owned.
7. Compute and store clock offset: `clockOffsetMs = Date.parse(manifest.referenceDate) − Date.now()`.
8. Load scenario phases with checkpoint commits, in FK-safe order.
9. Validate scenario invariants.
10. Record scenario status, clock offset, and audit event; `GET /api/v1/demo/status` now reflects the new scenario.

### FK-Safe Load Ordering

Scenario data must be loaded in dependency order to avoid foreign-key violations. The canonical phase sequence is:

1. Tenant configuration overrides (academic rules, feature flags, workflow definitions)
2. Academic calendar (years, terms, periods, registration windows)
3. Curriculum (faculties → schools → programmes → modules → offerings)
4. Persons and identity records
5. Admissions applications and offer states
6. Enrolments and statutory trigger records (SLC, UCAS, UKVI)
7. Module registrations and timetable records
8. Assessment components and marks
9. Wellbeing records (declarations → DSA → referrals → panel decisions → adjustments → EC claims)
10. VLE connector mappings and exchange ledger
11. Regulatory return drafts and submission records
12. Exam boards, memberships, and candidate profiles
13. Progression decisions, awards, locks, and corrections
14. Integration health history

Truncation during reset must run in reverse order or use `TRUNCATE … CASCADE` within the demo tenant scope.

### Testing Strategy

#### Generator unit tests

Each generator module must have unit tests that verify deterministic output for a given seed — the same manifest and seed must always produce identical records.

#### Reset/load integration tests

The load and reset orchestration is tested against a real test database (not a mock). These tests run in the same CI tier as other `pnpm test:int` tests. They cover: reset refusal on protected environments, advisory locking, checkpoint resume, schema version mismatch, and dry-run output accuracy.

#### CI golden dataset (S0) — real-backend E2E

`pnpm test:e2e:golden` loads S0 onto a fresh test database and runs Playwright tests against the real API. This job runs on every pull request alongside the existing `pnpm test:e2e` mock-based suite.

**Coexistence model**: the two E2E suites are complementary. The mock-based suite (`e2e/*.spec.ts`) tests UI behaviour and page rendering against controlled, predictable data. The real-backend suite (`e2e/golden/*.spec.ts`) tests full-stack integration correctness using stable UUIDs from `golden-ids.ts`. Both suites run in CI; the mock suite is faster and runs first. A failure in the real-backend suite does not block the mock suite from reporting.

#### S1–S5 validation

Scenario validation tests (record counts, invariants, role gates) run on a scheduled CI job — not every pull request — because load times exceed pull-request budgets. The schedule: nightly on the `main` branch, and on every release branch creation.

#### S6 validation

S6 runs on a weekly scheduled job and before every release candidate. It is the Phase 11 performance baseline; its load time is recorded on every run and tracked against the thirty-minute budget.

---

## Risks

| Risk | Mitigation |
|---|---|
| Reset affects the wrong data | Environment gates, `tenant.demo_mode`, DB allow-list, advisory lock, dry run, audit |
| Demo data drifts from schema | Scenario `schemaVersion`, `demo:check-versions`, CI validation |
| Loads are too slow | Batch inserts, checkpoint resume, baseline snapshots, explicit load-time budgets |
| Demo data bypasses business rules | Use domain services where correctness matters; validate invariants after bulk writes |
| Personas drift from RBAC expectations | Stable `persona-ids.ts`, idempotent provisioning, authentication smoke tests |
| Wellbeing data leaks across roles | Phase 8 permission validation and special-category access checks |
| Generated data resembles real people | Fictional namespace, `ZZ` postcodes, `demo.srs` emails, synthetic metadata validation |
| Hosted reset interrupts demos | Visible reset schedule, pause control, operator override, reset outside peak windows |
| `clock.now()` missed in a record-creation path | Audit all `new Date()` / `Date.now()` callsites in Stage 1 and track as a checklist; add a lint rule or grep CI check |
| Clock offset causes JWT expiry or TLS issues | `clock.now()` is only used for application record timestamps, not for system clock functions; Keycloak token exchange and TLS use real wall time |
| Keycloak unavailable during hosted reset | Persona provisioning is the first step after env-gate checks; failure aborts before any data is deleted, leaving the previous scenario intact |
| Term structure mismatch between tenant calendar and generator assumptions | Generators read term dates from the tenant calendar record, not from constants; generated calendar is validated against expected term count before loading student data |

---

## Phase 10.5 Acceptance Gate

Phase 10.5 is complete when:

- all scenarios S0-S6 load from a current migrated database with `tenant.demo_mode` in place;
- each scenario validates against count, integrity, RLS, bitemporal, workflow, integration, access-control, and fictional-data checks;
- S0 enables full-stack Playwright tests without API mocking;
- S1-S5 support human demo journeys;
- S6 supports Phase 11 hardening at the full-institution design point;
- hosted demo rotation is operational and recoverable;
- the demo banner is deployed to both apps, passes accessibility checks, and displays the current demo date from the clock offset;
- reset/load/rotation runbooks are complete;
- Phase 10.5 residual register is published.
