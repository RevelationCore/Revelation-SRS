# Data Model Review — Pass 2

> Status: Draft for review
> Reviewed document: `docs/architecture/data-model.md`

## Findings

### DM2-001 — High — ERD is stale and omits most remediated entities

The entity relationship diagram still shows the original narrow model, ending around core student, enrolment, assessment, board, adjustment, EC, misconduct, audit, and integration registration entities. It does not include the large set of entities added later, such as `student_application`, `admissions_offer`, `identity_verification_check`, `student_address`, `fee_liability`, `timetabled_activity`, `attendance_record`, `exam_entry`, `exam_board_data_pack`, HESA/SLC/UKVI exchange entities, `staff_assignment`, `student_risk_flag`, or `student_document`.

Source: `data-model.md` lines 88-126 define the ERD; additional entities begin at line 475.

Impact: The ERD is now misleading as the main visual design artefact. Implementers may build migrations from the diagram and miss most remediation entities.

Recommendation: Replace the single ERD with either:

- a top-level domain ERD that includes all major aggregate roots, plus smaller domain ERDs; or
- remove the ERD until it can be generated from the eventual Drizzle schema.

### DM2-002 — High — `integration_registration` is still the old schema in the data model

The data model defines `integration_registration` with only the original fields: `integration_code`, `display_name`, `pattern_type`, `contract_version`, `enabled`, `configuration`, and health timestamps/status. The integration layer later says the table is extended with `contract_id`, `direction_code`, `owner_module_code`, `subject_filter`, `consumer_group`, `endpoint_url`, `file_schedule`, `transport_code`, `secret_ref`, `last_successful_exchange_at`, `replay_supported`, and `retry_policy`.

Source: old table in `data-model.md` lines 455-469; cross-reference says "Extended in integration-layer.md" at line 1056; extension lives in `integration-layer.md` lines 205-220.

Impact: The canonical data-model document and integration-layer document disagree about the physical table. Phase 3 migrations could implement only the old table or split fields incorrectly.

Recommendation: Make `data-model.md` the canonical schema. Inline the extended fields into `integration_registration` there, or split clearly into `integration_contract`, `integration_registration`, `integration_endpoint`, and `integration_health_status`.

### DM2-003 — High — Bitemporal identity semantics remain unsafe for foreign keys

Bitemporal tables use a stable `id` as primary key while updates are described as setting `recorded_until` on the existing row and inserting a new row with updated values. The document does not define whether the inserted row reuses the same logical `id` or receives a new UUID. If the same `id` is reused, the primary key cannot be unique. If a new `id` is used, foreign keys from related records point to a historical version rather than a logical entity.

Source: bitemporal update pattern in `data-model.md` lines 47-52; all tables use `id UUID PK` per lines 13-14 and naming convention lines 1064-1067.

Impact: This is a blocker for physical DDL. It affects core tables such as `programme`, `module`, `enrolment`, `module_registration`, `mark`, `module_result`, `fee_liability`, and many added bitemporal entities.

Recommendation: Adopt one of these patterns explicitly:

- logical ID plus version ID: `id` as stable logical UUID, `version_id` as PK, unique current row constraint; or
- temporal primary key: composite PK such as `(id, recorded_at)` with FKs either to logical IDs or exact versions; or
- separate root and history tables for heavily referenced entities.

### DM2-004 — High — Several foreign keys point to bitemporal entities without saying whether they target the logical record or a version

Examples include `enrolment.programme_id`, `module_offering.module_id`, `module_registration.enrolment_id`, `assessment_component.module_offering_id`, `mark.assessment_component_id`, `fee_liability.enrolment_id`, and many more. The model does not say whether these relationships bind to the current version, the version valid at a point in time, or an immutable version snapshot.

Source examples: `enrolment.programme_id` line 237; `module_offering.module_id` line 224; `module_registration.enrolment_id` line 256; `mark.assessment_component_id` line 283; `fee_liability.enrolment_id` line 600.

Impact: Historical reconstruction can become incorrect. For example, a student enrolled on a programme version from 2024 could accidentally resolve to the 2026 programme version unless version binding is explicit.

Recommendation: Define reference semantics per relationship:

- logical reference with bitemporal join by valid/recorded time; or
- exact version reference for immutable decisions and generated artefacts; or
- snapshot JSON for generated packs and submissions.

### DM2-005 — Medium — The document has duplicate structural markers and a patched-on shape

There are two consecutive horizontal rules before "Additional Entities" and the model is split into "Core Entity Definitions" followed by a long "Additional Entities" section. Some existing entities are not actually updated in place; they are listed later in "Modifications to Existing Entities".

Source: duplicate separators at lines 471-473; modifications table at lines 1043-1057.

