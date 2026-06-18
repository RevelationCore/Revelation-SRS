# Demo Data Scenario Implementation Plan

> Date: 2026-06-17
> Status: Revised v2 — review findings addressed
> Roadmap placement: Phase 10.5, after Phase 10 UI completion and before Phase 11 hardening/open-source release

---

## Decision

Implement lifecycle demo data **before Phase 11**, as a dedicated Phase 10.5.

Phase 11 depends on credible, repeatable operational evidence: performance tests, accessibility journeys, demo-site runbooks, reset/restore procedures, and release validation. Those activities need realistic cross-domain data before hardening begins. Deferring demo data until after Phase 11 would make the release weaker, because the system would be hardened against small test fixtures rather than representative student-record lifecycles.

Phase 10 is the right prerequisite because the demo scenarios must exercise visible student, staff, tenant-admin, workflow, reporting, integration, and exam-board journeys. The scripts can be started earlier in parallel as technical groundwork, but the acceptance-ready scenario catalogue should be completed after the Phase 10 UI surfaces exist.

---

## Goal

Provide repeatable, realistic demo datasets that reset the current demo database state and load a named lifecycle scenario. The datasets must support a hosted demo site where the current state can be torn down and replaced on a schedule.

The demo data must be large enough to make the system feel institutional rather than toy-like, while remaining deterministic, safe to reset, and fast enough for hosted demo rotation.

A separate, smaller CI golden dataset (S0) must be available to run full-stack automated tests against a real backend without mocks.

---

## Principles

- Demo data is **synthetic only**. No copied real student, staff, marks, addresses, disability, EC, or regulatory data.
- Demo scenario loading is **environment-gated** and must never run against production-like tenants or databases.
- Demo data is **tenant-scoped**. Resetting a scenario clears and rebuilds only the demo tenant(s) and supporting demo-owned integration state.
- Scenario scripts are **idempotent**. Running the same load repeatedly produces the same named scenario version, record counts, and important identifiers.
- Scenarios are **lifecycle snapshots**, not isolated table dumps. Each dataset should tell a coherent story across Admissions, Student Records, Wellbeing, VLE, Regulatory, SLC/UCAS/UKVI statutory confirmations, workflows, audit, and UI journeys.
- Large datasets are generated from deterministic seeds and compact scenario definitions, not committed as huge SQL dumps.
- Demo data must respect bitemporal, audit, workflow, RLS, feature-flag, value-set, and integration-contract rules rather than bypassing them casually.
- Generators must use **clearly fictional data formats**: names drawn from a bounded fictional namespace, addresses using the `ZZ` reserved UK postcode prefix, NHS-style numbers outside valid ranges, and email domains under `demo.srs`. This ensures no generator output can accidentally match a real individual, which is a GDPR concern for open-source distribution of the scripts.
- **S1–S6 scenarios are independent snapshots** illustrating different lifecycle phases. Each can be loaded on its own. S6 is additionally designed as a *superset* containing story-marker students whose journeys span multiple phases, making it the single scenario for hosting and performance work.
- The **CI golden dataset (S0)** has different requirements from all demo scenarios: it must load in under ten seconds, cover state-machine surface rather than volume, and carry deterministic UUIDs that test code can hard-reference. It is designed for automated test reliability, not demo appeal.

---

## Data Layer Model

Four distinct layers; each serves a different consumer and has different size and latency requirements.

| Layer | Slug | Purpose | Size | Load time |
|---|---|---|---|---|
| Test fixtures | — | Transactional unit and integration tests (per-test factory functions, rolled back) | Tiny | Milliseconds |
| CI golden dataset | `ci-golden` | Full-stack E2E and contract tests against a real backend; deterministic UUIDs pinned in test code | ~100 students | < 10 s |
| Demo scenarios | `S1`–`S5` | Human demos, hosted rotation, scenario-specific UI journeys | Thousands to tens of thousands | < 5 min |
| Full-institution scenario | `S6` | Phase 11 performance, security, accessibility, and runbook baseline; superset with story markers | 50,000 students | < 30 min |

The existing unit and integration test fixtures remain small and fast. Demo scenarios do not replace them. The CI golden dataset fills the gap between per-test factories and full-volume demos for authenticated full-stack Playwright suites.

---

## Scenario Catalogue

### S0 - CI Golden Dataset

Purpose: provide a small, deterministic, version-pinned dataset that full-stack E2E tests and contract tests can run against without mocking the API.

