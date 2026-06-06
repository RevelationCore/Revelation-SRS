# Phase 6 Implementation Plan — Regulatory Compliance

> Date: 2026-06-05
> Status: Draft
> Prerequisite: Phase 5 complete (all exit criteria passing)

---

## Overview

Phase 6 delivers all statutory data exchange obligations as first-class system capabilities, plus the exam entry and scheduling integration deferred from Phase 5. It is the first phase to activate the file exchange framework scaffolded in Phase 3 — concrete inbound and outbound processors and exchange ledger entries are built here for each regulatory body.

The phase operates on data that already exists: student records, enrolments, module registrations, results, and awards are all authoritative from Phases 4 and 5. Phase 6 reads those records, assembles them into the formats each regulatory body requires, manages the exchange lifecycle, and processes inbound responses.

**File exchange approach**: Phase 6 generates regulatory files in-process (in memory). Submissions are recorded in `integration_exchange`. Download endpoints allow staff to retrieve generated files for manual submission. Automated SFTP/API transmission and webhook inbound from regulatory bodies are Phase 7 concerns. All inbound data from regulatory bodies is accepted via POST endpoints in Phase 6 (staff upload/paste responses); full automated ingest is Phase 7.

**Downstream trigger continuity**: Phase 4 created `enrolment_downstream_trigger` rows for `ucas-confirmation`, `slc-confirmation`, and `ukvi-cas` whenever enrolments were created or status-changed. Phase 6 services pick up those pending triggers and process them into actual exchange submissions. This is the direct execution path for work queued in Phase 4.

**Exit criteria (from roadmap)**:
- All regulatory exchange workflows operational and testable using representative test data
- HESA file generation validated against coding manual field structure
- Each statutory flow covered by a contract test against the relevant external system's published specification

---

## Stage dependency graph

```
Stage 0  (foundation: schema, events, value sets, permissions, contract seeds)
    │
Stage 1  (UCAS admissions exchange)
    │
Stage 2  (HESA student return)
    │
Stage 3  (Student Loans Company exchange)
    │
Stage 4  (UKVI compliance)
    │
Stage 5  (OfS reporting and FOI support)
    │
Stage 6  (exam entry and scheduling exchange — deferred from Phase 5)
    │
Stage 7  (event consumer tests and OpenAPI)
```

Stages 1–5 have no ordering dependencies on each other once Stage 0 is in place; the sequence above reflects severity/complexity ordering. Stage 6 depends on Stage 0 only (it uses the exam board and module registration data from Phase 5, not the regulatory infrastructure from Stages 1–5). Stage 7 depends on all preceding stages.

---

## Stage 0 — Foundation: Schema, Domain Events, Value Sets, Permissions

**Status**: Complete — implemented in migrations `0006_phase6_regulatory_schema.sql` and `0007_seed_phase6_field_mappings.sql`, Drizzle schema exports, Phase 6 event contracts, regulatory permissions, exchange ledger helper, and pinned contract fixtures.

**Scope**: All Phase 6 tables in one migration, RLS enabled, value sets seeded, domain event contracts defined, integration contracts seeded for each regulatory body, and new permissions added. No service or route code; only structural substrate.

### Database migration (`0006_phase6_regulatory_schema.sql`)

**UCAS:**
- `ucas_application` — bitemporal; inbound application staging area before linkage to a student/enrolment record. Columns: `ucas_personal_id` (UCAS applicant ID), `cycle` (UCAS cycle year, e.g. `2027`), `status_code` (per value set), `linked_enrolment_id` (nullable FK to `enrolment.id`, set when matched), `raw_payload` JSONB, `received_at`.

**HESA:**
- `hesa_student_return` — versioned (not fully bitemporal; uses self-FK amendment chain). Columns: `academic_year` (e.g. `2027-28`), `status_code`, `submitted_at` (nullable), `validated_at` (nullable), `submission_reference` (nullable; assigned by HESA on receipt), `amendment_of_id` (nullable self-FK to `hesa_student_return.id`), `generated_by`, `generated_at`.
- `hesa_student_return_record` — append-only; one row per student per return. Columns: `hesa_student_return_id` (FK), `enrolment_id` (FK), `hesa_id` (nullable; populated when HESA assigns), `record_payload` JSONB (full HESA field set for this student).
- `hesa_submission` — append-only; one row per generated/downloaded submission attempt. Columns: `hesa_student_return_id` (FK), `integration_exchange_id` (FK), `payload_hash`, `payload_summary` JSONB, `generated_at`, `generated_by`, `submitted_at` (nullable), `submission_reference` (nullable).
- `hesa_validation_report` — append-only; inbound report evidence from HESA. Columns: `hesa_student_return_id` (FK), `integration_exchange_id` (nullable FK), `received_at`, `received_by`, `raw_payload` JSONB, `blocking_error_count`, `warning_count`.
- `hesa_validation_issue` — append-only; one normalised issue per validation report message. Columns: `hesa_validation_report_id` (FK), `hesa_student_return_record_id` (nullable FK), `enrolment_id` (nullable FK), `field_code`, `severity_code`, `message`, `external_reference` (nullable).
- `hesa_identifier_assignment` — append-only; durable evidence of HESA ID propagation. Columns: `hesa_student_return_id` (FK), `hesa_student_return_record_id` (FK), `person_id` (FK), `enrolment_id` (FK), `hesa_id`, `assigned_at`, `assigned_by`.

**SLC:**
- `slc_notification` — append-only; inbound from SLC. Columns: `enrolment_id` (FK), `notification_type_code`, `effective_date` (date), `amount` (numeric, nullable), `raw_payload` JSONB, `received_at`.

**UKVI:**
- `ukvi_cas_request` — bitemporal; tracks CAS request lifecycle. Columns: `enrolment_id` (FK), `cas_reference` (nullable; returned by UKVI on assignment), `status_code`, `requested_at`.
- `ukvi_attendance_report` — append-only; compliance submission record. Columns: `academic_period_id` (FK), `submitted_at`, `report_payload` JSONB, `submitted_by`.
- `ukvi_visa_status` — bitemporal; records visa grants/refusals/curtailments per student. Columns: `enrolment_id` (FK), `cas_reference`, `status_code`, `effective_date`, `raw_payload` JSONB.
- `ukvi_compliance_alert` — append-only; attendance threshold breach alerts. Columns: `enrolment_id` (FK), `cas_reference` (nullable), `alert_type_code`, `triggered_at`, `resolved_at` (nullable), `resolved_by` (nullable).

**OfS:**
- `ofs_extract` — append-only; extract generation record. Columns: `extract_type_code`, `academic_year`, `generated_at`, `generated_by`, `record_count`, `status_code`.

**FOI:**
- `foi_request` — bitemporal; records FOI request receipt and status. Columns: `request_reference`, `received_date`, `statutory_deadline_date`, `description`, `status_code`, `legal_basis` (nullable; required before PII extraction), `closed_at` (nullable).
- `foi_extract` — append-only; structured data extract generated for a request. Columns: `foi_request_id` (FK), `generated_at`, `generated_by`, `query_summary` text, `record_count`.

**Regulatory profile:**
- `student_regulatory_profile` — bitemporal; stores regulatory-only flags and segmentation values not owned by core identity/enrolment. Columns: `person_id` (FK), `enrolment_id` (nullable FK), `ukvi_sponsorship_required` boolean, `polar4_quintile` (nullable integer), `imd_decile` (nullable integer), `care_experienced` boolean nullable, `source_system`, `actor_id`. Values are optional; extract services must emit `unknown`/mapping notes when absent rather than inventing values.