Impact: This increases implementation risk because the document has two sources of truth for the same entity. For example, `programme` lacks `awarding_body_id` in its table but the modification table says to add it.

Recommendation: Fold modifications into the entity tables themselves. Retain a short "Change Log from Remediation" only as commentary.

### DM2-006 — Medium — Several first-remediation entities were not applied

The first remediation pack proposed entities that remain absent from the applied data model:

| Missing entity | Why it matters |
|---|---|
| `student_contact_method` | Contact preference and multiple phones/emails remain crammed into `person_identity`. |
| `assessment_pattern` | Catalogue-level assessment structure is reduced to `module.assessment_pattern_description` in the modification table. |
| `programme_rule_set` | There is no explicit link between programme/cohort and rule versions. |
| `student_timetable_entry` | Student-specific timetable visibility is not represented. |
| `engagement_summary` | ATT-001 requires a consolidated engagement record. |
| `misconduct_case_reference` | External AI case metadata remains minimal. |
| `misconduct_penalty_effect` | Penalty effects are stored as JSONB on `misconduct_outcome`, not relationally queryable. |
| `sponsor_evidence_record` | UKVI inspection evidence is required but not modelled. |
| `document_archive_confirmation` | EDRMS archival is folded into `student_document`, losing separate confirmation/access-log state. |
| `policy_publication_notice` | CMS F042 and CMA/regulatory publication support lack persistence. |
| `student_obligation` | Library obligations have no data home. |

Source: absent in `data-model.md`; first remediation lists these in `phase-2-remediation/data-model-remediation.md`.

Impact: Some remediated requirements still lack authoritative storage or have weak JSON/text placeholders.

Recommendation: Decide explicitly for each missing entity: add it, merge it into a named existing entity with fields, or document "not stored, externally referenced."

### DM2-007 — Medium — Polymorphic references prevent database-level referential integrity

`learning_outcome` uses `owner_type` + `owner_id` to refer to either programme or module. `post_ratification_amendment` and `data_quality_issue` use `entity_type` + `entity_id`. These cannot be enforced with ordinary foreign keys.

Source: `learning_outcome` lines 580-589; `post_ratification_amendment` lines 812-823; `data_quality_issue` lines 1016-1027.

Impact: This conflicts with NFR-DATA-002, which requires referential integrity at the database layer. It also makes cascading, RLS, and bitemporal reconstruction harder.

Recommendation: Prefer explicit nullable FKs with CHECK constraints, join tables per target type, or a controlled `record_reference` table populated by triggers. For amendments/audit-like references, document that referential integrity is intentionally not enforced and why.

### DM2-008 — Medium — Some append-only/status entities are mutable in disguise

Tables such as `adjustment_distribution`, `attendance_record`, `exam_timetable_entry`, `hesa_return`, and `student_document` include status or supersession fields on an append-only/versioned concept. It is unclear whether status changes update the row, insert a new row, or create a related status event.

Source examples: `adjustment_distribution.status_code` and `attempt_count` lines 363-376; `attendance_record.corrected_at` lines 674-686; `hesa_return.status_code`, `submitted_at`, `accepted_at` lines 841-853; `student_document.edrms_reference` and `archived_at` lines 1029-1039.

Impact: The model may violate the "no destructive update" principle or make audit semantics inconsistent.

Recommendation: For each append-only table, define whether:

- it is truly immutable and status changes go to child status rows;
- it is mutable but fully audited; or
- it should be bitemporal.

### DM2-009 — Medium — Special-category data is still mixed into broad identity structures

`person_identity` includes `ethnicity_code`, and `disability_declaration` stores disability data. The model says all tables have tenant RLS, but does not define field-level or table-level isolation for special-category records in the data model itself.

Source: `person_identity.ethnicity_code` line 173; `disability_declaration` lines 522-531; general tenant/RLS principle lines 67-84.

Impact: Repository-layer filtering alone can be easy to bypass. This is a major privacy/security design surface, especially for Wellbeing, EC, disability, ethnicity, and risk flags.

Recommendation: Add a data-classification column/table annotation section to the data model, and consider separate schemas/tables for special-category facts. Define read-audit triggers or service-level audit obligations for each.

### DM2-010 — Medium — Person status and enrolment status conflict is not resolved in the actual tables

SID-009 requires statuses including Prospective, Enrolled, Intermitting, Withdrawn, Suspended, Graduated, and Deceased. The base `person` table does not include `status_code`; the later modifications table says to add `prospective`, `enrolled`, `graduated`, and `deceased`, while `enrolment.status_code` handles intermitting/withdrawn/suspended/graduated.

Source: `person` table lines 149-158; `enrolment.status_code` lines 231-249; modification table line 1049.

