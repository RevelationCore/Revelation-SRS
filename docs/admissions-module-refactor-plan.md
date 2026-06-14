# Admissions Module Refactor Plan

> Date: 2026-06-13
> Status: Proposed
> Purpose: Refactor the current UCAS-first admissions exchange into a first-party Admissions module with stable integration hooks for a future CRM.

---

## Summary

The current implementation has useful UCAS functionality, but it is shaped as a regulatory exchange inside Phase 6. It can ingest UCAS applications, stage clearing applications, auto-create enrolments for confirmed applications, link applications to enrolments, and generate outbound UCAS confirmations.

That is not a CRM. It is also not quite the right long-term ownership model for pre-enrolment activity. Admissions should become a first-party SRS module that owns applicant/application state before enrolment. UCAS should become one adapter into that module. A future CRM should integrate with Admissions through the same stable interface rather than writing directly into core SRS enrolment records.

Target shape:

```text
CRM / UCAS / Direct Application / Agent Portal
              |
              v
        Admissions Module
              |
              v
     Core SRS Person + Enrolment
```

The Admissions module becomes the anti-corruption layer between messy pre-student workflows and the authoritative SRS student/enrolment domain.

This plan depends on the platform alignment work in `docs/platform-workflow-feature-flag-alignment-plan.md`. Admissions should be the first full consumer of the lightweight workflow, decision-gateway audit, feature flag, trigger-rule, and environment-promotion foundations rather than implementing those concerns privately inside Admissions services.

The platform alignment Stage 7 seed establishes the first Admissions workflow-control baseline:

- Workflow definitions: `admissions-ucas-domestic`, `admissions-direct-domestic`, `admissions-international-direct`, `admissions-international-agent`, and `admissions-clearing`.
- Shared handoff step: `handoff-to-srs-enrolment`; confirmed UCAS applications now enter this workflow handoff instead of directly creating enrolments in the UCAS adapter.
- Decision evidence: use generic `workflow_decision_audit` with Admissions workflow instance, gateway, subject application, and policy metadata rather than a separate Admissions-only decision table unless later reporting proves that a specialised projection is required.
- Feature flags: `admissions.enabled`, route-specific source flags, `admissions.cas-precheck.required`, and the retired legacy UCAS auto-enrolment flag retained for migration audit.

---

## Current State

Implemented today:

- `ucas_application` bitemporal table stores inbound UCAS application state.
- `UcasService.ingestApplication(...)` validates UCAS payloads and records inbound exchange rows.
- Confirmed UCAS applications can create `person` and `enrolment` records.
- Clearing applications are staged and can be manually linked.
- `UcasService.generateOutboundConfirmations(...)` drains `ucas-confirmation` downstream triggers.
- UCAS regulatory events are published:
  - `srs.regulatory.ucas-application-received`
  - `srs.regulatory.ucas-confirmation-sent`
- Routes live under `/api/v1/regulatory/ucas/...`.
- UCAS is tested through integration, event, trigger, contract, and OpenAPI coverage.

Missing for a first-party Admissions capability:

- Source-neutral application model.
- Offers, decisions, conditions, acceptance/decline state.
- International compliance, deposit, visa, and CAS-readiness state.
- Applicant matching and duplicate resolution.
- Admissions workflow state and decision-gateway audit distinct from regulatory exchange state.
- Feature flags for route enablement and migration behaviour.
- Stable CRM integration API.
- Admissions domain events such as `srs.admissions.application-received`.
- Explicit handoff command from Admissions to SRS enrolment.

---

## Design Principles

1. **Admissions owns pre-enrolment state.**
   Prospect/applicant/application/offer state belongs in Admissions until the institution decides to create or link an SRS enrolment.

2. **Core SRS owns enrolled student records.**
   `person`, `enrolment`, fee liability, registration, assessment, progression, and statutory student record data remain in core SRS.