**Exam entry (GOV-008, GOV-009):**
- `exam_entry` — bitemporal; per-student exam entry for a module sitting. Columns: `module_registration_id` (FK), `exam_board_id` (FK), `candidate_number` (nullable; assigned by Exam Scheduling), `scheduled_date` (nullable), `room_reference` (nullable), `status_code`, `accommodations` JSONB (adjustment indicators forwarded to Exam Scheduling).
- `exam_timetable_receipt` — append-only; inbound timetable/seating data from Exam Scheduling. Columns: `exam_board_id` (FK), `received_at`, `received_by`, `payload` JSONB.

**RLS**: enable and force RLS with the standard `app.current_tenant_id` policy on all tables above that carry `tenant_id`. `hesa_student_return_record` is linked through `hesa_student_return.tenant_id`; use the same policy pattern.

### Drizzle schema files

New files under `packages/db/src/schema/`:
- `regulatory.ts` — `ucasApplications`, `hesaStudentReturns`, `hesaStudentReturnRecords`, `hesaSubmissions`, `hesaValidationReports`, `hesaValidationIssues`, `hesaIdentifierAssignments`, `slcNotifications`, `ukviCasRequests`, `ukviAttendanceReports`, `ukviVisaStatuses`, `ukviComplianceAlerts`, `ofsExtracts`, `foiRequests`, `foiExtracts`, `studentRegulatoryProfiles`
- `examEntry.ts` — `examEntries`, `examTimetableReceipts`

Export both from `packages/db/src/schema/index.ts`.

### Value set seeds (`0007_seed_phase6_field_mappings.sql`)

New value sets:
- `ucas-application-status-code` — `received`, `offer-made`, `offer-accepted`, `confirmed`, `deferred`, `withdrawn`, `not-registered`, `clearing`
- `hesa-return-status-code` — `draft`, `validated`, `submitted`, `validation-report-received`, `amendment-required`, `final`
- `hesa-validation-severity-code` — `error`, `warning`
- `slc-notification-type-code` — `entitlement-confirmed`, `payment-received`, `overpayment-notified`, `recovery-initiated`
- `cas-status-code` — `pending`, `assigned`, `used`, `withdrawn`, `expired`
- `ukvi-visa-status-code` — `granted`, `refused`, `curtailed`, `expired`, `lapse-of-leave`
- `ukvi-alert-type-code` — `attendance-threshold-breach`, `visa-curtailed`, `sponsor-compliance-breach`
- `ofs-extract-type-code` — `b3-student-outcomes`, `access-participation-progress`, `prevent-duty`
- `regulatory-report-status-code` — `draft`, `generated`, `submitted`, `accepted`, `rejected`
- `foi-request-status-code` — `received`, `in-progress`, `extended`, `responded`, `refused`
- `exam-entry-status-code` — `pending`, `submitted-to-scheduling`, `scheduled`, `cancelled`

New field_value_set mappings for all new entity `_code` columns.

### Integration contract seeds

Seed into `integration_contract` (platform-wide, no tenant scope):

```sql
INSERT INTO integration_contract (contract_id, display_name, owner_module_code, direction_code, pattern_type, current_contract_version, data_classification_code)
VALUES
  ('ucas-admissions-exchange.{cycle}', 'UCAS Admissions Exchange', 'regulatory', 'bidirectional', 'file-and-api', '1.0.0', 'personal'),
  ('hesa-student-return.{year}',       'HESA Student Return',      'regulatory', 'bidirectional', 'file',          '1.0.0', 'regulatory'),
  ('slc-enrolment-exchange.v1',        'SLC Enrolment Exchange',   'regulatory', 'bidirectional', 'file-and-api', '1.0.0', 'sensitive'),
  ('ukvi-sponsor-compliance.v1',       'UKVI Sponsor Compliance',  'regulatory', 'bidirectional', 'api-and-file', '1.0.0', 'sensitive');
```

### Exchange ledger helper

`integration_exchange` requires an `integration_registration_id`, not just a contract ID. Stage 0 must add a small helper service used by all Phase 6 services:

- `RegulatoryExchangeService.ensureRegistration(tenantId, contractId, actorId)` — resolves the `integration_contract`, creates a tenant-scoped system-managed `integration_registration` if one does not already exist, and returns the registration id.
- `RegulatoryExchangeService.recordExchange(tenantId, contractId, input)` — calls `ensureRegistration`, then inserts `integration_exchange` using the returned `integration_registration_id`, the resolved contract id, direction, exchange type, idempotency key, payload hash/summary, and status.

The system-managed registration should use `integration_code = contractId`, `display_name = contract.display_name`, `transport_code = 'manual-file'` for Phase 6 file/download flows or `manual-api` for staff-entered inbound responses, `enabled = true`, and a contract version matching `integration_contract.current_contract_version`. This keeps Phase 6 aligned with the existing exchange ledger without requiring every tenant to preconfigure regulatory integrations manually.

### Contract fixture seeds

Create pinned contract fixture files under `packages/testing/regulatory-contracts/`:

- `ucas/2027/application.sample.json`
- `ucas/2027/confirmation.sample.json`
- `hesa/2027-28/student-return.minimal.xml`
- `hesa/2027-28/validation-report.sample.json`
- `slc/v1/confirmation.sample.json`
- `slc/v1/notification.sample.json`
- `ukvi/v1/cas-request.sample.json`
- `ukvi/v1/visa-status.sample.json`
- `exam-scheduling/v1/timetable.sample.json`

Contract tests compare generated payload shape, required fields, coding value domains, and stable ordering against these pinned fixtures. Annual regulatory spec updates are handled by adding a new fixture version and selecting it by cycle/academic year; Phase 6 does not fetch live external schemas at runtime.

### Domain event contracts (`packages/domain/src/events/`)

New payload files under `packages/domain/src/events/regulatory/`:
- `ucas-application-received.v1.ts` — `applicationId`, `ucasPersonalId`, `cycle`, `statusCode`, `tenantId`
- `ucas-confirmation-sent.v1.ts` — `enrolmentId`, `ucasPersonalId`, `cycle`, `confirmationType` (`enrolled` | `withdrawn` | `deferred`), `exchangeId`
- `hesa-return-generated.v1.ts` — `returnId`, `academicYear`, `recordCount`, `generatedAt`
- `hesa-return-submitted.v1.ts` — `returnId`, `academicYear`, `submissionReference`, `submittedAt`
- `hesa-id-assigned.v1.ts` — `returnId`, `enrolmentId`, `hesaId`, `assignedAt`
- `slc-confirmation-sent.v1.ts` — `enrolmentId`, `confirmationType` (`enrolment` | `withdrawal` | `intermission`), `exchangeId`
- `slc-notification-received.v1.ts` — `enrolmentId`, `notificationTypeCode`, `amount` (nullable), `effectiveDate`, `notificationId`
- `ukvi-cas-requested.v1.ts` — `enrolmentId`, `casRequestId`, `requestedAt`
- `ukvi-cas-assigned.v1.ts` — `enrolmentId`, `casRequestId`, `casReference`, `assignedAt`
- `ukvi-attendance-submitted.v1.ts` — `academicPeriodId`, `reportId`, `submittedAt`, `studentCount`
- `ukvi-visa-status-updated.v1.ts` — `enrolmentId`, `casReference`, `statusCode`, `effectiveDate`
- `ukvi-compliance-alert-raised.v1.ts` — `enrolmentId`, `alertTypeCode`, `casReference` (nullable), `triggeredAt`
- `ofs-extract-generated.v1.ts` — `extractId`, `extractTypeCode`, `academicYear`, `recordCount`, `generatedAt`