Slug: `ci-golden`

Design constraints:
- One instance of every major entity type and lifecycle state — not volume
- Every key entity carries a committed, stable UUID published in `packages/demo-data/src/golden-ids.ts` so Playwright and integration tests can import them directly
- Covers state-machine surface: one student per status (`enrolled`, `intermitting`, `withdrawn`, `graduated`); one board in each status (`scheduled`, `open`, `ratified`); one approved EC; one active wellbeing case; one pending CAS request; one feature flag per variant type
- Academic year: 2024/25 only (single year keeps it simple)
- Reset must complete in under ten seconds on a standard CI runner

Primary test uses:
- Full-stack Playwright suites (Stage 11) — real API, real DB, real auth
- Contract tests verifying integration exchange format against real data
- Scenario-pinned axe scans against real page content density

### S1 - Applicant Pipeline

Purpose: demonstrate Admissions and pre-enrolment operations.

Slug: `applicant-pipeline`

Academic year: 2025/26 cycle (current year applications in progress)

Typical data:
- 600 applicants across UCAS, direct, agent, clearing, and international routes
- 11 programmes, 39 modules, baseline curriculum
- Offer states: submitted, under review, conditional, unconditional, rejected, withdrawn, deferred
- International applicants with CAS-readiness states
- Communications, workflow tasks, decision-gateway evidence, and audit records

Primary journeys:
- staff review application and conditions
- convert accepted applicant to enrolment-ready handoff
- inspect source-neutral Admissions data alongside UCAS evidence
- demonstrate workflow queues and variant routes

### S2 - Enrolment and Induction

Purpose: demonstrate student identity, enrolment, statutory trigger preparation, and student portal record visibility.

Slug: `enrolment-induction`

Academic years: 2024/25 (completed year, historical) and 2025/26 (current, in progress)

Typical data:
- 1,000 students, including new entrants, continuing students, intermitting students, withdrawals, and sponsored students
- 11 programmes, 39 modules, academic calendar, registration periods, fee-liability examples
- UCAS confirmation, SLC confirmation, UKVI CAS trigger records where relevant
- Contact details, addresses, demographics, identifiers, holds, and audit history

Primary journeys:
- staff create/view/update enrolment
- student views profile, programme, module registrations, timetable, and important dates
- tenant admin reviews value sets, rules, and integration status

### S3 - Module Selection Peak

Purpose: demonstrate high-volume module selection and staff override workflows.

Slug: `module-selection`

Academic year: 2025/26 (current, registration window open)

Typical data:
- 10,000 active students
- 1,400 modules with prerequisites, caps, timetable conflicts, optional/elective rules, and co-requisites
- 35,000 module registrations across draft, selected, confirmed, waitlisted, withdrawn, and override states
- Full academic-calendar windows for staged registration

Primary journeys:
- student searches and selects modules
- prerequisite and conflict feedback
- staff override and audit trail
- reporting on module demand, capacity pressure, and registration completion

### S4 - Assessment, Wellbeing, VLE, and Marks

Purpose: demonstrate VLE grade ingestion, assessment records, wellbeing case management, reasonable adjustments, and provisional results.

Slug: `assessment-marks`

Academic year: 2024/25 (completed assessments) and 2025/26 (in-progress)

Typical data:

Assessment:
- 7,500 students with module registrations
- 45,000 assessment component marks
- VLE connector mappings, inbound mark submissions, retries, conflict examples, and integration ledger records
- Moderation samples and provisional aggregation outputs

Wellbeing (Phase 8 domain — explicit coverage required):
- 150 students with active disability declarations across a range of condition types
- 40 DSA applications: submitted, in-progress, approved, and declined
- 20 mental health referrals with associated support plans in various states
- 8 panel decisions: approved, escalated, and deferred with panel minutes
- 120 approved adjustment outcome records distributed to VLE for a controlled subset
- 30 exceptional circumstances claims in various decision states feeding exam board S5
- Data classified as special-category in metadata; all free-text condition descriptions prefixed `DEMO - ` and flagged `is_synthetic: true`

Primary journeys:
- VLE submits marks
- staff reviews marks and exceptions
- wellbeing advisor creates and progresses a support case
- DPO audits access to special-category records
- student sees only publishable result states
- exam board receives pre-populated adjustment flags from wellbeing data
- integration operator inspects connector health and exchanges

### S5 - Exam Board and Ratification

