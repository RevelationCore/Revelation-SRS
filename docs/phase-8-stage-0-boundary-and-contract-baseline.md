# Phase 8 Stage 0 — Boundary and Contract Baseline

> Date: 2026-06-15
> Status: Complete
> Phase: 8 — Student Wellbeing & Disability (first-party module)

---

## Purpose

This document establishes the implementation boundary for the Student Wellbeing & Disability module before any code is written. It classifies data ownership, resolves the package and deployment structure, defines the Keycloak role matrix, maps every integration contract the module uses, and records all gaps that are deferred to Phase 9/10.

---

## 1. Module Boundary — What Wellbeing Owns

The core rule: the Wellbeing module owns its own domain data. It never writes directly to SRS-owned tables. Approved academic outcomes (adjustments, EC flags) are handed back to SRS through approved internal REST APIs. SRS is the sole distribution point for those outcomes to downstream systems.

### Wellbeing-owned data

| Entity | Data class | Notes |
|--------|------------|-------|
| Wellbeing case | Standard Personal | Top-level case record linking student to all Wellbeing activity |
| Disability support case | Special Category | DSA/disability casework |
| DSA entitlement record | Special Category | DSA awarded support, assessment outcome |
| Evidence reference | Sensitive / Special Category | Metadata and EDRMS reference only; no binary storage |
| Reasonable adjustment case | Special Category | Adjustment assessment, panel decision |
| Adjustment assessment | Special Category | Disability advisor assessment notes |
| Adjustment panel decision | Special Category | Panel outcome and scope |
| Exceptional circumstances claim | Sensitive / Special Category (where health-related) | EC submission, grounds, affected period/modules |
| EC evidence review | Sensitive | Evidence notes and status |
| EC determination | Standard Personal | Outcome, determination date; Wellbeing-local unless upheld |
| Mental health case | Special Category | Clinical notes; must remain Wellbeing-local |
| Intervention plan | Special Category | Action steps, review dates |
| Early warning alert record | Standard Personal | Alert signal and triage status; no clinical payload |
| SRS context projection | Standard Personal | Local read-model from SRS events; not authoritative |

### SRS-owned data that Wellbeing reads (not writes)

| Data | Access path | Contract |
|------|-------------|----------|
| Student identity and enrolment | `GET /api/v1/students/{personId}`, enrolments endpoints | `wellbeing-student-context.v1` (F053) |
| Disability declarations | `GET /api/v1/students/{personId}/disability-declarations` | `wellbeing-student-context.v1` (F053) |
| Module registrations | SRS context projection via `srs.enrolment.module-registered` event | Event subscription |
| Academic performance indicators | SRS context projection via `srs.assessment.mark-received` | Event subscription |
| Adjustment distribution status | `srs.adjustment.distributed` event | Event subscription |
| Ratified results | `srs.assessment.module-result-ratified` event | Event subscription |

### SRS-owned data that Wellbeing writes (via approved API only)

| Write operation | SRS endpoint | Contract | Auth |
|-----------------|-------------|----------|------|
| Post approved adjustment outcome | `POST /api/v1/students/{personId}/adjustments` | `wellbeing-adjustment-outcome.v1` (F063) | `wellbeing-advisor` service account |
| Post EC claim / update | `POST /api/v1/students/{personId}/exceptional-circumstances` | `wellbeing-ec-outcome.v1` (F066) | `wellbeing-advisor` service account |
| Update EC record | `PATCH /api/v1/exceptional-circumstances/{ecId}` | `wellbeing-ec-outcome.v1` (F066) | `wellbeing-advisor` service account |
| Post misconduct outcome | `POST /api/v1/students/{personId}/misconduct-outcomes` | Out of Phase 8 scope — see §6 |

**Invariant**: Wellbeing must never call `srs.adjustment.distributed` or any downstream system (VLE, Attendance, Exams) directly. SRS publishes `srs.adjustment.approved` and `srs.adjustment.distributed` autonomously after receiving the outcome via F063.

---

## 2. Package and Deployment Structure

### Decision