New payload files under `packages/domain/src/events/governance/`:
- `exam-entry-submitted.v1.ts` — `examBoardId`, `entryCount`, `submittedAt`
- `exam-schedule-received.v1.ts` — `examBoardId`, `receiptId`, `candidateCount`, `receivedAt`

Register all new subjects in `EVENT_TYPES` in `packages/domain/src/events/index.ts`:

```typescript
// ── Phase 6 ──────────────────────────────────────────────────────────────────
REGULATORY_UCAS_APPLICATION_RECEIVED:    'srs.regulatory.ucas-application-received',
REGULATORY_UCAS_CONFIRMATION_SENT:       'srs.regulatory.ucas-confirmation-sent',
REGULATORY_HESA_RETURN_GENERATED:        'srs.regulatory.hesa-return-generated',
REGULATORY_HESA_RETURN_SUBMITTED:        'srs.regulatory.hesa-return-submitted',
REGULATORY_HESA_ID_ASSIGNED:             'srs.regulatory.hesa-id-assigned',
REGULATORY_SLC_CONFIRMATION_SENT:        'srs.regulatory.slc-confirmation-sent',
REGULATORY_SLC_NOTIFICATION_RECEIVED:    'srs.regulatory.slc-notification-received',
REGULATORY_UKVI_CAS_REQUESTED:           'srs.regulatory.ukvi-cas-requested',
REGULATORY_UKVI_CAS_ASSIGNED:            'srs.regulatory.ukvi-cas-assigned',
REGULATORY_UKVI_ATTENDANCE_SUBMITTED:    'srs.regulatory.ukvi-attendance-submitted',
REGULATORY_UKVI_VISA_STATUS_UPDATED:     'srs.regulatory.ukvi-visa-status-updated',
REGULATORY_UKVI_COMPLIANCE_ALERT:        'srs.regulatory.ukvi-compliance-alert-raised',
REGULATORY_OFS_EXTRACT_GENERATED:        'srs.regulatory.ofs-extract-generated',
GOVERNANCE_EXAM_ENTRY_SUBMITTED:         'srs.governance.exam-entry-submitted',
GOVERNANCE_EXAM_SCHEDULE_RECEIVED:       'srs.governance.exam-schedule-received',
```

### New permissions (`packages/domain/src/permissions.ts`)

Add a new `regulatory-officer` role to the `Role` union and the following permission bindings:

```typescript
'regulatory:read':   ['registry-administrator', 'regulatory-officer'] as Role[],
'regulatory:write':  ['registry-administrator', 'regulatory-officer'] as Role[],
```

`integration:manage` already exists (held by `tenant-administrator`) and covers integration contract administration.

### Verification

- `pnpm typecheck`
- `pnpm test` (migration tests for all new tables, RLS, field value set coverage)

---

## Stage 1 — UCAS Admissions Exchange (UCR-001, UCR-002, UCR-003, UCR-004)

**Status**: Complete — implemented UCAS ingestion/list/link routes, confirmed-application auto enrolment, outbound confirmation generation from Phase 4 downstream triggers, exchange ledger writes, audit records, and focused integration coverage.

**Scope**: Inbound UCAS application data is ingested and staged; confirmed acceptances trigger enrolment creation. Outbound: pending `ucas-confirmation` downstream triggers (queued in Phase 4) are resolved into formatted confirmation records and marked as processed. Clearing period support (UCR-004) is implemented as an application status variant, not a separate flow.

### Implementation

**Service** `apps/api/src/platform/regulatory/ucas-service.ts`:
- `ingestApplication(tenantId, payload, actorId)`:
  1. Validates UCAS cycle and status code against value sets
  2. Inserts `ucas_application` row (bitemporal); deduplicates on `ucasPersonalId` + `cycle` (updates status if already present)
  3. Records inbound exchange through `RegulatoryExchangeService.recordExchange` with contract `ucas-admissions-exchange.{cycle}`, direction `inbound`, idempotency key `ucas:{ucasPersonalId}:{cycle}:{statusCode}`
  4. Publishes `srs.regulatory.ucas-application-received` (personal classification)
  5. If `statusCode` is `confirmed`: calls `StudentService.createStudent` and `EnrolmentService.createEnrolment` from the application payload; sets `ucas_application.linked_enrolment_id` to the new enrolment
- `linkApplicationToEnrolment(applicationId, enrolmentId, tenantId, actorId)` — manual linkage for cases where auto-matching fails
- `generateOutboundConfirmations(tenantId, cycle, actorId)`:
  1. Queries `enrolment_downstream_trigger` rows with `trigger_type_code = 'ucas-confirmation'` and `status_code = 'pending'` for the given tenant
  2. For each trigger: fetches enrolment, constructs the UCAS confirmation record (enrolment status → UCAS notification type mapping)
  3. Appends to the outbound confirmation payload buffer
  4. Records `integration_exchange` (outbound) per trigger through `RegulatoryExchangeService.recordExchange`
  5. Sets trigger row `status_code` to `processed` and `sent_at` to now
  6. Publishes `srs.regulatory.ucas-confirmation-sent` (personal classification) per processed trigger
  7. Returns confirmation payload buffer (JSON structure ready for formatting as UCAS API call or file)
- `listApplications(tenantId, filters)` — returns current UCAS application records, optionally filtered by cycle or status

**Routes**:
- `POST /api/v1/regulatory/ucas/applications` — ingest inbound application (`regulatory:write`)
- `GET /api/v1/regulatory/ucas/applications` — list applications (`regulatory:read`)
- `POST /api/v1/regulatory/ucas/applications/:applicationId/link` — link to enrolment (`regulatory:write`)
- `POST /api/v1/regulatory/ucas/confirmations/generate` — generate outbound confirmations (`regulatory:write`); body: `{ cycle: string }`; returns `{ processedCount, payload }`

**Audit**: `ingestApplication`, `generateOutboundConfirmations`, `linkApplicationToEnrolment`.

**OpenAPI tag**: `regulatory`

### Key decisions

**UCAS clearing (UCR-004)**: Clearing applications are `ucas_application` rows with `status_code = 'clearing'`. The ingest path stages them and publishes the application-received event, but it does not auto-create a student or enrolment because clearing offers often require manual eligibility and duplicate checks. Staff link clearing applications to an existing or newly created enrolment through `linkApplicationToEnrolment`. The cycle suffix in the contract ID (`ucas-admissions-exchange.{cycle}`) is resolved to the actual cycle year at runtime (`ucas-admissions-exchange.2027`).

**Idempotency**: The `integration_exchange.idempotency_key` for outbound confirmations is `ucas-confirmation:{triggerId}`. Calling `generateOutboundConfirmations` twice for the same trigger is safe — the trigger is set to `status_code = 'processed'` and `sent_at = now` on first call; subsequent calls skip processed triggers.

### Verification

- Inbound application with `confirmed` status creates a student + enrolment and links the application
- Inbound application with `clearing` status is staged without triggering enrolment creation; can be manually linked
- `generateOutboundConfirmations` processes only `pending` triggers; calling it twice does not double-submit
- Cross-tenant isolation: applications from tenant A are not visible to tenant B
- `srs.regulatory.ucas-application-received` published with personal classification
- `srs.regulatory.ucas-confirmation-sent` published per processed trigger

---

