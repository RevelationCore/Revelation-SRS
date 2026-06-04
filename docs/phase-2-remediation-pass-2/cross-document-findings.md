# Cross-Document Findings — Pass 2

> Status: Draft for review
> Reviewed documents include:
> - `docs/project-roadmap.md`
> - `docs/requirements/functional-requirements.md`
> - `docs/requirements/workflow-catalogue.md`
> - `docs/architecture/data-model.md`
> - `docs/architecture/domain-events.md`
> - `docs/architecture/integration-layer.md`
> - `docs/architecture/integration-contract-catalogue.md`

## Findings

### CD2-001 — High — Roadmap overstates remediation completeness

The roadmap now marks Phase 2 as "complete — remediation applied" and says the plugin registry is extended and out-of-scope flows are explicitly marked. Some remediation is indeed applied, but pass-2 data-model findings show unresolved structural design issues: stale ERD, old plugin registry schema in `data-model.md`, unresolved bitemporal key semantics, and incomplete carry-over from the first remediation.

Source: `project-roadmap.md` Phase 2 status and deliverable text around the Phase 2 section.

Impact: Phase 3 could start with unresolved physical schema decisions that will be expensive to retrofit.

Recommendation: Change Phase 2 status to "remediation applied — pass 2 review pending" or add this pass-2 folder as a required review input before Phase 3 DDL begins.

### CD2-002 — High — Plugin registry schema is split across documents

`integration-layer.md` says `integration_registration` is extended with fields required for the contract catalogue, while `data-model.md` keeps the old table and only references the extension later.

Impact: There is no single canonical schema for a Phase 3 migration.

Recommendation: Make `data-model.md` canonical and align `integration-layer.md` to it. Consider splitting contract definition from tenant registration:

- `integration_contract`
- `integration_registration`
- `integration_endpoint`
- `integration_health_check`
- `integration_exchange`

### CD2-003 — Medium — Integration contract catalogue still has uneven completeness

Some contract entries use detailed field/value blocks with failure handling and idempotency; later sections are compact tables with sparse notes. For example Attendance, VLE, IAM, Exam Scheduling, Academic Integrity, Wellbeing, and Statutory Bodies are less complete than Curriculum/CRM/Finance.

Impact: Contract implementation will vary by adapter, and testability may differ by integration.

Recommendation: Normalize every contract to the same fields: payload, trigger, failure handling, replay/backfill, idempotency key, security scope, data classification, and source-of-truth behavior.

### CD2-004 — Medium — Integration contract owners are sometimes mapped to broad or questionable modules

Examples:

- `curriculum-performance-metrics.v1` is owned by Regulatory Compliance, but it looks more like analytics/reporting or curriculum/enrolment.
- `library-obligations.v1` is owned by Student Identity, but obligations/holds may belong to Enrolment or a student standing module.
- `attendance-records-alerts.v1` is owned by Student Identity, but attendance is operational engagement/compliance.

Impact: Module boundaries may become muddy during implementation.

Recommendation: Add a domain ownership decision table and define whether "student standing/engagement" is a distinct internal module or owned by Enrolment & Registration.

### CD2-005 — Medium — Event taxonomy is broader, but not all data-model entities have events

Many new data-model entities have matching events, but not all. Missing or weak areas include:

- `student_address` changes are covered generically by `srs.student.identity-updated`, but no address/contact-specific contract is defined.
- `admissions_offer` has `offer-accepted` but not offer made/declined/conditions changed.
- `student_hold` has applied/released but no updated/expired.
- `exam_board_data_pack` has ready/superseded but no distributed/published state event.
- `student_document` has archived but no generated/reissued.
- `data_quality_issue` has received but no resolved/deferred.

Impact: Some state changes may not satisfy PLT-INT-001, which says every significant state change publishes a domain event.

Recommendation: Add an event coverage matrix keyed by data entity and status-changing operation.

### CD2-006 — Medium — Workflow catalogue names are mostly fixed, but status/event coverage is still incomplete

The previous explicit naming mismatches were mostly corrected. However, workflow terminal actions imply events or records that are under-specified:

- W001 creates fee liability, IAM provisioning, SLC confirmation, CAS request, and UCAS confirmation, but not every action has a workflow-to-exchange-state mapping.
- W007 updates fee liability, SLC, UKVI, IAM, and status; some are generic status events but not all have durable integration exchange rows.
- W008 HESA workflow maps to new HESA entities, but amendment/delta storage remains conceptual.

Impact: Workflows may orchestrate side effects without a complete persistence and retry model.

Recommendation: Add a workflow-to-entity/event/contract matrix for W001-W012.

### CD2-007 — Medium — Data subject register likely needs update after data-model expansion

The data model now includes many new personal-data and special-category/sensitive entities: disability declarations, identity verification fraud flags, attendance records, absence alerts, exam accommodations, EC outcomes, misconduct outcomes, visa status, UKVI compliance cases, risk flags, staff assignments, research milestones, and generated documents.

Impact: If `data-subject-register.md` was not updated to include these categories, GDPR lawful basis, retention, and sensitivity classification will lag the data model.

Recommendation: Reconcile the data subject register against every entity in the expanded data model before implementation.

### CD2-008 — Medium — API standards are still generic; resource surface has not caught up with the expanded model

The API standards document gives conventions and examples, but there is no resource catalogue or endpoint inventory for the expanded data model. With 60+ entities, implementation needs decisions about which are public API resources, internal service resources, workflow-only resources, or integration-only resources.

Impact: OpenAPI generation in Phase 3/4 may drift entity-by-entity without a coherent API surface.

Recommendation: Add an API resource catalogue mapping entity groups to endpoints, permissions, bitemporal query support, and integration contracts.

### CD2-009 — Low — Reference flow count wording remains risky in roadmap

The roadmap still says core requirements are derived from "the 70 reference model flows (F001-F070)." The reviewed reference JSON contains 69 interactions with F054 absent.

Impact: Minor traceability confusion remains.

Recommendation: Update wording to "the published reference model flows across the F001-F070 identifier range; version 2.1 contains 69 interactions and no F054."

## Recommended Pass-2 Exit Criteria

Before treating Phase 2 as fully closed:

1. Resolve all High findings in `data-model-review.md`.
2. Make `data-model.md` the single canonical schema source.
3. Add a data-entity-to-event/API/workflow/contract coverage matrix.
4. Reconcile data subject register and security architecture with new entities.
5. Normalize the integration contract catalogue.
6. Update roadmap language to reflect pass-2 status accurately.