3. **UCAS is an adapter, not the Admissions domain.**
   UCAS payloads should map into source-neutral Admissions records, while UCAS-specific exchange evidence remains available for audit and regulatory processing.

4. **CRM integrates through Admissions, not directly with Enrolment.**
   A future CRM should submit applications, updates, notes/engagement summaries, and conversion requests through explicit Admissions interfaces.

5. **No loss of Phase 6 behavior.**
   Existing UCAS ingress, clearing staging, enrolment creation, outbound confirmation generation, exchange ledger records, and tests must continue to pass throughout the refactor.

6. **Workflow and flags own process variation.**
   Domestic UCAS, direct, agent, international, clearing, CAS, and legacy migration paths should be represented through workflow definitions, decision-gateway audit, feature flags, trigger rules, and assignment rules. Admissions services own data invariants and commands; they should not hard-code institution-specific route ordering or role responsibilities.

---

## Target Bounded Contexts

### Admissions Module

Owns:

- Source-neutral applicant/application records.
- Application lifecycle status.
- Offer/decision records.
- Applicant-to-person matching decisions.
- Application-to-enrolment handoff.
- Admissions events.
- Integration API consumed by UCAS, direct applications, agent portals, and future CRM.

Does not own:

- Marketing campaigns.
- Event/open-day attendance.
- Prospect communications.
- CRM tasks, notes, and funnel analytics.
- Enrolled student lifecycle after handoff.

### UCAS Adapter

Owns:

- UCAS payload validation and mapping.
- UCAS-specific identifiers, cycle, status mapping, and raw payload evidence.
- Inbound/outbound `integration_exchange` records for UCAS.
- Outbound UCAS confirmation generation from SRS downstream triggers.
- UCAS contract fixture conformance.

### CRM Integration Boundary

Future CRM should use Admissions commands/events:

- Submit or update an application.
- Submit prospect/application source references.
- Receive application lifecycle events.
- Receive enrolment conversion outcome.
- Query application handoff status.

CRM should not write directly to:

- `person`
- `enrolment`
- `enrolment_downstream_trigger`
- regulatory exchange tables

---

## Proposed Data Model

### `admissions_application`

Bitemporal source-neutral application record.

Suggested columns:

- `id`
- `tenant_id`
- `applicant_person_id` nullable FK to `person.id`
- `source_system_code` (`ucas`, `direct`, `crm`, `agent-portal`, `manual`)
- `source_application_reference`
- `application_cycle`
- `application_status_code`
- `entry_academic_year`
- `programme_id` nullable
- `mode_of_study_code` nullable
- `attendance_type_code` nullable
- `start_date` nullable
- `expected_end_date` nullable
- `fee_band_code` nullable
- `funding_source_code` nullable
- `raw_payload` JSONB
- `linked_enrolment_id` nullable
- bitemporal columns

Notes:

- `ucas_application` can either become a compatibility view over this table or be retained as a UCAS-specific exchange table that references `admissions_application.id`.
- Prefer retaining UCAS-specific exchange evidence separately if the raw UCAS payload and regulatory audit needs diverge from source-neutral admissions state.

### `admissions_offer`

Bitemporal offer/decision record.

Suggested columns:

- `id`
- `tenant_id`
- `application_id`
- `offer_type_code`
- `offer_status_code`
- `conditions_payload` JSONB
- `decision_date`
- `response_deadline`
- `accepted_at`
- `declined_at`
- bitemporal columns

### `admissions_handoff`

Append-only or bitemporal handoff record from Admissions to SRS.

Suggested columns:

- `id`
- `tenant_id`
- `application_id`
- `handoff_status_code` (`requested`, `completed`, `failed`, `cancelled`)
- `person_id` nullable
- `enrolment_id` nullable
- `requested_by`
- `requested_at`
- `completed_at`
- `failure_reason`

### `ucas_application`

Refactor options:

Option A: keep as UCAS exchange table and add `admissions_application_id`.