Purpose: demonstrate board preparation, candidate profiles, progression, award classification, and record locking.

Slug: `exam-board`

Academic year: 2024/25 (post-assessment, boards in progress)

Typical data:
- 4,000 candidate profiles for module, progression, and award boards
- board memberships, agendas, data packs, exceptional circumstances, misconduct flags, adjustments from S4 wellbeing data, external examiner tasks
- progression decisions, resits, compensation/condonement examples, awards, classifications, HEAR/certificate records
- post-ratification locks plus a small number of correction/appeal workflows

Primary journeys:
- generate and review board data pack
- external examiner confirmation
- chair ratification and record lock
- student views ratified result/progression/award

### S6 - End-to-End Institution Year

Purpose: demonstrate a full institutional slice for public demo, performance testing, and release validation. Superset scenario: contains all S1–S5 populations plus story-marker students whose journeys span the full lifecycle.

Slug: `institution-year`

Academic years: 2022/23, 2023/24, 2024/25, 2025/26 — four full years of history to exercise bitemporal queries, correction workflows, and year-on-year regulatory comparisons.

Typical data:
- 50,000 students at the design point, generated in bands (new entrants, continuing, graduated, historical) to keep load time controllable
- Complete S1–S5 sub-populations at appropriate scale, sharing the same canonical curriculum baseline
- Story-marker students published in the manifest by name and UUID, traceable across all lifecycle phases (application → enrolment → modules → marks → board → graduation)
- Multiple cohorts per programme to demonstrate bitemporal correction and re-classification
- Multi-year HESA return history (one submitted, one in draft)
- VLE exchange ledger across two years with retry and conflict examples
- Full wellbeing caseload: disability declarations, DSA outcomes, panel decisions, adjustment distributions
- Integration health history including degraded and recovered states

Story-marker design: S6 contains at least six named story-marker students who are referenced by UUID in `packages/demo-data/src/story-markers.ts`. Each marker covers a distinct lifecycle archetype (standard full-time, intercalated year, international/CAS, wellbeing-supported, resit path, graduated with distinction). These stable UUIDs can be referenced in demos without navigating search results.

Primary journeys:
- all Phase 10 golden paths using story-marker identities
- Phase 11 performance and security smoke tests at 50k scale
- hosted demo rotation and restore validation

---

## Demo User Persona Catalogue

These personas are created in Keycloak (or the configured identity provider) as part of the demo tenant setup. They have stable sub-claim UUIDs published in `packages/demo-data/src/persona-ids.ts`. Passwords for hosted demo environments are set to a documented value (`Demo-2026!` or equivalent) and documented in the reset runbook.

| Persona | Email | Roles | Purpose |
|---|---|---|---|
| Registry Administrator | `registry@demo.srs` | `registry-administrator` | Primary staff demo account — full student record access |
| System Administrator | `sysadmin@demo.srs` | `system-administrator`, `tenant-administrator` | Tenant config, feature flags, system admin |
| Exam Board Chair | `chair@demo.srs` | `exam-board-chair`, `registry-administrator` | Board sign-off and ratification journeys |
| Wellbeing Advisor | `wellbeing@demo.srs` | `wellbeing-advisor` | Disability, support plan, EC journeys |
| DPO / Auditor | `dpo@demo.srs` | `dpo`, `wellbeing-auditor` | Special-category data access and audit |
| Student — enrolled | `alice.demo@demo.srs` | `student` | Standard enrolled student portal journey |
| Student — intermitting | `bob.demo@demo.srs` | `student` | Intermitting status, wellbeing case in progress |
| Student — graduated | `carol.demo@demo.srs` | `student` | Historical record, award visible, can log in to view transcript |
| External Examiner | `examiner@demo.srs` | `external-examiner` | Board review and comment journeys |
| Integration Operator | `ops@demo.srs` | `registry-administrator`, `tenant-administrator` | Integration health, failed exchanges, replay |

The Keycloak provisioning step (create or reset these accounts) is a distinct operation in the reset sequence and must be documented as such. See §Technical Design / Reset Strategy.

---

## Implementation Plan

### Stage 0 - Scope, Counts, and Safety Baseline

