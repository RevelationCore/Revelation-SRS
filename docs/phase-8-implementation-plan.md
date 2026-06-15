# Phase 8 Implementation Plan - Student Wellbeing & Disability

> Date: 2026-06-15
> Status: Complete — all stages 0–8 done
> Prerequisite: Phase 7 complete
> Roadmap: `docs/project-roadmap.md` Phase 8

---

## Overview

Phase 8 builds the Student Wellbeing & Disability module as the reference first-party module. It validates that a first-party module can run as a separate deployable unit, own its own domain data, consume SRS context through published contracts, and hand approved academic outcomes back to SRS without bypassing SRS-owned domain logic.

The module covers disability and DSA records, reasonable adjustment casework, exceptional circumstances, mental health and early intervention casework, and inbound SRS context needed by wellbeing staff.

---

## Target Outcomes

By the end of Phase 8:

- the `modules/wellbeing` service is scaffolded, buildable, testable, and deployable;
- Wellbeing-owned data lives in a dedicated schema with tenant isolation, audit, and retention metadata;
- Wellbeing consumes the Phase 7 event contracts it needs for student, enrolment, assessment, adjustment, circumstances, and UKVI context;
- reasonable adjustment approvals are transmitted to SRS and distributed from SRS to downstream targets;
- exceptional circumstances decisions are transmitted to SRS and surfaced for board preparation;
- mental health and early intervention casework can consume risk and alert signals without leaking special-category data;
- the first-party module pattern is documented and covered by acceptance tests.

---

## Stage Dependency Graph

```text
Stage 0  Boundary and contract baseline
    |
Stage 1  Module scaffold and database schema
    |
Stage 2  SRS context ingestion
    |
Stage 3  Disability and evidence management
    |
Stage 4  Reasonable adjustment workflow
    |
Stage 5  Exceptional circumstances workflow  ← can run parallel with Stage 4
    |
Stage 6  Mental health and early intervention
    |
Stage 7  Security, privacy, audit, and retention hardening
    |
Stage 8  End-to-end acceptance review
```

Stage 5 (EC workflow) can proceed in parallel with Stage 4 (adjustment workflow) — both depend on Stage 2 context ingestion and Stage 3 disability case records. Stage 4 is **not** independent of Stage 3: the adjustment workflow scopes and validates against DSA entitlement and disability support case records that Stage 3 creates, so Stage 4 must wait for Stage 3. Stage 7 should be designed from Stage 0, but it is completed after all sensitive read/write surfaces exist.

---

## Stage 0 - Boundary and Contract Baseline

**Status**: Complete — `docs/phase-8-stage-0-boundary-and-contract-baseline.md`

**Goal**: make the first-party module boundary explicit before implementation starts.

### Scope

- Confirm which data is Wellbeing-owned and which data remains SRS-owned.
- Reconcile Phase 8 flows against the Phase 7 contract index:
  - F023 disability and evidence/document storage;
  - F053 inbound SRS context;
  - F063 approved reasonable adjustment outcomes;
  - F066 approved exceptional circumstances outcomes;
  - F028/F056 early warning and engagement alerts;
  - F059/F060/F061 downstream adjustment distribution from SRS.
- Classify every Wellbeing API as internal first-party, staff UI, workflow command, or operational.
- Define event subscriptions, consumer groups, replay requirements, and dead-letter handling.
- Define the rule that Wellbeing never distributes adjustment outcomes directly to VLE, Attendance, Exams, or venues.
- Decide the package and deployment structure for `modules/wellbeing`:
  - separate Fastify service or co-located with the SRS API;
  - shared `packages/db` migration infrastructure or a module-local migration path;
  - shared `packages/domain` event types or module-local copies;
  - separate Docker Compose service / Kubernetes deployment or co-located with the SRS API container.
- Produce a Keycloak role matrix for all Wellbeing actor types:
  - `wellbeing-advisor` (already defined in Phase 7);
  - `wellbeing-mental-health-advisor` (clinical casework, separate from disability);
  - `wellbeing-panel-chair` (adjustment panel decisions);
  - `wellbeing-academic-reviewer` (academic component of adjustment assessment);
  - `wellbeing-registry-reviewer` (registry input to adjustment and EC);
  - `wellbeing-auditor` (read-only access to audit and retention records).
- Explicitly mark **out of scope for Phase 8**:
  - Misconduct outcome management — `POST /api/v1/students/{personId}/misconduct-outcomes` exists in Phase 7 but misconduct panels are not Wellbeing-owned; defer to Phase 10 or a separate module.
  - EDRMS live integration — Stage 3 uses a simulator registration only; a real EDRMS contract is deferred to Phase 9/10.
  - Early-warning alert event contracts from Attendance Monitoring and BI — no event subjects exist in the Phase 7 registry for these; Stage 6 must use a REST-pull pattern or an explicit placeholder strategy until Phase 9 defines the contract.