## Stage 2 — HESA Student Return (HES-001, HES-002, HES-003, HES-004, HES-005)

**Status**: Complete — implemented HESA return generation, structural validation, XML submission-file evidence, inbound validation report processing, HESA ID assignment propagation, manual submission confirmation, amendment generation, routes, audit records, and focused integration coverage.

**Scope**: HESA is the most complex regulatory obligation. This stage implements the extraction pipeline, HESA business rule validation, submission file generation, inbound validation report processing, and HESA ID propagation. Full HESA coding manual compliance requires institutional configuration; this stage defines the framework and maps all data fields available from Phases 4–5.

### Implementation

**Service** `apps/api/src/platform/regulatory/hesa-service.ts`:
- `generateStudentReturn(tenantId, academicYear, actorId)`:
  1. Creates `hesa_student_return` row with `status_code = 'draft'`
  2. Queries all current enrolments for the academic year (joining persons, personal identities, programmes, module registrations, module results, awards)
  3. For each enrolment, assembles the HESA field set using `#mapStudentToHesa(enrolment, tenantId)` — returns a JSONB object keyed by HESA field codes (e.g. `HUSID`, `SURNAME`, `FNAMES`, `BIRTHDTE`, `SEXID`, `MODE`, `MSTUFEE`, `YEARPRG`, `QUALAID`, etc.)
  4. Inserts one `hesa_student_return_record` row per enrolment
  5. Updates `hesa_student_return.status_code` to `draft` with record count
  6. Publishes `srs.regulatory.hesa-return-generated` (regulatory classification)
  7. Returns `returnId`
- `validateReturn(returnId, tenantId, actorId)`:
  1. Fetches all `hesa_student_return_record` rows for the return
  2. Runs built-in HESA business rule checks (see Key Decisions)
  3. Returns `{ isValid: boolean; errors: Array<{ field, studentId, message }>; warnings: Array<...> }`
  4. Inserts a `hesa_validation_report` row with `raw_payload` containing the internal validation result, plus one `hesa_validation_issue` row per error/warning
  5. Updates `hesa_student_return.status_code` to `validated` and `validated_at` to now if no blocking errors; otherwise leaves status as `draft`
- `generateSubmissionFile(returnId, tenantId, actorId)`:
  1. Validates status is `validated` or better; throws 422 if `draft`
  2. Serialises all `hesa_student_return_record.record_payload` rows into HESA XML format (structured per HESA coding manual section ordering)
  3. Returns the XML as a `Buffer`; stores a SHA-256 hash and summary metadata, not the full payload, in `integration_exchange.payload_summary`
  4. Records exchange through `RegulatoryExchangeService.recordExchange` (outbound) with `exchange_type_code = 'hesa-submission-file'` and `idempotency_key = hesa:{returnId}:file:{payloadHash}`
  5. Inserts `hesa_submission` evidence linked to the exchange
  6. Does not mark the return submitted; formal submission is a separate manual confirmation route after staff download and submit the file
- `processValidationReport(returnId, tenantId, report, actorId)`:
  1. Parses the HESA validation report payload (JSONB; caller is responsible for ingesting the report file content)
  2. Records `integration_exchange` (inbound) through `RegulatoryExchangeService.recordExchange`
  3. Inserts `hesa_validation_report` and normalised `hesa_validation_issue` rows
  4. For each `HUSID` present in the report alongside a `hesaId` assignment: calls `StudentService.updateHesaId(personId, tenantId, hesaId)`, updates `hesa_student_return_record.hesa_id`, inserts `hesa_identifier_assignment`, and publishes `srs.regulatory.hesa-id-assigned` (regulatory)
  5. Updates return status to `validation-report-received` or `amendment-required` depending on blocking errors
- `markSubmitted(returnId, tenantId, submissionReference, actorId)`:
  1. Validates a generated `hesa_submission` exists for the return
  2. Updates the latest `hesa_submission.submitted_at` and `submission_reference`
  3. Updates `hesa_student_return.status_code` to `submitted`, `submitted_at` to now, and `submission_reference`
  4. Publishes `srs.regulatory.hesa-return-submitted` (regulatory classification)
- `generateAmendment(returnId, tenantId, actorId)`:
  1. Validates the return status is `amendment-required`
  2. Calls `generateStudentReturn` with `amendment_of_id = returnId` — the new return inherits the academic year, regenerates records from current source data, and chains to the original via `amendment_of_id`
  3. HES-005 is satisfied by this self-FK chain; each amendment is a full re-extraction with its own record set
- `getReturn(returnId, tenantId)` — return detail and validation summary
- `listReturns(tenantId, academicYear?)` — list all returns, optionally filtered by year

**`#mapStudentToHesa`** — internal method, not directly called by routes:
- Maps SRS fields to HESA field codes. Fields sourced from:
  - `person`: `SURNAME`, `FNAMES`, `BIRTHDTE`, `SEXID`, `NATION` (nationality → HESA NATION code)
  - `person.hesaId`: `HUSID`
  - `enrolment`: `MODE` (full-time/part-time → HESA MODE code), `YEARPRG`, `MSTUFEE` (fee type)
  - `programme`: `QUALAID` (qualification type → HESA QUALAID code), `SBJCA`, `ITTSCHM`
  - `module_registration` + `module_result`: `MODID`, `CREDIT`, `UNITLGTH`, `GRADE`
  - `award`: `QUALDEG`, `CLSSHDG`, `CLASSQ`
- Fields without a direct source are emitted as `null` with a `_mapping_note` comment so institutions can identify gaps and configure supplementary data
- The mapping is expressed as a configuration-driven map rather than hardcoded logic, allowing institutions to override field derivations via the rules engine

**Routes**:
- `POST /api/v1/regulatory/hesa/returns` — generate return (`regulatory:write`); body: `{ academicYear: string }`
- `GET /api/v1/regulatory/hesa/returns` — list returns (`regulatory:read`)
- `GET /api/v1/regulatory/hesa/returns/:returnId` — return detail (`regulatory:read`)
- `POST /api/v1/regulatory/hesa/returns/:returnId/validate` — validate return (`regulatory:write`)
- `GET /api/v1/regulatory/hesa/returns/:returnId/file` — download submission XML (`regulatory:read`); streams file content; 422 if status is `draft`
- `POST /api/v1/regulatory/hesa/returns/:returnId/validation-reports` — ingest HESA validation report (`regulatory:write`); body: `{ reportPayload: object }` (raw HESA report JSON)
- `POST /api/v1/regulatory/hesa/returns/:returnId/submit` — mark return as formally submitted (manual step after file download); body: `{ submissionReference?: string }` (`regulatory:write`)
- `POST /api/v1/regulatory/hesa/returns/:returnId/amendments` — generate amendment return (`regulatory:write`)

**Audit**: `generateStudentReturn`, `validateReturn`, `generateSubmissionFile`, `processValidationReport`, `generateAmendment`.

**OpenAPI tag**: `regulatory`

### Key decisions

**HESA business rule validation (HES-002)**: The validation method implements a representative set of HESA blocking rules:
- Every student record must have `HUSID` or a pending assignment (null on first submission is allowed; null after validation report is blocking)
- `BIRTHDTE` must be a valid date; student must be ≥ 16 years old on enrolment start date
- `MODE` must be a valid HESA code (derived from SRS mode-of-study value set mapping)
- If `QUALDEG` is present, `CLSSHDG` must also be present
- `YEARPRG` must be a positive integer
- Total credit for a student within the academic year must be ≥ 0