Deliverables:
- confirm scenario catalogue, target volumes, mandatory journeys, and CLI slugs (see §Technical Design / Scenario Slug Registry)
- classify each scenario: S0 as CI-only, S1–S5 as standard demo, S6 as performance/hosted
- define demo-only environment flags: `DEMO_DATA_ENABLED=true` and `DEMO_RESET_ALLOWED=true`
- **add `demo_mode` column to `tenant` table** (new migration `0022_demo_tenant_mode.sql`) — `boolean NOT NULL DEFAULT false`; this column is required by the reset safety check; no reset command can be built without it
- define protected-environment checks: `DEMO_DATA_ENABLED`, `deployment_environment.production_like=false`, `tenant.demo_mode=true`, database host/name allow-list
- document reset blast radius and data classifications
- specify academic year range per scenario (as defined in §Scenario Catalogue)
- establish load time budgets: S0 < 10 s, S1–S5 < 5 min, S6 < 30 min — enforced by Stage 8 validation
- define fictional data format rules: name namespace, `ZZ`-prefix postcodes, out-of-range synthetic IDs, `demo.srs` email domain

Exit criteria:
- no script can reset data unless demo mode is explicitly enabled
- `tenant.demo_mode` migration is merged and applied to all non-production environments
- scenario counts, slugs, academic year ranges, load time budgets, and acceptance journeys are agreed

### Stage 1 - Demo Data Package and CLI

Deliverables:
- create `packages/demo-data` for scenario definitions, deterministic generators, reset/load orchestration, and validation utilities
- add root scripts:
  - `pnpm demo:list` — lists available scenarios with slug, version, schemaVersion, and estimated load time
  - `pnpm demo:reset --scenario <slug>` — full reset and load
  - `pnpm demo:reset --scenario <slug> --dry-run` — shows records to delete/create without executing
  - `pnpm demo:validate --scenario <slug>` — validates an already-loaded scenario
  - `pnpm demo:status` — shows current loaded scenario, version, timestamp, and next scheduled rotation
- support dry-run output showing records to delete/create before any destructive operation
- use direct database access for bulk loading where appropriate, wrapped in tenant context and post-load validation
- expose a `GET /api/v1/demo/status` endpoint returning `{ scenarioSlug, scenarioName, schemaVersion, referenceDate, demoNow, loadedAt, nextResetAt }` — consumed by the demo site banner (Stage 8) and `pnpm demo:status`
- implement `clock.now()` utility in `apps/api/src/platform/clock.ts`: returns `new Date(Date.now() + clockOffsetMs)` when `tenant.demo_mode=true`, otherwise `new Date()`; all record creation and audit timestamp writes must use this utility — see §Academic Calendar Model
- add `clock_offset_ms` column to the demo status table (set when a scenario is loaded from its `referenceDate`; cleared on reset)

Schema versioning:
- each scenario manifest carries a `schemaVersion` field set to the minimum migration version the scenario requires (e.g. `"0022"`)
- the CLI validates `schemaVersion <= current applied migration version` before loading and aborts with a clear message if not
- a CI check (`pnpm demo:check-versions`) verifies all manifests are compatible with the current migration state
- breaking schema changes in Phase 11 must bump the affected scenario's `schemaVersion`

Transactional safety for long-running loads:
- each scenario load is divided into named phases (reference data, persons, enrolments, registrations, assessment, wellbeing, regulatory, boards, integration)
- each phase is committed atomically; a `demo_load_checkpoint` table records the last committed phase for the current scenario load
- if a load is interrupted, retry automatically resumes from the last committed phase
- for full-database demo environments, an alternative fast path is: load into a shadow tenant, validate, then swap the application connection; this avoids partial tenant state on failure

Exit criteria:
- loading an empty demo tenant with the `ci-golden` scenario is deterministic and repeatable
- reset refuses to run against protected environments
- `demo:check-versions` passes in CI against the current migration

### Stage 2 - CI Golden Dataset (S0)

Deliverables:
- implement `scenarios/ci-golden.ts` scenario at approximately 50–100 students
- publish stable UUIDs in `packages/demo-data/src/golden-ids.ts` for all key entities: one student per status, one board per status, one task per status, one integration registration, one feature flag per variant type
- publish story-archetype student UUIDs in `packages/demo-data/src/story-markers.ts` (used by both S0 and S6)
- scenario must load in under ten seconds; measure and fail the build if exceeded
- add `pnpm test:e2e:golden` script that: loads S0 onto a test database, starts the API, runs the full Playwright authenticated suite (not mock-based), then tears down
- update `packages/demo-data/src/persona-ids.ts` with demo persona UUIDs