- Decide the `srs.adjustment.distributed` consumer gap: the Phase 7 event registry lists only `assessment-venue-adapter` as a consumer of this event, but the Wellbeing module needs it to track distribution feedback. Add `wellbeing-module` to the registry consumers list before Stage 2 begins and regenerate the schema index.

### Deliverables

- `docs/phase-8-stage-0-boundary-and-contract-baseline.md`
- Keycloak role matrix for all Wellbeing actor types.
- Package and deployment structure decision (ADR or decision note).
- Updated `schemas/events/registry.json` with `wellbeing-module` added to `srs.adjustment.distributed` consumers.
- Updated first-party module section in `docs/integrations/developer-guide.md` if needed.
- Gap register for missing contracts, value sets, permissions, and events.

### Exit Criteria

- Every Phase 8 data owner and integration path is classified.
- No Phase 8 implementation requires writing directly to SRS-owned tables outside approved SRS APIs.
- All missing contract gaps are either resolved or explicitly assigned to Phase 9/10.
- Package structure and Keycloak role matrix are agreed before Stage 1 begins.

---

## Stage 1 - Module Scaffold and Database Schema

**Status**: Complete — 28/28 integration tests passing

**Goal**: create the deployable Wellbeing module foundation and persistent domain model.

### Scope

- Add `modules/wellbeing` package with TypeScript, Fastify, health/readiness routes, lint, typecheck, and tests.
- Add a Wellbeing database schema for:
  - wellbeing case;
  - disability support case;
  - DSA entitlement;
  - evidence reference;
  - reasonable adjustment case;
  - adjustment assessment;
  - adjustment panel decision;
  - exceptional circumstances claim;
  - EC evidence review;
  - EC determination;
  - mental health case;
  - intervention plan;
  - early warning alert;
  - local context projection from SRS events.
- Add tenant isolation and RLS policies matching the core pattern.
- Add bitemporal fields where decisions, support plans, outcomes, and evidence statuses need historical reconstruction.
- Add seed value sets for case status, evidence status, adjustment case type, EC circumstance type, severity, support plan status, and alert type.
- Add local audit appenders for Wellbeing writes and sensitive reads.

### Deliverables

- `modules/wellbeing/package.json`
- Wellbeing service entrypoint and app builder.
- Wellbeing schema and migrations.
- Unit and migration tests.
- Compose/service documentation for local development.

### Exit Criteria

- The module builds, typechecks, and starts locally.
- Migrations apply cleanly against a fresh database.
- Tenant isolation tests prove cross-tenant records are inaccessible.

---

## Stage 2 - SRS Context Ingestion

**Status**: Complete — 19/19 integration tests passing (47 total across Stages 1–2)

**Goal**: maintain a local Wellbeing projection of SRS context required for casework.

### Scope

- Subscribe to context events:
  - `srs.student.enrolled`;
  - `srs.student.status-changed`;
  - `srs.student.disability-declaration-updated`;
  - `srs.enrolment.module-registered`;
  - `srs.enrolment.module-registration-withdrawn`;
  - `srs.assessment.mark-received`;
  - `srs.assessment.module-result-ratified`;
  - `srs.adjustment.approved`;
  - `srs.adjustment.distributed` — **prerequisite**: `wellbeing-module` must be added to this event's consumer list in `schemas/events/registry.json` at Stage 0 before this subscription is implemented; it is currently only listed for `assessment-venue-adapter`;
  - `srs.adjustment.expired`;
  - `srs.circumstances.exceptional-circumstances-flagged`;
  - `srs.circumstances.exceptional-circumstances-updated`;
  - `srs.regulatory.ukvi-visa-status-updated`;
  - `srs.regulatory.ukvi-compliance-alert-raised`.
- Store idempotent event offsets and event hashes for replay safety.
- Build projection tables for student identity summary, active enrolments, active module registrations, active flags, and academic performance indicators.
- Add reconciliation jobs that compare projections with SRS REST reads.
- Add dead-letter and retry handling consistent with Phase 7 event guidance.

### Deliverables

- Event consumer service.
- Projection repositories and tests.
- Replay/reconciliation command.
- Consumer documentation.

### Exit Criteria

- Replaying the same event set produces the same projection state.
- Missing or out-of-order events are detected and recoverable.
- Wellbeing casework can resolve the SRS context it needs without unrestricted reads.

---

## Stage 3 - Disability and Evidence Management

**Status**: Complete — 25/25 integration tests passing

**Goal**: support disability declarations, DSA entitlement records, evidence references, and document handoff.

### Scope