Full HESA business rule coverage (which runs to hundreds of rules in the coding manual) requires institutional configuration; this stage validates the universal structural rules. Institutions add supplementary rules via the rules engine.

**HESA ID propagation (HES-004, SID-004)**: When `processValidationReport` assigns a HESA ID to a student, it calls the existing `StudentService.updateHesaId` from Phase 4. This propagates the ID to the `person.hesa_id` field and publishes a `srs.regulatory.hesa-id-assigned` event. Downstream systems that need the HESA ID subscribe to this event — this is the canonical propagation path.

**Submission file format**: The HESA submission XML structure follows the HESA Student Record schema. The `generateSubmissionFile` method builds a document with a `<StudentReturn>` root element, one `<Student>` element per record, and child elements matching HESA field codes. The exact element ordering and namespace follow the HESA coding manual for the relevant submission year. As the coding manual is updated annually, the serialiser must use the `return.academic_year` to select the correct element ordering (modelled as a year-keyed configuration map).

### Verification

- `generateStudentReturn` creates one `hesa_student_return_record` per currently enrolled student in the academic year
- `validateReturn` returns blocking errors for records missing `BIRTHDTE` or with invalid `MODE` codes
- `generateSubmissionFile` returns 422 when return status is `draft`
- `generateSubmissionFile` inserts `hesa_submission` evidence without marking the return submitted
- `markSubmitted` updates submission evidence and publishes `hesa-return-submitted`
- `processValidationReport` stores report/issues, stores HESA IDs on the correct student records, writes `hesa_identifier_assignment`, and publishes one `hesa-id-assigned` event per assignment
- Amendment return chains `amendment_of_id` to the original return
- HES-005: amendment return includes updated data for students whose records changed since the original submission
- Cross-tenant isolation: returns from tenant A are not visible to tenant B
- `srs.regulatory.hesa-return-generated` and `srs.regulatory.hesa-id-assigned` published with regulatory classification

---

## Stage 3 — Student Loans Company Exchange (SLC-001, SLC-002, SLC-003)

**Status**: Complete — implemented SLC confirmation generation from downstream triggers, status-change notifications, inbound notification recording, exchange ledger writes, sensitive event publication, routes, audit records, and focused integration coverage.

**Scope**: Enrolment confirmations and status-change notifications are sent to SLC, triggering tuition fee loan release. Inbound SLC notifications (entitlement, payment, overpayment) are received and recorded. Pending `slc-confirmation` downstream triggers from Phase 4 are processed here.

### Implementation

**Service** `apps/api/src/platform/regulatory/slc-service.ts`:
- `generateConfirmations(tenantId, actorId)`:
  1. Queries `enrolment_downstream_trigger` rows with `trigger_type_code = 'slc-confirmation'` and `status_code = 'pending'` for the tenant
  2. For each trigger: fetches enrolment, programme, and fee liability data
  3. Builds SLC confirmation record (SLC require: student SLC reference, programme code, mode of study, fee amount, start/end date)
  4. Records `integration_exchange` per trigger through `RegulatoryExchangeService.recordExchange` (outbound, contract `slc-enrolment-exchange.v1`, idempotency key `slc-confirmation:{triggerId}`)
  5. Sets trigger `status_code = 'processed'` and `sent_at = now`
  6. Publishes `srs.regulatory.slc-confirmation-sent` (sensitive classification) per trigger
  7. Returns `{ processedCount, payload }` — payload is a structured JSON object ready for SLC API format or file format
- `generateStatusChangeNotification(enrolmentId, tenantId, actorId)`:
  1. Fetches current enrolment status and SLC reference
  2. Builds SLC status-change notification (status → SLC notification type mapping: `withdrawn` → `withdrawal`, `intermitting` → `suspension-of-studies`)
  3. Records `integration_exchange` through `RegulatoryExchangeService.recordExchange` and publishes `srs.regulatory.slc-confirmation-sent`
  4. If there is no SLC reference on the enrolment, throws `ValidationError` (422)
- `processInboundNotification(tenantId, notification, actorId)`:
  1. Validates `notificationTypeCode` against value set
  2. Inserts `slc_notification` row
  3. Records `integration_exchange` through `RegulatoryExchangeService.recordExchange` (inbound, idempotency key provided by caller)
  4. Publishes `srs.regulatory.slc-notification-received` (sensitive classification)
- `listNotifications(enrolmentId, tenantId)` — returns SLC notifications for an enrolment
- `getExchangeStatus(tenantId, filters)` — returns `integration_exchange` rows for `slc-enrolment-exchange.v1`

**Routes**:
- `POST /api/v1/regulatory/slc/confirmations/generate` — generate confirmations (`regulatory:write`); returns `{ processedCount, payload }`
- `POST /api/v1/enrolments/:enrolmentId/slc-status-notification` — generate status-change notification (`regulatory:write`)
- `POST /api/v1/regulatory/slc/notifications` — ingest inbound SLC notification (`regulatory:write`)
- `GET /api/v1/enrolments/:enrolmentId/slc-notifications` — list SLC notifications for enrolment (`regulatory:read`)

**Audit**: `generateConfirmations`, `generateStatusChangeNotification`, `processInboundNotification`.

**OpenAPI tag**: `regulatory`

### Verification

- `generateConfirmations` processes all pending `slc-confirmation` triggers; does not reprocess already-processed triggers
- `generateStatusChangeNotification` returns 422 when no SLC reference is recorded on the enrolment
- `processInboundNotification` records notification and publishes event with sensitive classification
- Overpayment notification recorded without error (negative `amount` is accepted)
- Cross-tenant isolation
- `srs.regulatory.slc-confirmation-sent` published with sensitive classification

---

## Stage 4 — UKVI Compliance (UKV-001, UKV-002, UKV-003, UKV-004, UKV-005)

**Status**: Complete — implemented UKVI CAS request generation from downstream triggers, bitemporal CAS assignment recording, attendance compliance report generation, inbound visa status recording, compliance alert raise/evaluate/resolve flows, routes, audit records, and focused integration coverage.

**Scope**: CAS creation requests are generated for students requiring a Student visa. Ongoing attendance compliance data is submitted to UKVI. Inbound visa status updates are received and recorded. The compliance alert mechanism flags students whose attendance falls below the configured threshold.

### Implementation

**Service** `apps/api/src/platform/regulatory/ukvi-service.ts`:
- `generateCasRequests(tenantId, actorId)`:
  1. Queries `enrolment_downstream_trigger` rows with `trigger_type_code = 'ukvi-cas'` and `status_code = 'pending'`
  2. For each trigger: fetches enrolment, person identity, and programme data
  3. Inserts `ukvi_cas_request` row with `status_code = 'pending'`
  4. Records `integration_exchange` through `RegulatoryExchangeService.recordExchange` (outbound, idempotency key `ukvi-cas:{triggerId}`)
  5. Sets trigger `status_code = 'processed'` and `sent_at = now`
  6. Publishes `srs.regulatory.ukvi-cas-requested` (sensitive classification)
  7. Returns `{ processedCount, casRequests: Array<{ casRequestId, enrolmentId, personData }> }`
- `recordCasAssignment(casRequestId, casReference, tenantId, actorId)`:
  1. Closes the current `ukvi_cas_request` version; inserts new version with `status_code = 'assigned'` and `cas_reference`
  2. Publishes `srs.regulatory.ukvi-cas-assigned` (sensitive classification)