Exit criteria:
- `pnpm test:e2e:golden` passes end-to-end in CI
- golden-ids and persona-ids are stable across repeated loads
- load time is under ten seconds

### Stage 3 - Reference and Curriculum Generator

Deliverables:
- deterministic UK HE curriculum model: faculties, schools, programmes, modules, credits, levels, prerequisites, periods, assessment patterns, and calendars
- generate the academic year structure for all required years per scenario (see §Scenario Catalogue for ranges), using **three terms per year** as the default — see §Academic Calendar Model below
- seed realistic value-set usage without duplicating migration-owned reference data
- generate tenant configuration, feature flags, workflow definitions, academic rules, and classification/progression rule fixtures needed by the scenarios

Exit criteria:
- generated curriculum supports all scenario journeys
- module registration and assessment scenarios can use the same canonical curriculum baseline
- generated academic calendar uses three terms per year; term dates, registration windows, and assessment periods are derived from the tenant calendar configuration, not hard-coded in individual generators

### Stage 4 - Student, Admissions, and Enrolment Generator

Deliverables:
- synthetic person/student generator using fictional data formats defined in Stage 0: `ZZ`-prefix postcodes, names from bounded namespace, `demo.srs` emails, identifiers outside production ranges
- source-neutral Admissions applications across UCAS, direct, agent, international, and clearing routes
- enrolments, fee-liability examples, SLC/UCAS/UKVI statutory trigger states, and student portal-ready records
- bitemporal history for selected identity/enrolment changes
- provision demo Keycloak personas (`packages/demo-data/src/persona-ids.ts`) via Keycloak Admin REST API call included in the reset sequence; persona provisioning is idempotent (create-if-not-exists, reset password)

Exit criteria:
- S1 and S2 load and validate at target volume
- staff and student Phase 10 golden paths can run against generated data
- demo personas can authenticate to both admin and portal apps

### Stage 5 - Module Registration and Timetable Scenario Data

Deliverables:
- module-selection windows, optional/elective rules, caps, conflicts, waitlists, and staff override cases
- module registrations at realistic distribution, including edge cases for prerequisite failures and timetable clashes
- timetable and exam-candidate seed data required for portal/admin views

Exit criteria:
- S3 loads and validates at target volume
- reporting pages show non-trivial module demand and completion distributions

### Stage 6 - Assessment, Wellbeing, VLE, and Regulatory Scenario Data

Deliverables:

Assessment and VLE:
- assessment components, marks, moderation states, provisional aggregation, and VLE inbound exchange ledgers
- connector health and retry examples for the operations UI

Wellbeing (explicit deliverable — Phase 8 domain):
- disability declarations covering a representative range of condition types, classified as special-category and labelled `is_synthetic: true` with `DEMO - ` prefix in all free-text fields
- DSA applications in each lifecycle state (submitted, in-progress, approved, declined)
- mental health referrals with associated support plans
- panel decisions (approved and escalated examples)
- approved adjustment outcome records distributed to VLE connector and flagged for exam board ingestion
- EC claims in various decision states (pending, approved, rejected) that carry through to S5 board candidate profiles
- wellbeing cases accessible only to personas with correct Phase 8 roles (`wellbeing-advisor`, `dpo`, `wellbeing-auditor`)

Regulatory:
- regulatory return drafts, validation issues, submission status examples, and integration exchange history
- HESA return in draft for current year; HESA return in submitted state for prior year
- SLC and UCAS confirmation records for applicable students

Exit criteria:
- S4 loads and validates at target volume
- VLE, Wellbeing, regulatory, and operations UI journeys have credible records
- wellbeing data is inaccessible to personas without Phase 8 roles (validated by scenario validator)

### Stage 7 - Exam Board, Progression, Award, and Locking Data

Deliverables:
- exam board schedules, memberships, agenda states, data packs, candidate profiles, EC/misconduct/adjustment flags (drawn from Stage 6 wellbeing data)
- progression decisions, resits, compensation/condonement examples, degree classifications, awards, and graduation records
- ratified and locked records plus correction/appeal examples

Exit criteria:
- S5 loads and validates at target volume
- record-lock and board workflows can be demonstrated end to end

### Stage 8 - Hosted Demo Rotation