- Implement disability support case creation and lifecycle.
- Record DSA entitlement details and support plan status.
- Store evidence metadata and EDRMS references without storing document binaries in the module database.
- Integrate with the EDRMS contract where available; otherwise provide a simulator registration for local development.
- Add staff APIs for case search, case detail, evidence status updates, and support plan decisions.
- Add read-audit coverage for special-category data.
- Align disability declaration updates from SRS with Wellbeing-owned support cases.

### Deliverables

- Disability case service and routes.
- Evidence reference service.
- EDRMS simulator/contract adapter where needed.
- Tests for evidence status lifecycle, DSA records, tenant isolation, and read audit.

### Exit Criteria

- A disability support case can be created, reviewed, and closed.
- Evidence metadata is traceable to an external document reference.
- Special-category read and write operations are audited.

---

## Stage 4 - Reasonable Adjustment Workflow

**Status**: Complete — 31/31 integration tests passing

**Goal**: implement end-to-end reasonable adjustment casework and SRS outcome handoff.

### Scope

- Implement Temporal workflow for adjustment case creation, assessment, panel review, approval, rejection, expiry, and reassessment.
- Support multi-actor tasks for disability advisor, academic reviewer, registry reviewer, and panel chair.
- Validate adjustment scope against active module registrations from the local SRS projection.
- Transmit approved outcomes to SRS using the Phase 7 Wellbeing integration endpoint.
- Ensure SRS remains the system that records academic operational effect and distributes downstream adjustment events.
- Track `srs.adjustment.approved`, `srs.adjustment.distributed`, and `srs.adjustment.expired` feedback events.
- Add workflow deadlines, escalation paths, idempotency keys, and compensation for failed SRS handoff.

### Deliverables

- Adjustment case workflow and activities.
- Staff command APIs for workflow actions.
- SRS handoff client.
- Distribution feedback projection.
- End-to-end tests from Wellbeing approval to SRS distribution rows/events.

### Exit Criteria

- An approved adjustment reaches SRS exactly once under retry.
- Downstream distribution is initiated by SRS, not Wellbeing.
- Every workflow state and transition is covered by tests.

---

## Stage 5 - Exceptional Circumstances Workflow

**Status**: Complete — `modules/wellbeing/test/stage5-ec-workflow.int.test.ts`

**Goal**: implement student EC submission, evidence review, determination, and SRS board visibility.

### Scope

- Implement EC claim creation, triage, evidence request, review, determination, appeal/reconsideration, and closure.
- Support affected periods, affected modules, severity, evidence status, and determination outcome.
- Transmit upheld or board-visible outcomes to SRS using the Phase 7 EC integration endpoint.
- Track `srs.circumstances.exceptional-circumstances-flagged` and `srs.circumstances.exceptional-circumstances-updated` feedback events.
- Ensure rejected or withdrawn claims remain local to Wellbeing unless the roadmap requires SRS visibility.
- Add deadlines and escalation for evidence review and determination.

### Deliverables

- EC workflow and activities.
- EC routes and service layer.
- SRS handoff client support.
- Tests for EC lifecycle, SRS flagging, update propagation, and board visibility.

### Exit Criteria

- An upheld EC claim is visible to SRS exam board preparation.
- Withdrawn/rejected claims do not leak into SRS board data unless explicitly configured.
- All EC workflow states and transitions are covered by tests.

---

## Stage 6 - Mental Health and Early Intervention

**Status**: Complete — `modules/wellbeing/test/stage6-mental-health-intervention.int.test.ts`

**Goal**: implement wellbeing case management and alert-driven intervention workflows.

### Scope

- Add mental health case and intervention plan records.
- Consume UKVI compliance alert context via `srs.regulatory.ukvi-compliance-alert-raised` where intervention is appropriate.
- Consume early warning alerts from Attendance Monitoring and BI. **Note**: no event subjects for these exist in the Phase 7 registry. Stage 0 must decide the access pattern for Phase 8:
  - option A — REST-pull: poll `GET /api/v1/students/{personId}` and attendance endpoints on a schedule;
  - option B — placeholder consumer: define an internal event subject (e.g. `srs.attendance.early-warning-raised`) and mark it as `internal` status in the registry until Phase 9 formalises the contract;
  - option C — defer Stage 6 attendance alerts entirely to Phase 9 and scope Stage 6 to UKVI signals only.
  The chosen option must be recorded in `docs/phase-8-stage-0-boundary-and-contract-baseline.md` before Stage 6 begins.
- Support risk triage, assignment, intervention action, review date, closure, and referral outcome.
- Keep clinical/support notes local to Wellbeing and prevent them from being published to SRS events.
- Add aggregate reporting that avoids exposing case notes or special-category details.

### Deliverables