The `modules/wellbeing` package is a **separate Fastify service** within the pnpm monorepo. It shares the same PostgreSQL cluster and NATS JetStream instance as the SRS core but runs as its own Node.js process and Docker Compose service.

This matches the architecture decision in `docs/architecture/system-architecture.md`: "First-party modules are separate deployable Node.js services that share the SRS PostgreSQL database (with their own schemas)."

### Package layout

```
modules/
  wellbeing/
    package.json          # @revelation-srs/wellbeing
    tsconfig.json
    src/
      app.ts              # Fastify app builder
      main.ts             # process entry point
      config.ts           # env-var config
      routes/             # Wellbeing REST routes (staff UI + internal)
      services/           # Domain services
      repositories/       # Drizzle query layer against wellbeing schema
      workflows/          # Temporal workflow definitions and activities
      consumers/          # NATS JetStream event consumers
      projections/        # SRS context projection updaters
    test/
      ...int.test.ts
```

### Database schema

The Wellbeing module uses a dedicated PostgreSQL schema `wellbeing` within the shared cluster. Migrations follow the same Drizzle + numbered-migration pattern as `packages/db`, but under a Wellbeing-local migration directory:

```
modules/wellbeing/src/db/
  schema/           # Drizzle table definitions
  migrations/       # 0001_wellbeing_initial.sql, etc.
  client.ts         # Drizzle client configured for wellbeing schema
```

This keeps Wellbeing schema changes isolated from SRS core migrations. The `packages/db` package is not extended for Wellbeing-owned tables; it is used as a shared library only for the RLS helpers (`withTenantContext`) and shared type utilities.

### Shared packages used (read-only)

| Package | Usage |
|---------|-------|
| `@revelation-srs/domain` | `EVENT_TYPES` constants and event payload types for subscriptions |
| `@revelation-srs/db` | `withTenantContext` RLS helper; shared Drizzle client utilities |
| `@revelation-srs/auth` | JWT verification middleware |
| `@revelation-srs/testing` | Testcontainers helpers for integration tests |

### Docker Compose service

```yaml
wellbeing:
  build:
    context: .
    dockerfile: infra/docker/wellbeing/Dockerfile
  ports:
    - "3001:3001"
  environment:
    DATABASE_URL: postgres://srs:srs@postgres:5432/srs
    NATS_URL: nats://nats:4222
    SRS_API_URL: http://api:3000
    TEMPORAL_ADDRESS: temporal:7233
  depends_on:
    - postgres
    - nats
    - temporal
```

The Wellbeing service runs on port `3001`. The SRS API URL is injected for SRS handoff calls (F063, F066).

---

## 3. Keycloak Role Matrix

### Existing role (Phase 7)

| Role | Scope | Used in |
|------|-------|---------|
| `wellbeing-advisor` | Disability advisor / wellbeing practitioner — read disability declarations, adjustments, EC records; write approved outcomes to SRS | Phase 7 integration class endpoints; Phase 8 SRS handoff |

### New roles for Phase 8

| Role | Actor | Permitted reads | Permitted writes |
|------|-------|-----------------|-----------------|
| `wellbeing-mental-health-advisor` | Mental health practitioner | Mental health cases, intervention plans, student context projection, UKVI alerts | Mental health cases, intervention plans, early warning alert triage |
| `wellbeing-panel-chair` | Adjustment panel chair | Full adjustment case including assessment notes; DSA entitlement | Panel decision outcome |
| `wellbeing-academic-reviewer` | Academic staff contributing to adjustment assessment | Student module registrations (via SRS projection); adjustment assessment (read-only until they submit their input) | Adjustment assessment input (own review section only) |
| `wellbeing-registry-reviewer` | Registry staff contributing to adjustment and EC workflows | Adjustment cases and EC claims allocated to them; student enrolment and module data (via SRS projection) | Workflow task completion (review input only) |
| `wellbeing-auditor` | Compliance / audit staff | Read-only access to all Wellbeing case records, audit logs, and retention schedules | None |

### Role separation rules