Deliverables:
- scheduled reset job for hosted demo environments, using the same CLI/package as local operations
- scenario rotation configuration: for example daily S1–S5 rotation and weekly S6 full-institution load
- operational controls: pause rotation, force scenario, health check, reset audit log, and last-loaded scenario status
- backup/snapshot strategy for fast restore if a scenario load fails
- demo-site banner in both `apps/admin` and `apps/portal`:
  - both apps conditionally show a banner when `VITE_DEMO_MODE=true`
  - banner calls `GET /api/v1/demo/status` and displays: current scenario name, generated timestamp, next reset time, and a "Data resets every 24 hours" notice
  - banner must be dismissible per session and must not cover primary content on any supported viewport
  - accessibility: banner is a `<aside>` with `aria-label="Demo environment notice"` and visible focus ring on dismiss control

Exit criteria:
- hosted demo can tear down and load a scenario on schedule without manual intervention
- failed load leaves the environment in a known safe state or restores the previous snapshot
- demo site banner is visible in both apps, passes axe scan, and accurately reflects the current scenario state

### Stage 9 - Acceptance, Performance, and Documentation

Deliverables:
- scenario validation tests for record counts, referential integrity, workflow states, RLS isolation, bitemporal invariants, and UI golden-path readiness
- Playwright smoke journeys pinned to stable demo personas and story-marker UUIDs for each scenario
- load-time measurements against the budgets defined in Stage 0 (S0 < 10 s, S1–S5 < 5 min, S6 < 30 min); document any budget breach in a residual register
- runbook for local reset/load and hosted rotation
- documentation for adding a new scenario without creating large committed data dumps
- `pnpm demo:check-versions` passing in CI — confirms all scenario manifests are compatible with the current migration state

Exit criteria:
- all scenarios load, validate, and support their mapped UI journeys
- full-institution scenario is available for Phase 11 performance/security/accessibility work
- demo reset and rotation runbooks are ready for operational hardening
- load-time budgets are met or documented as Phase 11 residuals

---

## Technical Design

### Storage and Generation

Use compact scenario manifests and deterministic generators:

```text
packages/demo-data/
  src/
    cli.ts
    reset.ts
    load.ts
    validate.ts
    golden-ids.ts        ← stable UUIDs for CI golden dataset entities
    story-markers.ts     ← story-marker student UUIDs used by S0 and S6
    persona-ids.ts       ← demo user persona sub-claim UUIDs
    generators/
    scenarios/
      ci-golden.ts
      applicant-pipeline.ts
      enrolment-induction.ts
      module-selection.ts
      assessment-marks.ts
      exam-board.ts
      institution-year.ts
```

Each scenario manifest must declare:

```typescript
export const manifest = {
  slug:            'exam-board',           // kebab-case; matches file name
  name:            'S5 - Exam Board and Ratification',
  schemaVersion:   '0022',                 // minimum migration version required
  referenceDate:   '2026-06-19',           // fixed "today" for all generated timestamps; see §Academic Calendar Model
  academicYears:   ['2024/25'],
  targetVolumes:   { students: 4000, boards: 120 },
  loadTimeBudgetMs: 300_000,              // 5 minutes; CI fails if exceeded
  storyMarkers:    ['alice-demo', 'carol-demo'],
};
```

The `schemaVersion` field is the key schema-versioning mechanism. The load CLI reads the current applied migration version from the database and refuses to load any scenario whose `schemaVersion` is greater than the applied version. When a Phase 11 migration adds or renames columns that a generator writes to, the affected scenario's `schemaVersion` is bumped to match.

### Scenario Slug Registry

All valid slugs are defined in one place to avoid CLI inconsistencies:

| Scenario | Slug | File |
|---|---|---|
| CI Golden Dataset | `ci-golden` | `scenarios/ci-golden.ts` |
| S1 Applicant Pipeline | `applicant-pipeline` | `scenarios/applicant-pipeline.ts` |
| S2 Enrolment and Induction | `enrolment-induction` | `scenarios/enrolment-induction.ts` |
| S3 Module Selection Peak | `module-selection` | `scenarios/module-selection.ts` |
| S4 Assessment, Wellbeing, and Marks | `assessment-marks` | `scenarios/assessment-marks.ts` |
| S5 Exam Board and Ratification | `exam-board` | `scenarios/exam-board.ts` |
| S6 End-to-End Institution Year | `institution-year` | `scenarios/institution-year.ts` |

### Academic Calendar Model

The demo tenant is configured with a **three-term academic year** as the default, matching the dominant UK HE pattern:

| Term | Typical start | Typical end | Key windows |
|---|---|---|---|
| Autumn | Late September | Mid-December | Induction week; module registration (weeks 1–3); coursework submissions (weeks 8–12) |
| Spring | Mid-January | Late March | Module registration amendments (week 1); spring assessments (weeks 10–13) |
| Summer | Late April | Late June | Revision and examination period; exam boards (June) |

Each term record in the tenant academic calendar carries: term name, start date, end date, registration window open/close, assessment submission window open/close, and scheduled board date (Summer term). These fields drive relative timestamp generation throughout the scenario generators — registration deadlines, submission windows, and board meeting dates are derived from the calendar record, not hard-coded in each generator.

The term structure is **configurable**: institutions using a two-semester model or non-standard period boundaries can adjust the tenant academic calendar configuration. Scenario generators read from the tenant calendar rather than from a constant, so the same generator code produces correct dates for both term and semester institutions.

#### Scenario reference dates

The `referenceDate` in each manifest represents where within the academic calendar "today" sits when the scenario is active. All relative timestamps (created, updated, valid_from, valid_to, due dates, board dates) are expressed as `referenceDate ± offset` rather than using real wall-clock time.

| Scenario | Reference date | Term context |
|---|---|---|
| S0 `ci-golden` | 2025-11-14 | Autumn term week 8 — registration closed, first coursework deadlines approaching |
| S1 `applicant-pipeline` | 2025-11-14 | Autumn term week 8 — UCAS November deadline just passed, offers under review |
| S2 `enrolment-induction` | 2025-09-19 | Autumn term week 1 — induction complete, new entrants just matriculated |
| S3 `module-selection` | 2025-10-03 | Autumn term week 2 — registration window open |
| S4 `assessment-marks` | 2026-02-13 | Spring term week 4 — Autumn marks being moderated, spring assessments upcoming |
| S5 `exam-board` | 2026-06-19 | Summer term — examinations complete, boards in progress |
| S6 `institution-year` | 2025-11-14 | Autumn term week 8 — current year in progress, prior years historical |

#### Clock offset for user-created records

When a user creates or updates records during a live demo session, the API server uses a clock offset so that new timestamps are coherent with the scenario reference date rather than reflecting real wall-clock time. The offset is stored in the demo status table when a scenario is loaded:

```
clockOffsetMs = referenceDate.getTime() − Date.now()  (at load time)
```

A `clock.now()` utility in the API returns `new Date(Date.now() + clockOffsetMs)` when demo mode is active. All record creation, workflow scheduling, and audit timestamp writing must use `clock.now()` rather than `new Date()` directly. The `GET /api/v1/demo/status` endpoint returns the current demo date (not wall-clock time) so the banner can display the correct temporal context.

This is a Stage 1 infrastructure deliverable: the utility and the `clockOffsetMs` column must exist before any scenario data can be loaded.

### Reset Strategy

Preferred reset order:

1. acquire an advisory lock to prevent concurrent resets
2. assert demo mode: `DEMO_DATA_ENABLED=true`, `DEMO_RESET_ALLOWED=true`, `tenant.demo_mode=true`, `deployment_environment.production_like=false`, database host on allow-list
3. disable live external dispatch for the demo tenant (set `liveIntegrationsAllowed=false` on demo deployment environment)
4. **provision Keycloak demo personas** — call Keycloak Admin REST API to create-if-not-exists and reset passwords for all personas in `persona-ids.ts`; this is an idempotent step and must complete before any student records are written so persona sub-claim UUIDs can be used as foreign keys
5. truncate or delete demo-owned tenant data in dependency order
6. preserve migration-owned reference/value-set/configuration data unless the scenario explicitly owns a tenant override
7. load scenario data inside controlled batches, committing each phase atomically and recording phase progress in `demo_load_checkpoint`
8. run post-load validation
9. emit reset audit record and update `demo/status` endpoint state

For full database demo environments, a faster option may be supported:
- drop/recreate demo database from migrated baseline
- apply scenario loader
- switch application connection only after validation succeeds

Tenant-scoped reset is still required for local and shared non-production use.

### Safety Controls

Required controls:
- reset command refuses to run unless `DEMO_DATA_ENABLED=true`
- reset command refuses production-like environments: `deployment_environment.production_like=true`
- reset command refuses tenants without `tenant.demo_mode=true` — **this column must be added by migration `0022_demo_tenant_mode.sql` in Stage 0; no reset command can be implemented without it**
- reset command refuses unknown database host/name patterns unless an explicit allow-list is configured
- destructive operations are wrapped in advisory locks and audit records
- live integrations are disabled or redirected to stubs during reset
- synthetic sensitive data carries `is_synthetic: true` in relevant metadata fields and `DEMO - ` prefix in all free-text fields that could otherwise be mistaken for real personal data