Option B: migrate into `admissions_application` and replace with compatibility view.

Recommended: **Option A** for lower risk. Regulatory evidence remains explicit while Admissions becomes the source-neutral lifecycle owner.

---

## Domain Events

Add Admissions events:

- `srs.admissions.application-received`
  - `applicationId`
  - `sourceSystemCode`
  - `sourceApplicationReference`
  - `entryAcademicYear`
  - `programmeId`

- `srs.admissions.application-status-changed`
  - `applicationId`
  - `previousStatusCode`
  - `newStatusCode`
  - `changedAt`

- `srs.admissions.offer-made`
  - `applicationId`
  - `offerId`
  - `offerTypeCode`
  - `responseDeadline`

- `srs.admissions.offer-accepted`
  - `applicationId`
  - `offerId`
  - `acceptedAt`

- `srs.admissions.enrolment-requested`
  - `applicationId`
  - `handoffId`
  - `requestedAt`

- `srs.admissions.enrolment-created`
  - `applicationId`
  - `handoffId`
  - `personId`
  - `enrolmentId`
  - `createdAt`

Keep UCAS regulatory events:

- `srs.regulatory.ucas-application-received`
- `srs.regulatory.ucas-confirmation-sent`

Rationale: Admissions events are source-neutral workflow events. UCAS regulatory events are adapter/exchange events.

---

## Service Boundary

### `AdmissionsService`

Create under:

`apps/api/src/platform/admissions/service.ts`

Suggested methods:

- `ingestApplication(tenantId, input, actorId)`
- `updateApplicationStatus(applicationId, tenantId, statusCode, actorId)`
- `recordOffer(applicationId, tenantId, input, actorId)`
- `acceptOffer(offerId, tenantId, actorId)`
- `requestEnrolment(applicationId, tenantId, actorId)`
- `linkApplicationToEnrolment(applicationId, enrolmentId, tenantId, actorId)`
- `listApplications(tenantId, filters)`
- `getApplication(applicationId, tenantId)`

### `UcasService`

Refactor to become an adapter:

- `ingestUcasApplication(tenantId, payload, actorId)`
  - validates UCAS payload
  - records UCAS exchange
  - maps to `AdmissionsService.ingestApplication`
  - stores/updates `ucas_application` evidence row linked to admissions application
  - publishes UCAS regulatory event

- `generateOutboundConfirmations(...)`
  - remains UCAS-specific
  - drains `enrolment_downstream_trigger`
  - records exchange
  - publishes UCAS confirmation event

### `EnrolmentService`

Add or formalise a stable handoff method:

- `createEnrolmentFromAdmissionsApplication(tenantId, command, actorId)`

This method should:

- create or link a `person`
- create `enrolment`
- generate fee liability
- create downstream triggers as today
- return `{ personId, enrolmentId }`

Admissions should not manually orchestrate low-level student/enrolment creation details once this interface exists.

---

## API Design

### First-party Admissions API

Add routes under:

- `POST /api/v1/admissions/applications`
- `GET /api/v1/admissions/applications`
- `GET /api/v1/admissions/applications/:applicationId`
- `PATCH /api/v1/admissions/applications/:applicationId/status`
- `POST /api/v1/admissions/applications/:applicationId/offers`
- `POST /api/v1/admissions/offers/:offerId/acceptance`
- `POST /api/v1/admissions/applications/:applicationId/enrolment-request`
- `POST /api/v1/admissions/applications/:applicationId/link-enrolment`

Permissions:

- `admissions:read`
- `admissions:write`
- `admissions:convert`

Initial roles:

- `registry-administrator`
- future `admissions-officer`
- optionally `regulatory-officer` read-only for UCAS-linked records

### UCAS Adapter API

Keep existing Phase 6 routes for backward compatibility:

- `POST /api/v1/regulatory/ucas/applications`
- `GET /api/v1/regulatory/ucas/applications`
- `POST /api/v1/regulatory/ucas/applications/:applicationId/link`
- `POST /api/v1/regulatory/ucas/confirmations/generate`

Internally, inbound UCAS application routes should call the Admissions module.

Optional future alias:

- `POST /api/v1/admissions/sources/ucas/applications`

### CRM Integration API

Do not implement full CRM now. Define stable hooks:

- `POST /api/v1/admissions/integrations/applications`
- `PATCH /api/v1/admissions/integrations/applications/:sourceSystemCode/:sourceApplicationReference`
- `GET /api/v1/admissions/integrations/applications/:applicationId/handoff-status`

Permissions:

- `integration:manage` for system-to-system calls

The CRM payload should be source-neutral, not CRM-vendor-specific.

---

## Refactor Stages

### Stage A — Architecture and Compatibility Baseline

Goal: document and lock current behavior before moving code.

Tasks:

- Add this plan to the roadmap references.
- Add ADR: "Admissions as first-party bounded context".
- Snapshot existing UCAS behavior with tests if any gaps exist.
- Confirm current Phase 6 tests still pass.

Exit criteria:

- Current UCAS routes and tests remain unchanged.
- Admissions target boundaries are documented.

### Stage B — Foundation Schema and Events

Goal: introduce Admissions substrate without changing UCAS behavior.

Tasks:

- Add `admissions_application`.
- Add `admissions_offer`.
- Add `admissions_handoff`.
- Add value sets:
  - `admissions-application-status-code`
  - `admissions-offer-status-code`
  - `admissions-offer-type-code`
  - `admissions-handoff-status-code`
  - `admissions-source-system-code`
- Add domain event payload files for `srs.admissions.*`.
- Add permissions and role mappings.
- Add migration tests.

Exit criteria:

- Schema, RLS, value sets, and event contracts compile and pass tests.
- No UCAS behavior changed yet.

### Stage C — Admissions Service and Routes

Goal: implement source-neutral Admissions workflows.

Tasks:

- Add `AdmissionsService`.
- Add admissions routes.
- Implement application ingest/list/get/status update.
- Implement offer create/accept.
- Implement handoff request/link operations.
- Add audit records for all writes.
- Add integration tests for direct/manual applications.

Exit criteria:

- Direct application can be created and converted into an enrolment through Admissions.
- Core SRS enrolment creation remains bitemporal and trigger-generating.

### Stage D — UCAS Adapter Refactor

Goal: move UCAS inbound application lifecycle onto Admissions.

Tasks:

- Refactor `UcasService.ingestApplication`:
  - map UCAS payload to source-neutral admissions application input
  - call `AdmissionsService.ingestApplication`
  - link `ucas_application` to admissions application
  - keep regulatory exchange and UCAS event behavior
- Preserve existing `/regulatory/ucas` API response shape.
- Keep clearing behavior: staged, no auto-enrolment unless manually linked or explicitly converted.
- Update tests to assert both UCAS evidence and Admissions records exist.

Exit criteria:

- Existing Phase 6 UCAS tests pass unchanged or with only additive assertions.
- Admissions tests confirm UCAS applications appear in the source-neutral application list.

### Stage E — Enrolment Handoff Hardening

Goal: make Admissions-to-SRS conversion a stable interface.

Tasks:

- Add `createEnrolmentFromAdmissionsApplication` or equivalent command method.
- Move applicant-to-person matching decisions out of UCAS adapter.
- Record handoff status transitions.
- Ensure duplicate conversion is idempotent.
- Ensure downstream triggers still created for UCAS/SLC/UKVI.

Exit criteria:

- Confirmed UCAS application conversion and direct application conversion use the same handoff path.
- Duplicate handoff requests do not create duplicate enrolments.

### Stage F — CRM Integration Hook

Goal: define the interface a future CRM can use without implementing CRM.

Tasks:

- Add integration-facing source-neutral application upsert endpoint.
- Add idempotency key support by source system/reference.
- Add integration contract seed:
  - `crm-admissions-exchange.v1`
- Add events for CRM consumers:
  - application received
  - status changed
  - offer accepted
  - enrolment created
- Add contract fixture for a CRM application payload.

Exit criteria:

- A simulated CRM can submit/update an application and observe handoff status.
- No CRM-specific campaign/communication/task functionality exists in SRS.

### Stage G — Deprecation and Documentation

Goal: make module ownership obvious.

Tasks:

- Update roadmap Phase 6 wording from "UCAS admissions exchange" to "Admissions module with UCAS adapter" or add a dedicated Admissions phase/stage.
- Update architecture docs:
  - domain events
  - data subject matrix
  - event coverage matrix
  - API standards/OpenAPI tags
- Document that CRM is external/future and integrates through Admissions.
- Mark direct UCAS-to-enrolment orchestration as deprecated internally.

Exit criteria:

- Developers can identify clear ownership:
  - Admissions owns application state.
  - UCAS adapter owns UCAS exchange.
  - Enrolment owns enrolment records.
  - CRM remains external/future.

---

## Migration Strategy

Recommended low-risk migration:

1. Add Admissions tables and services alongside current UCAS implementation.
2. Backfill `admissions_application` from current `ucas_application` rows.
3. Add `admissions_application_id` to `ucas_application`.
4. Refactor UCAS ingest to dual-write through Admissions.
5. Shift reads/listing gradually to Admissions-backed data.
6. Keep `/regulatory/ucas` routes stable for regulatory operations.
7. Once stable, treat `ucas_application` as UCAS exchange evidence rather than primary application lifecycle state.

Avoid:

- Renaming `ucas_application` directly in the first migration.
- Removing existing UCAS routes during the refactor.
- Letting CRM write directly to `person` or `enrolment`.

---

## Testing Plan

Add or update tests for:

- Admissions direct/manual application ingest.
- UCAS ingest creates both UCAS evidence and Admissions application.
- Clearing UCAS application is staged but not auto-converted.
- Confirmed UCAS application conversion creates person/enrolment through Admissions handoff.
- Duplicate source application upsert is idempotent.
- Offer accepted event is published.
- Enrolment requested/created events are published.
- CRM integration fixture submits a source-neutral application.
- Existing Phase 6 UCAS, trigger, event, contract, and OpenAPI tests remain passing.

Regression suites to run:

- `pnpm typecheck`
- API admissions/UCAS integration tests
- Phase 6 regulatory tests
- DB migration tests
- OpenAPI tests

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Duplicate applicant/person records | Centralise matching and handoff in Admissions, not in UCAS/CRM adapters |
| Breaking existing UCAS Phase 6 behavior | Preserve routes and add Admissions as an internal dependency first |
| CRM scope creep | Define CRM integration hooks only; do not implement campaigns, communications, or tasks |
| Confused ownership between Admissions and Enrolment | Enrolment owns enrolled student lifecycle; Admissions owns pre-enrolment application lifecycle |
| Regulatory audit loss | Keep UCAS exchange evidence and `integration_exchange` records intact |
| Overly generic source model | Use source-neutral core fields plus raw payload JSONB for source-specific details |

---

## Recommended Roadmap Placement

Best placement:

- Add as a **Phase 6.5 Admissions Refactor** before Phase 7 integration layer.

Rationale:

- Phase 6 has just introduced UCAS regulatory exchange.
- Phase 7 is the integration layer, where CRM and external adapters become more important.
- Refactoring Admissions before Phase 7 gives the CRM integration a stable domain boundary.

Alternative:

- Add as the first stage of Phase 7.

This is viable if the team wants to treat CRM integration hooks as part of the integration layer rather than core SRS domain work.

Recommended: **Phase 6.5** because Admissions is a first-party SRS module, not merely an integration adapter.