- `wellbeing-advisor` and `wellbeing-mental-health-advisor` are separate roles. A disability advisor does not automatically see clinical mental health notes.
- `wellbeing-panel-chair` can read assessment notes written by `wellbeing-advisor` and `wellbeing-academic-reviewer` but cannot override a determination; panel decisions are a distinct workflow task.
- `wellbeing-auditor` is read-only with no workflow task access.
- All roles are tenant-scoped via JWT claims. A multi-tenant deployment never shares Wellbeing records across tenants.

---

## 4. Integration Contract Map

### Events Wellbeing subscribes to

Consumer group: `wellbeing.{institution-code}.main`

| Subject | Data class | Why subscribed | Registry status |
|---------|------------|----------------|-----------------|
| `srs.student.enrolled` | personal | Update student context projection | published — `wellbeing-module` consumer |
| `srs.student.status-changed` | personal | Update enrolment status in projection; may close open cases | published — `wellbeing-module` consumer |
| `srs.student.disability-declaration-updated` | special-category | Align disability support case with SRS declaration | published — `wellbeing-module` consumer |
| `srs.enrolment.module-registered` | standard | Track active modules for adjustment scope validation | published (via projection) |
| `srs.enrolment.module-registration-withdrawn` | standard | Remove module from adjustment scope | published (via projection) |
| `srs.assessment.mark-received` | standard | Update academic performance indicator projection | published — `wellbeing-module` consumer |
| `srs.assessment.module-result-ratified` | standard | Close relevant open EC flags in projection | published (via projection) |
| `srs.adjustment.approved` | sensitive | Confirm SRS has recorded adjustment; update distribution tracking | published — `wellbeing-module` consumer |
| `srs.adjustment.distributed` | sensitive | Track which downstream systems have received the adjustment | published — `wellbeing-module` consumer (**added at Stage 0**) |
| `srs.adjustment.expired` | sensitive | Mark adjustment as expired in Wellbeing projection | published — `wellbeing-module` consumer |
| `srs.circumstances.exceptional-circumstances-flagged` | sensitive | Confirm SRS has recorded EC flag | published — `wellbeing-module` consumer |
| `srs.circumstances.exceptional-circumstances-updated` | sensitive | Confirm SRS EC update acknowledged | published — `wellbeing-module` consumer |
| `srs.regulatory.ukvi-visa-status-updated` | regulatory | Trigger potential immigration advice intervention workflow | published — `wellbeing-module` consumer |
| `srs.regulatory.ukvi-compliance-alert-raised` | regulatory | Trigger immigration advice appointment workflow | published — `wellbeing-module` consumer |

Note: `srs.enrolment.module-registered` and `srs.assessment.module-result-ratified` are used by the projection layer but `wellbeing-module` is not yet declared as a consumer in the registry. These should be added at Stage 2 when the projection is implemented, following the same process as the `srs.adjustment.distributed` fix.

### REST contracts Wellbeing calls into SRS

| Contract ID | Flow | Endpoint | Auth | Purpose |
|-------------|------|----------|------|---------|
| `wellbeing-student-context.v1` | F053 | `GET /api/v1/students/{personId}` and related | `wellbeing-advisor` service account | Read student profile, disability declarations, enrolment data for casework |
| `wellbeing-adjustment-outcome.v1` | F063 | `POST /api/v1/students/{personId}/adjustments` | `wellbeing-advisor` service account | Transmit approved adjustment outcome to SRS |
| `wellbeing-ec-outcome.v1` | F066 | `POST /api/v1/students/{personId}/exceptional-circumstances` | `wellbeing-advisor` service account | Transmit upheld EC claim to SRS for board visibility |
| `wellbeing-ec-outcome.v1` | F066 | `PATCH /api/v1/exceptional-circumstances/{ecId}` | `wellbeing-advisor` service account | Update an EC record (evidence status, severity) |

Both F063 and F066 endpoints are `integration`-class in the Phase 7 OpenAPI spec. The `wellbeing-advisor` service account must be provisioned with the `integration` scope.