- Mental health case service and workflow.
- Early warning alert consumer/projection.
- Intervention APIs.
- Tests for alert idempotency, case assignment, closure, and privacy boundaries.

### Exit Criteria

- An inbound alert can create or update an intervention workflow.
- Case notes remain Wellbeing-local.
- Reporting outputs cannot expose special-category detail.

---

## Stage 7 - Security, Privacy, Audit, and Retention Hardening

**Status**: Complete — `modules/wellbeing/test/stage7-security-privacy-audit.int.test.ts`

**Goal**: harden the module for special-category data and operational governance.

### Scope

- Add Wellbeing-specific permissions and service-account roles.
- Enforce staff role separation across disability advisors, mental health advisors, academic reviewers, panel chairs, registry staff, auditors, and tenant administrators.
- Add read-access audit for all special-category records and projections.
- Add lawful-basis, consent, and data classification metadata where required.
- Add retention and closure policies for case records, evidence references, and intervention records.
- Add SAR/export support for Wellbeing-owned data.
- Add observability dashboards and structured logs without sensitive payload leakage.
- Add threat model and privacy review notes.

### Deliverables

- Permission matrix updates.
- Audit and retention tests.
- Privacy/threat-model note.
- Observability configuration.

### Exit Criteria

- Unauthorized users cannot read or mutate Wellbeing records.
- Sensitive reads are audited.
- Logs, metrics, and events do not include special-category payloads beyond approved contracts.

---

## Stage 8 - End-to-End Acceptance Review

**Status**: Complete — `docs/phase-8-acceptance-review.md`, `modules/wellbeing/test/stage8-acceptance.int.test.ts`

**Goal**: confirm Phase 8 exit criteria and readiness for Phase 9 VLE adjustment distribution validation.

### Scope

- Run golden-path scenarios:
  - disability support case with evidence reference;
  - reasonable adjustment approval to SRS distribution;
  - exceptional circumstances claim to board visibility;
  - early warning alert to intervention;
  - projection replay and reconciliation.
- Run negative scenarios:
  - duplicate SRS handoff;
  - failed SRS handoff with retry/compensation;
  - direct downstream adjustment distribution attempt blocked;
  - cross-tenant access denied;
  - unauthorized sensitive read denied and audited.
- Review first-party module pattern documentation.
- Update roadmap status and any Phase 9 prerequisites.

### Deliverables

- `docs/phase-8-acceptance-review.md`
- Updated first-party module implementation guide.
- Residual gap register for Phase 9 and Phase 10.

### Exit Criteria

- Student Wellbeing & Disability module is operational.
- Adjustment outcome flows are verified from Wellbeing approval through SRS distribution.
- Exceptional circumstances outcomes are visible to SRS exam board preparation.
- All workflow states and transitions are covered by tests.
- First-party module boundary is documented and enforced.

---

## Testing Strategy

Required coverage:

- Module build, typecheck, lint, and unit tests.
- Database migration and tenant isolation tests.
- RLS tests for Wellbeing-owned tables and SRS context reads.
- Event consumer idempotency, replay, and dead-letter tests.
- Workflow transition tests for adjustment, EC, and intervention workflows.
- SRS handoff contract tests using Phase 7 OpenAPI and event schemas.
- End-to-end tests for adjustment approval through SRS distribution.
- End-to-end tests for EC claim through board visibility.
- Read-audit tests for disability, adjustment, EC, and mental health records.
- Permission tests for all Wellbeing roles.
- Log/metric redaction tests for special-category payloads.

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Wellbeing bypasses SRS-owned domain logic | Stage 0 classifies ownership; Stage 4/5 use SRS handoff APIs only |
| Adjustment data is distributed directly by Wellbeing | Tests assert downstream distribution originates from SRS only |
| Special-category data leaks into logs, events, or reports | Stage 7 adds redaction checks, data classification, and read audit |
| Event projections drift from SRS | Stage 2 adds replay, event offsets, and reconciliation jobs |
| Workflow state becomes hard to recover after retries | Temporal workflows use idempotency keys and compensation activities |
| First-party module becomes too coupled to SRS internals | Shared contracts and service clients are used instead of direct imports from SRS internals |
| Mental health notes become visible to exam board or core SRS | Stage 6 keeps notes local and tests reporting/privacy boundaries |

---

## Exit Summary

Phase 8 is complete only when the Wellbeing module proves the first-party module pattern under sensitive, workflow-heavy conditions:

- Wellbeing-owned data is isolated, audited, and tenant-scoped.
- SRS context is consumed through events and controlled reads.
- Adjustment and EC outcomes are handed back to SRS through approved contracts.
- SRS remains the sole distribution point for adjustment effects.
- All Phase 8 workflows are covered by state-transition and end-to-end tests.