### Validation

Each scenario must validate:
- expected record counts by domain
- referential integrity beyond database constraints where workflows/events require semantic links
- RLS tenant isolation smoke checks
- bitemporal date ranges and transaction-time rules
- workflow instance/task states
- integration ledger consistency
- no accidental live integration endpoints (`liveIntegrationsAllowed` must be false on the demo environment)
- fixed demo personas can authenticate and reach expected UI journeys
- wellbeing special-category data is inaccessible to roles without Phase 8 permissions

---

## Relationship to Existing Test Fixtures

Current pinned fixtures and integration tests should remain small, focused, and fast. Demo datasets should not replace unit/integration fixtures. The CI golden dataset fills the specific gap of full-stack E2E tests against a real backend.

| Layer | Purpose | Size |
|---|---|---|
| Test fixtures | Deterministic per-test unit/integration factories, rolled back in transactions | Tiny |
| CI golden dataset (S0) | Full-stack E2E and contract tests; deterministic UUIDs; real API, real DB | ~100 students |
| Demo scenarios (S1–S5) | Human demos and hosted rotation | Thousands to tens of thousands |
| Full-institution scenario (S6) | Phase 11 performance/security/accessibility/runbook baseline | 50,000-student design point |

---

## Phase 11 Impact

Phase 10.5 should feed Phase 11 directly:
- performance testing uses S6 rather than synthetic API-only scripts
- security testing validates reset refusal and cross-tenant isolation under realistic data
- accessibility audit uses real page density, long names, result tables, board packs, and reporting screens against story-marker identities
- operational documentation includes demo reset, restore, scheduled rotation, and failure recovery
- release documentation can point adopters to meaningful demo scenarios
- the CI golden dataset (S0) unlocks full-stack Playwright suites in Phase 11 without requiring mock overrides

---

## Risks

| Risk | Mitigation |
|---|---|
| Reset script wipes the wrong data | environment gates, `tenant.demo_mode` column (migration required), database allow-list, advisory lock, dry run, audit |
| Demo data bypasses domain rules and hides bugs | use domain services where correctness matters; validate invariants after bulk inserts |
| Scenario loading becomes too slow | deterministic batch inserts, migrated baseline snapshots, separate standard vs performance scale; load-time budget enforced in Stage 9 |
| Demo data becomes stale as schema changes | `schemaVersion` in manifest, `demo:check-versions` in CI, mandatory bump on breaking migration |
| Generated data looks unrealistic | domain-specific distributions, named story markers, realistic curriculum structures, long-tail edge cases |
| Hosted rotation collides with users mid-demo | visible reset schedule, pause control, countdown/banner, reset outside peak windows |
| Keycloak persona provisioning fails mid-reset | idempotent create-if-not-exists, Keycloak step runs first before any data write, failure aborts cleanly |
| Wellbeing special-category data escapes role gates | validator checks role-gated access; `is_synthetic` flag and `DEMO - ` prefix prevent confusion with real data |
| CI golden dataset UUIDs drift from code | `golden-ids.ts` is the single source of truth; tests import from it rather than hard-coding; breaking change requires explicit bump |
| Demo personas can authenticate to wrong environments | persona provisioning step is inside the environment-gated reset sequence; personas are only created in environments with `tenant.demo_mode=true` |
| Open-source distribution of generators touches GDPR | fictional data format rules enforced by generator (ZZ postcodes, `demo.srs` domain, bounded name namespace); validated in Stage 9 |

---

## Acceptance Summary

Phase 10.5 is complete when:
- all scenarios S0–S6 load from a current migrated database with `tenant.demo_mode` in place
- each scenario resets in under its load time budget
- scenario validation passes in CI or scheduled non-production jobs
- Phase 10 UI golden paths can run against named demo personas and story-marker identities
- the CI golden dataset (S0) enables `pnpm test:e2e:golden` to pass end-to-end without API mocking
- hosted demo rotation is documented and operational
- demo site banner is deployed to both apps, accessible, and reflects live scenario state
- Phase 11 can use S6 for performance, security, accessibility, and runbook validation