- `generateAttendanceReport(tenantId, academicPeriodId, actorId)`:
  1. Queries all active sponsored students using assigned current `ukvi_cas_request` rows and/or current `student_regulatory_profile.ukvi_sponsorship_required = true` for the academic period
  2. Fetches their attendance data (from the integration layer; attendance monitoring pushes `srs.enrolment.module-registration-completed` events which the SRS uses as a proxy for attendance — see Key Decisions)
  3. Assembles the attendance compliance payload (per UKVI reporting requirements: student count, absence details, compliance threshold status)
  4. Inserts `ukvi_attendance_report` row
  5. Records `integration_exchange` through `RegulatoryExchangeService.recordExchange` (outbound, idempotency key `ukvi-attendance:{academicPeriodId}:{tenantId}:{timestamp}`)
  6. Publishes `srs.regulatory.ukvi-attendance-submitted` (regulatory classification)
  7. Returns report payload
- `processVisaStatusUpdate(tenantId, casReference, update, actorId)`:
  1. Locates the `ukvi_cas_request` by `cas_reference`
  2. Inserts `ukvi_visa_status` row (bitemporal)
  3. If status is `curtailed` or `refused`: inserts `ukvi_compliance_alert` with `alert_type_code = 'visa-curtailed'`; publishes alert event
  4. Records `integration_exchange` through `RegulatoryExchangeService.recordExchange` (inbound)
  5. Publishes `srs.regulatory.ukvi-visa-status-updated` (sensitive classification)
- `evaluateComplianceAlerts(tenantId, actorId)`:
  1. Fetches the configured UKVI attendance compliance threshold from the rules engine (rule type: `ukvi-attendance-threshold`, default 10 unauthorised absences per 8-week period per UKVI guidance)
  2. Evaluates each active sponsored student's attendance proxy data against the threshold
  3. For any student breaching the threshold with no existing open alert: inserts `ukvi_compliance_alert` with `alert_type_code = 'attendance-threshold-breach'` and publishes `srs.regulatory.ukvi-compliance-alert-raised`
  4. Returns `{ alertsRaised: number }`
- `resolveComplianceAlert(alertId, tenantId, actorId)` — sets `resolved_at` and `resolved_by` on the alert row
- `listCasRequests(tenantId, filters)` — list CAS requests, filterable by status
- `listComplianceAlerts(tenantId, unresolvedOnly?)` — list active/all compliance alerts

**Routes**:
- `POST /api/v1/regulatory/ukvi/cas-requests/generate` — generate CAS requests (`regulatory:write`)
- `GET /api/v1/regulatory/ukvi/cas-requests` — list CAS requests (`regulatory:read`)
- `POST /api/v1/regulatory/ukvi/cas-requests/:casRequestId/assignment` — record CAS assignment (`regulatory:write`); body: `{ casReference: string }`
- `POST /api/v1/regulatory/ukvi/attendance-reports/generate` — generate attendance report (`regulatory:write`); body: `{ academicPeriodId: string }`
- `POST /api/v1/regulatory/ukvi/visa-updates` — ingest visa status update (`regulatory:write`); body: `{ casReference, statusCode, effectiveDate, rawPayload }`
- `POST /api/v1/regulatory/ukvi/compliance-alerts/evaluate` — evaluate and raise alerts (`regulatory:write`)
- `GET /api/v1/regulatory/ukvi/compliance-alerts` — list alerts (`regulatory:read`)
- `POST /api/v1/regulatory/ukvi/compliance-alerts/:alertId/resolve` — resolve alert (`regulatory:write`)

**Audit**: all write operations. Alert raises and resolutions are specifically important for UKV-005 compliance inspection records.

**OpenAPI tag**: `regulatory`

### Key decisions

**Attendance data (UKV-002)**: The SRS does not own attendance data — that belongs to the Attendance Monitoring system. Phase 6 uses `srs.enrolment.module-registration-completed` events (from Phase 4) and any absence data pushed inbound from Attendance Monitoring (via `integration:manage` POST routes) as a proxy. A full attendance-compliance pipeline requires Phase 9 (VLE Connector) and the Phase 8 (Wellbeing) module. Stage 4's `generateAttendanceReport` assembles the available data and marks fields that require Attendance Monitoring integration as `pending-attendance-integration` in the report payload; this satisfies UKV-002 structurally while acknowledging the dependency.

**New rule type**: Add `ukvi-attendance-threshold` to the rules engine `RuleTypeCode` union in Stage 0's services (or extend in this stage if preferred). Default: 10 unauthorised absences per 8-week period.

### Verification

- `generateCasRequests` processes all pending `ukvi-cas` triggers; does not reprocess
- `recordCasAssignment` closes and re-inserts the `ukvi_cas_request` bitemporally with `cas_reference`
- `processVisaStatusUpdate` with `curtailed` status raises a compliance alert
- `evaluateComplianceAlerts` raises an alert for students above threshold; does not duplicate open alerts
- Alert resolution sets `resolved_at` and prevents re-raising for the same breach within the same period
- Cross-tenant isolation
- All events published with sensitive classification and regulatory subject names

---

## Stage 5 — OfS Reporting and FOI Support (OFS-001, OFS-002, OFS-003, OFS-004, OFS-005)

**Status**: Complete — implemented OfS B3 and participation extract generation/retrieval, FOI request intake with statutory deadline calculation, aggregate-safe FOI extract generation, bitemporal FOI status updates, routes, audit records, and focused integration coverage.

**Scope**: Structured data extracts for OfS B3 condition reporting and access and participation plan progress. FOI request logging and data extract generation for authorised responses. These are reporting and extract capabilities, not exchange flows — there is no regulatory body integration; all outputs are downloaded by authorised staff.

### Implementation

**Service** `apps/api/src/platform/regulatory/ofs-service.ts`:
- `generateB3Extract(tenantId, academicYear, actorId)`:
  1. Queries: all enrolments (with programme and module data), all awarded qualifications, progression decisions, and demographic data (nationality, age group — derived from person data without exposing raw PII in the extract aggregate)
  2. Computes the B3 student outcome measures: continuation rate, completion rate, progression rate (employment or further study)
  3. Assembles the extract as a structured JSONB document keyed by OfS B3 metric codes
  4. Inserts `ofs_extract` row
  5. Publishes `srs.regulatory.ofs-extract-generated` (regulatory classification)
  6. Returns `{ extractId, recordCount, payload }`
- `generateParticipationReport(tenantId, academicYear, actorId)` — OFS-002 (Should priority):
  1. Extracts enrolment and outcome data segmented by access and participation characteristics (POLAR4 quintile, IMD decile, care-experienced status from `student_regulatory_profile`; declared disability from `disability_declaration`)
  2. Returns `{ extractId, payload }`
- `getExtract(extractId, tenantId)` — retrieve extract payload

**Service** `apps/api/src/platform/regulatory/foi-service.ts`:
- `recordRequest(tenantId, input, actorId)`:
  1. Validates `received_date` and derives `statutory_deadline_date` (20 working days from receipt per FOIA s.10)
  2. Inserts `foi_request` row (bitemporal)
  3. Returns `{ requestId, statutoryDeadlineDate }`
- `generateExtract(requestId, tenantId, querySummary, actorId)`:
  1. Fetches the `foi_request`; validates status is not `responded` or `refused`
  2. Executes a parameterised read-only query against permitted data domains (enrolment counts, graduation rates — never PII unless specific DPA legal basis is recorded)
  3. Inserts `foi_extract` row
  4. Returns `{ extractId, recordCount, payload }`