### Wellbeing REST surface (Wellbeing-owned, not SRS-facing)

Wellbeing exposes its own REST API for staff UIs and workflow commands. These are not published in the SRS OpenAPI spec — they are internal to the `modules/wellbeing` service. Classification:

| Surface | Class | Examples |
|---------|-------|---------|
| Staff case management | `internal` | CRUD for wellbeing cases, disability cases, mental health cases |
| Workflow commands | `workflow` | Disability advisor assessment submission, panel decision recording, EC determination |
| SRS handoff commands | `internal` | Trigger SRS adjustment/EC submission from Wellbeing workflow |
| Audit and reporting | `reporting` | Case statistics, retention reports (no special-category payload) |
| Health/readiness | `operational` | `GET /health`, `GET /ready` |

---

## 5. Workflows

### W002 — Reasonable Adjustment Case Management

Source: `docs/requirements/workflow-catalogue.md` § W002

**Actors**: Student, Disability Advisor (`wellbeing-advisor`), Specialist Assessor (external, no system role), Academic Reviewer (`wellbeing-academic-reviewer`), Registry (`wellbeing-registry-reviewer`), Panel Chair (`wellbeing-panel-chair`)

**States**: `referral_received` → `assessment_pending` → `under_assessment` → `determination_made` → `approved` | `rejected` → `under_review` → `review_complete` → `closed`

**SRS handoff**: on reaching `approved`, the Wellbeing Temporal activity calls `POST /api/v1/students/{personId}/adjustments` with idempotency key `adj-{wellbeingCaseId}-{outcomeDraftId}`. SRS then owns distribution to VLE, Attendance, Exams.

### W003 — Exceptional Circumstances Determination

Source: `docs/requirements/workflow-catalogue.md` § W003

**Actors**: Student, Wellbeing Practitioner (`wellbeing-advisor`), Registry (`wellbeing-registry-reviewer`)

**States**: `submitted` → `evidence_pending` | `under_review` → `upheld` | `not_upheld` → `closed`

**SRS handoff**: on reaching `upheld`, Wellbeing calls `POST /api/v1/students/{personId}/exceptional-circumstances` with idempotency key `ec-{wellbeingCaseId}-{claimRef}`. Rejected/not-upheld claims remain local to Wellbeing unless the institution configures board visibility for not-upheld claims.

### W004 — Mental Health and Early Intervention (Phase 8 scope)

No counterpart in Phase 7 SRS workflow catalogue — this workflow is entirely Wellbeing-local.

**Actors**: Mental Health Advisor (`wellbeing-mental-health-advisor`), Student, UKVI alert signal (system)

**Trigger**: `srs.regulatory.ukvi-compliance-alert-raised` event; early-warning signals (see §6 gap 2); or staff referral.

**States**: `alert_received` → `triage_pending` → `under_intervention` → `referred` | `resolved` → `closed`

**SRS handoff**: none — mental health case outcomes do not flow to SRS. Clinical notes and intervention records remain Wellbeing-local.

---

## 6. Gap Register

### Gap 1 — `srs.adjustment.distributed` consumer (Resolved)

`wellbeing-module` was not listed as a consumer of `srs.adjustment.distributed` in `schemas/events/registry.json`. **Fixed at Stage 0**: `wellbeing-module` added to the consumers list. Stage 6 contract tests now pass for this event.

### Gap 2 — Early-warning alert events from Attendance Monitoring / BI (Deferred)

No event subjects for attendance-based early-warning signals exist in the Phase 7 registry (F028/F056 are not SRS-owned flows). The **Stage 6 access pattern decision** for Phase 8 is:

**Option C — Defer attendance-based early-warning to Phase 9; scope Stage 6 to UKVI signals only.**

Rationale: `srs.regulatory.ukvi-compliance-alert-raised` is already published, subscribed, and contract-tested. Building a placeholder internal event for Attendance/BI alerts would require defining a contract with a system that is not yet in scope. Phase 9 (VLE Connector) will establish patterns for external system signals; the attendance early-warning integration is natural Phase 9/10 work.