Impact: There is still no clear state machine for person vs enrolment status, especially for prospective students, deceased students with active/historic enrolments, concurrent enrolments, and withdrawn/intermitting status.

Recommendation: Define a status model:

- person lifecycle status: prospective/applicant/student/alumnus/deceased/merged;
- enrolment lifecycle status: enrolled/intermitting/withdrawn/suspended/graduated;
- derived display status rules for UI/search.

### DM2-011 — Medium — Programme/catalogue remediation is incomplete

The base `programme` table still lacks `awarding_body_id`, owning school, and credit framework; these only appear in the modifications table. There is an `awarding_body` entity, but no actual FK in the table definition. There is also no structured `assessment_pattern` entity, only a suggested `module.assessment_pattern_description`.

Source: `programme` table lines 181-194; `awarding_body` lines 551-558; modifications lines 1049-1052.

Impact: Catalogue requirements are partly satisfied conceptually but not as a coherent physical/logical model.

Recommendation: Update the entity tables directly and add `assessment_pattern` rather than a free-text description if rules, boards, or HESA extracts depend on it.

### DM2-012 — Medium — Generated artefacts need storage/reference strategy

Entities like `exam_board_data_pack`, `exam_board_candidate_profile`, `hesa_return`, and `student_document` capture metadata and sometimes JSON snapshots, but the document does not say where the actual generated artefact lives, how it is hashed, or how integrity is verified.

Source: board pack lines 755-775; HESA return lines 841-853; student document lines 1029-1039.

Impact: Regulatory and board artefacts may not be reproducible or provably unchanged. This matters for audit, DSAR, appeals, HESA amendments, and certificate/transcript issuance.

Recommendation: Add columns such as `artefact_uri`, `content_hash`, `format_code`, `schema_version`, `generated_by_actor_id`, and `retention_class_code` where applicable.

### DM2-013 — Medium — Integration exchange state is inconsistent across domains

Some external exchanges have explicit records (`ucas_exchange_record`, `slc_notification`, HESA submission); others do not. For example OIV has request/outcome data but no exchange attempt state, Finance payments have no inbound exchange metadata beyond payment reference, EDRMS archival is on `student_document`, and IAM account updates have no table despite IAM-002.

Source examples: OIV lines 508-520; Finance lines 608-619; student document lines 1029-1039; no IAM account-state table.

Impact: Failure handling, idempotency, replay, and reconciliation are uneven across integrations.

Recommendation: Introduce a generic `integration_exchange` / `integration_message` table, or define per-contract exchange records for every mutating inbound/outbound integration.

### DM2-014 — Low — Naming conventions conflict with examples and table headings

The naming convention says table names are plural nouns, but all entity headings and examples use singular names such as `person`, `programme`, `module`, `enrolment`, and `student_application`.

Source: entity headings throughout; naming convention line 1064.

Impact: Small but annoying: it will cause schema churn or inconsistent Drizzle naming when implementation starts.

Recommendation: Choose singular or plural table names now. The current document reads as singular; update the convention if that is intended.

### DM2-015 — Low — `created_at` and `recorded_at` meanings overlap

Several bitemporal and append-only entities mix domain timestamps, `created_at`, and `recorded_at` semantics. For example `adjustment_distribution` has `created_at`, while bitemporal entities get `recorded_at`; `attendance_record` uses `recorded_at` as the attendance-source timestamp, which collides semantically with transaction time naming.

Source: bitemporal `recorded_at` definition lines 24-29; `adjustment_distribution.created_at` line 376; `attendance_record.recorded_at` line 683.

Impact: This will confuse audit and bitemporal query semantics.

Recommendation: Reserve `recorded_at` for transaction time. Use `observed_at`, `source_recorded_at`, `received_at`, or `created_at` for domain/source timestamps.

## Positive Changes Since Pass 1

- `reasonable_adjustment` no longer stores one timestamp per downstream system; `adjustment_distribution` was added.
- `exceptional_circumstances` and `misconduct_outcome` are now bitemporal.
- Admissions, identity verification, disability declarations, fee liability, timetable, attendance, exams, board packs, appeals, statutory exchange state, staff assignments, research milestones, risk flags, data quality, and student documents are now represented.
- Functional requirements now include the previously missing SIS-facing flows F006, F019, F020, F041, F042, F043, and F044, and explicitly mark F055-F058 as out of scope/reference context.

## Recommended Next Step

Before Phase 3 DDL work, convert this document from a conceptual list into a schema-ready logical model:

1. Decide bitemporal primary key/versioning pattern.
2. Inline all "Modifications to Existing Entities" into entity tables.
3. Update the ERD or split it into generated domain ERDs.
4. Resolve polymorphic references.
5. Add integration exchange-state strategy.
6. Add data classification and artefact storage metadata.