- `updateRequestStatus(requestId, tenantId, status, actorId)` — advance status bitemporally (e.g. `in-progress` → `responded`)
- `listRequests(tenantId, filters)` — list FOI requests, filterable by status and deadline proximity

**Routes**:
- `POST /api/v1/regulatory/ofs/b3-extracts` — generate B3 extract (`regulatory:write`); body: `{ academicYear }`
- `GET /api/v1/regulatory/ofs/b3-extracts/:extractId` — retrieve extract (`regulatory:read`)
- `POST /api/v1/regulatory/ofs/participation-reports` — generate participation report (`regulatory:write`)
- `POST /api/v1/regulatory/foi/requests` — record FOI request (`regulatory:write`)
- `GET /api/v1/regulatory/foi/requests` — list requests (`regulatory:read`)
- `GET /api/v1/regulatory/foi/requests/:requestId` — request detail (`regulatory:read`)
- `POST /api/v1/regulatory/foi/requests/:requestId/extract` — generate data extract (`regulatory:write`); body: `{ querySummary }`
- `PATCH /api/v1/regulatory/foi/requests/:requestId/status` — update status (`regulatory:write`); body: `{ statusCode }`

**Audit**: all write operations. FOI operations are specifically sensitive — audit records must include `actorId`, `correlationId`, and `querySummary`.

**OpenAPI tag**: `regulatory`

### Key decisions

**OFS-003 (Prevent duty)**: Prevent duty records are primarily student wellbeing records (Phase 8 scope). OFS-003 is implemented here as an extract capability that can reference existing enrolment and status data but does not create new domain objects. Full Prevent workflow data requires Phase 8.

**FOI extract scope (OFS-004)**: FOI extracts are restricted to aggregate, non-PII data by default. If a specific request has a DPA legal basis requiring PII, a separate `foi_request.legal_basis` field is populated by the `recordRequest` call and the extract function unlocks PII fields for that request. This design prevents inadvertent PII exposure in routine FOI responses.

**Missing segmentation values**: OfS participation fields that are absent from `student_regulatory_profile` are emitted as `unknown` with a data-quality note in the extract. The extract generator must not derive POLAR4/IMD/care-experienced values from unrelated fields.

### Verification

- B3 extract contains continuation, completion, and progression metrics for all enrolled students in the academic year
- B3 extract record count matches enrolled student count for the year
- FOI `statutory_deadline_date` is calculated as 20 working days from `received_date`
- FOI extract for a request in `responded` status returns 422
- Cross-tenant isolation
- `srs.regulatory.ofs-extract-generated` published with regulatory classification

---

## Stage 6 — Exam Entry and Scheduling Exchange (GOV-008, GOV-009)

**Status**: Complete — implemented exam entry generation from current exam board data packs, accommodation forwarding, exam scheduling exchange ledger records, inbound timetable receipt processing with bitemporal entry updates, student-facing timetable routes, audit records, and focused integration coverage.

**Scope**: Deferred from Phase 5. Exam entry data is generated per exam board and provided to the Exam Scheduling system. The SRS receives finalised timetable, seating, and candidate number data back and makes it available to students. Approved accommodation adjustments (from Phase 5 reasonable adjustments) are included in exam entries.

### Implementation

**Service** `apps/api/src/platform/assessment/exam-entry-service.ts`:
- `generateExamEntries(examBoardId, tenantId, actorId)`:
  1. Fetches the exam board and its current non-superseded data pack
  2. For each candidate in the data pack whose registration has no exam entry yet:
     - Creates `exam_entry` row (bitemporal) with `status_code = 'pending'`
     - Populates `accommodations` JSONB from the candidate's active adjustment indicators (type and scope only — same minimised payload as the data pack)
  3. Records exchange through `RegulatoryExchangeService.recordExchange` (outbound, idempotency key `exam-entries:{examBoardId}`)
  4. Publishes `srs.governance.exam-entry-submitted` (standard classification)
  5. Returns `{ entryCount, entries }`
- `processScheduleData(examBoardId, tenantId, payload, actorId)`:
  1. Inserts `exam_timetable_receipt` row (append-only)
  2. For each candidate in the payload: updates `exam_entry` bitemporally — sets `candidate_number`, `scheduled_date`, `room_reference`, `status_code = 'scheduled'`
  3. Records exchange through `RegulatoryExchangeService.recordExchange` (inbound)
  4. Publishes `srs.governance.exam-schedule-received` (standard classification)
- `getExamEntry(moduleRegistrationId, tenantId)` — current exam entry for a registration
- `listExamEntries(examBoardId, tenantId)` — all exam entries for a board

**Routes**:
- `POST /api/v1/exam-boards/:boardId/exam-entries/generate` — generate exam entries (`exam-board:write`)
- `GET /api/v1/exam-boards/:boardId/exam-entries` — list entries (`exam-board:read`)
- `POST /api/v1/exam-boards/:boardId/exam-schedule` — receive schedule data from Exam Scheduling (`integration:manage`); body: `{ candidates: Array<{ moduleRegistrationId, candidateNumber, scheduledDate, room }> }`
- `GET /api/v1/module-registrations/:moduleRegistrationId/exam-entry` — current exam entry (`mark:read:all`)
- `GET /api/v1/module-registrations/:moduleRegistrationId/exam-timetable` — student-facing timetable view (`student:read:own`, `mark:read:all`)

**Audit**: `generateExamEntries`, `processScheduleData`.

**OpenAPI tag**: `governance`

### Key decisions

**Data pack dependency**: `generateExamEntries` requires the exam board to have a current (non-superseded) data pack. If no pack exists, it throws `ValidationError` (422). This enforces the intended flow: data pack generation → exam entry generation → board meeting → ratification.

**Accommodation forwarding (GOV-008)**: The exam entry's `accommodations` JSONB mirrors the data pack's `adjustments` indicators for the candidate. This is a read-only projection — the source of truth for adjustments remains `reasonable_adjustment`. The Exam Scheduling system reads the adjustments field from the exam entry payload.

### Verification

- `generateExamEntries` creates one `exam_entry` per candidate in the data pack; calling twice does not create duplicates (existing current entry check plus `integration_exchange.idempotency_key`)
- `exam_entry.accommodations` includes only active adjustments for the candidate
- `processScheduleData` updates exam entries bitemporally with candidate numbers and scheduled dates
- `GET /api/v1/module-registrations/:id/exam-timetable` returns 404 when no schedule has been received
- Student-facing endpoint returns only the requesting student's own entry (enforced by `student:read:own` permission + tenant context)
- Cross-tenant isolation

---

## Stage 7 — Event Consumer Tests and OpenAPI

**Status**: Complete — implemented Phase 6 event consumer coverage, downstream trigger processing coverage, pinned contract fixture checks, OpenAPI tag/resource checks, and focused integration verification for all Phase 6 resources.

**Scope**: Event consumer tests for all Phase 6 domain events. OpenAPI tag verification for the `regulatory` and extended `governance` tags.

### Event consumer tests

Create `apps/api/test/events/phase6-event-consumer-tests.int.test.ts` covering all events introduced in Stages 1–6:

| Describe block | Events covered |
|---|---|
| UCAS events | `srs.regulatory.ucas-application-received`, `srs.regulatory.ucas-confirmation-sent` |
| HESA events | `srs.regulatory.hesa-return-generated`, `srs.regulatory.hesa-return-submitted`, `srs.regulatory.hesa-id-assigned` |
| SLC events | `srs.regulatory.slc-confirmation-sent`, `srs.regulatory.slc-notification-received` |
| UKVI events | `srs.regulatory.ukvi-cas-requested`, `srs.regulatory.ukvi-cas-assigned`, `srs.regulatory.ukvi-attendance-submitted`, `srs.regulatory.ukvi-visa-status-updated`, `srs.regulatory.ukvi-compliance-alert-raised` |
| OfS events | `srs.regulatory.ofs-extract-generated` |
| Exam entry events | `srs.governance.exam-entry-submitted`, `srs.governance.exam-schedule-received` |

Each test verifies: event subject, data classification, required fields present, UUID fields are valid UUIDs.

### Downstream trigger integration test

Create `apps/api/test/regulatory-trigger-processing.int.test.ts`:
- End-to-end test: create an enrolment with UCAS, SLC, and UKVI flags → verify three `enrolment_downstream_trigger` rows created → call each generate endpoint → verify all triggers have `status_code = 'processed'` and `sent_at` set → verify `integration_exchange` rows recorded → verify events published

### Contract tests

Create `apps/api/test/regulatory-contract-fixtures.int.test.ts`:
- UCAS generated confirmation payload matches required fields and value domains in `packages/testing/regulatory-contracts/ucas/2027/confirmation.sample.json`
- HESA generated XML validates against the pinned minimal XML structure and field ordering fixture for the selected academic year
- HESA validation report processing accepts the pinned report fixture and normalises expected issues/HESA ID assignments
- SLC confirmation and inbound notification payloads match the pinned v1 fixtures
- UKVI CAS, visa-status, and attendance payloads match pinned v1 fixtures, including sensitive classification expectations
- Exam Scheduling timetable receipt accepts the pinned v1 timetable fixture and updates entries bitemporally

These are contract fixture tests, not live external conformance tests. They satisfy the Phase 6 exit criterion by pinning representative published-spec structures in-repo; live SFTP/API certification belongs to Phase 7.

### OpenAPI

- Confirm `GET /api/v1/openapi.json` renders without schema gaps under `regulatory` and `governance` tags
- All Phase 6 routes tagged correctly

### Verification

All event consumer tests pass. Downstream trigger integration test passes. OpenAPI spec covers all Phase 6 resources.
Contract fixture tests pass for UCAS, HESA, SLC, UKVI, and Exam Scheduling payloads.

---

## Requirements coverage summary

| Requirement | Stage |
|---|---|
| UCR-001 (inbound UCAS application) | 1 |
| UCR-002 (enrolment from UCAS confirmation) | 1 |
| UCR-003 (outbound enrolment confirmation / withdrawal to UCAS) | 1 |
| UCR-004 (UCAS clearing) | 1 |
| HES-001 (HESA student return generation) | 2 |
| HES-002 (HESA business rule validation) | 2 |
| HES-003 (submission file generation and submission) | 2 |
| HES-004 (validation report and HESA ID assignment) | 2 |
| HES-005 (HESA return amendments) | 2 |
| SLC-001 (enrolment confirmation to SLC) | 3 |
| SLC-002 (status-change notification to SLC) | 3 |
| SLC-003 (inbound SLC loan entitlement and payment) | 3 |
| UKV-001 (CAS creation request) | 4 |
| UKV-002 (attendance compliance data to UKVI) | 4 (partial — full attendance data in Phase 9) |
| UKV-003 (inbound visa status updates) | 4 |
| UKV-004 (attendance compliance alerts) | 4 |
| UKV-005 (sponsor licence compliance records) | 4 |
| OFS-001 (OfS B3 student outcome extract) | 5 |
| OFS-002 (access and participation progress) | 5 |
| OFS-003 (Prevent duty records) | 5 (structural; workflow in Phase 8) |
| OFS-004 (FOI support tooling) | 5 |
| OFS-005 (CMA course information) | 5 (extract only; publication in Phase 10) |
| GOV-008 (exam scheduling data provision) | 6 |
| GOV-009 (timetable and candidate number receipt) | 6 |

---

## Key implementation decisions

**Phase 6 does not implement automated file transfer.** All regulatory file exchange in Phase 6 is mediated by authorised staff: files are downloaded via GET endpoints and submitted manually to the regulatory body's portal or API. Automated SFTP transmission and webhook reception are Phase 7 concerns (Integration Layer: Published Interfaces). This keeps Phase 6 within scope and avoids implementing SFTP client infrastructure before the integration layer is published.

**Contract tests are pinned-fixture conformance tests.** Phase 6 does not call external regulator validation APIs during test runs. Instead, `packages/testing/regulatory-contracts/` contains pinned representative fixtures derived from published specifications for the implemented cycle/year. Tests assert required fields, value domains, payload shape, and ordering. Updating to a new annual specification means adding a new fixture version and updating the year/cycle selector.

**Downstream triggers are the canonical queue for outbound regulatory submissions.** The `enrolment_downstream_trigger` pattern established in Phase 4 is the bridge between domain events (student created/enrolled/status-changed) and outbound submissions. Phase 6 services drain this queue and record exchange outcomes. No Phase 6 service bypasses the trigger pattern to query enrolment data directly for submission purposes — all outbound regulatory notifications originate from a trigger row.

**Downstream trigger field names.** The existing trigger ledger uses `status_code` and `sent_at`; Phase 6 services must update those fields, not introduce `status` or `processed_at` aliases.

**Integration exchange registration.** All Phase 6 exchange writes go through `RegulatoryExchangeService`, which resolves/creates the tenant-scoped system-managed `integration_registration` required by `integration_exchange.integration_registration_id`.

**HESA field mapping is configuration-driven.** Rather than hardcoding HESA field derivation in service code, the mapping from SRS fields to HESA field codes is expressed as a configuration object (initial version hardcoded in the service; later phases allow per-institution override via the rules engine). This allows institutions to extend or correct field mappings without code changes.

**UKVI attendance data is acknowledged as incomplete until Phase 9.** Phase 6 generates attendance compliance reports from enrolment and module registration data (which the SRS does own). Granular absence data requires the Attendance Monitoring integration (Phase 9). `ukvi_attendance_report.report_payload` includes a `_attendance_data_completeness` field so institutions and auditors understand the data gap.

**Classification for regulatory events**: UCAS events are `personal`; HESA events are `regulatory`; SLC events are `sensitive`; UKVI events are `sensitive` with regulatory subject names. OfS extracts are `regulatory`. This classification drives NATS subject routing, audit depth, and retention policies under Phase 2's data classification model.

**FOI extract scope is permission-gated by legal basis.** By default, `foi-service.generateExtract` returns only aggregate non-PII data. A `legal_basis` field on `foi_request` (set at intake) unlocks PII fields for requests where data protection legislation requires it. This is a defence-in-depth control, not a replacement for access control — `regulatory:write` is still required for the route.

**Exam entry generation requires a current data pack.** This is not checked at the database layer (no FK constraint between `exam_entry` and `exam_board_data_pack`) but is enforced as a service-layer guard. The data pack is the definitive list of candidates; generating entries without it would risk omissions.

**`hesa_student_return` is not fully bitemporal.** Unlike assessment records, a HESA return is a versioned document. The amendment chain (via `amendment_of_id` self-FK) provides the temporal lineage without the complexity of valid-time/transaction-time axes. The `hesa_student_return_record` rows within a return are append-only and immutable; amendments produce a new return with a new record set.

**HESA lifecycle evidence.** Return status fields are denormalised summaries. Submission files, manual submission confirmation, validation reports, validation issues, and identifier assignments are recorded in append-only evidence tables before the summary fields are updated.