Phase 8 Stage 6 therefore implements:
- UKVI compliance alert → intervention workflow (via existing published event)
- Staff-initiated mental health case creation and management
- Early warning alert records can be seeded manually via a Wellbeing staff API if required for testing

### Gap 3 — EDRMS live integration (Deferred to Phase 9/10)

The integration contract catalogue defines `document-archive-submission.v1` (F023) as an outbound SRS contract, not a Wellbeing contract. Wellbeing stores evidence _references_ (EDRMS document IDs, URLs) but does not directly integrate with the EDRMS in Phase 8. Stage 3 provides a simulator mode: a configurable EDRMS adapter interface that can be pointed at a stub service for local development and tests.

### Gap 4 — Additional module registry entries (Stage 2)

When the Stage 2 projection is implemented, `wellbeing-module` should be added as a consumer of:
- `srs.enrolment.module-registered` (currently no `wellbeing-module` consumer)
- `srs.enrolment.module-registration-withdrawn` (currently no `wellbeing-module` consumer)
- `srs.assessment.module-result-ratified` (currently no `wellbeing-module` consumer)

These should be added to `schemas/events/registry.json` as part of Stage 2, following the same process as the Gap 1 fix.

### Gap 5 — Misconduct outcomes (Out of scope)

`POST /api/v1/students/{personId}/misconduct-outcomes` is documented in the Phase 7 Wellbeing integration walkthrough but misconduct panels are operated by Registry / Academic Governance, not the Wellbeing service. This endpoint is explicitly **out of Phase 8 scope**. It may be assigned to a future Misconduct & Academic Integrity module.

### Gap 6 — `wellbeing-mental-health-advisor`, `wellbeing-panel-chair`, `wellbeing-academic-reviewer`, `wellbeing-registry-reviewer`, `wellbeing-auditor` Keycloak roles (Stage 7)

These five roles are defined in §3 above. They are not yet provisioned in Keycloak. Stage 1 will define them in configuration; Stage 7 will harden and test the permission matrix. The existing `wellbeing-advisor` role is sufficient to build and test Stages 2–5.

---

## 7. Retention and Privacy Summary

| Data entity | Retention | Lawful basis | Notes |
|-------------|-----------|-------------|-------|
| Disability support case | Duration of study + 6 years | Legal Obligation (Equality Act 2010) | Special category; read-audit required |
| DSA entitlement records | Duration of study + 6 years | Legal Obligation (Equality Act 2010) | Special category |
| Evidence references | Duration of case + 3 years | Explicit Consent | Metadata only; binary retained by EDRMS |
| Reasonable adjustment case | Duration of study + 6 years | Legal Obligation (Equality Act 2010) | Special category; read-audit required |
| EC claim and evidence | Duration of study + 3 years | Explicit Consent / Legitimate Interests | Special category where health-related |
| EC determination | Duration of study + 6 years | Legitimate Interests | Standard personal |
| Mental health case | Duration of case + 6 years (clinical minimum) | Explicit Consent | Special category; clinical minimum retention applies |
| Intervention plan | Duration of case + 6 years | Explicit Consent | Special category |
| SRS context projection | Derive from source events; no independent retention | N/A — derivative | Can be replayed; purge follows student record closure |
| Access logs (special category reads) | Duration of student record + 6 years | Legal Obligation (UK GDPR Article 30) | Must log every read by role and timestamp |

---

## 8. Exit Criteria Check

- [x] Every Phase 8 data owner and integration path is classified (§1, §4)
- [x] No Phase 8 implementation requires writing directly to SRS-owned tables outside approved SRS APIs (§1 invariant)
- [x] All missing contract gaps are either resolved or explicitly assigned to Phase 9/10 (§6)
- [x] Package structure decided (§2)
- [x] Keycloak role matrix agreed (§3)
- [x] `srs.adjustment.distributed` registry fix applied (§6 Gap 1)
- [x] Stage 6 early-warning access pattern decided: Option C — UKVI signals only, attendance deferred (§6 Gap 2)

Stage 1 (module scaffold and database schema) may begin.
