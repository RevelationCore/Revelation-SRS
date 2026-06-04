# Data Model Remediation

> Status: Draft for review
> Scope: Entities and modelling rules missing from `docs/architecture/data-model.md`.

## Summary

The Phase 2 data model defines the core academic spine, but it does not yet cover several Must Have requirements, statutory exchange states, or operational integration facts. This document lists the model additions required before Phase 3 database foundation work should be treated as complete.

## Modelling Principles to Apply

1. Bitemporal storage applies to facts that change over time, including integration-derived statuses and operational holds.
2. Integration exchange state is part of the system of record where it affects student status, access, compliance, fees, or published outcomes.
3. Case/process records should be distinct from confirmed outcomes. For example, Wellbeing owns adjustment case management, but SRS stores approved adjustment outcomes and distribution state.
4. Generated artefacts such as board packs, HESA returns, transcripts, and certificates need reproducibility metadata: generation time, source transaction time, version, and approving actor.
5. One timestamp column per downstream target is not sufficient for robust integrations. Use child rows for distribution attempts and target statuses.

## Required Entity Additions

### Identity and admissions

| Entity | Purpose | Temporal |
|---|---|---|
| `student_application` | UCAS/direct/CRM application, source references, cycle, programme applied for. | Bitemporal where status changes. |
| `admissions_offer` | Offer type, conditions, deadlines, acceptance/decline state. | Bitemporal. |
| `identity_verification_check` | OIV request/outcome, confidence score, fraud flag, evidence reference. | Bitemporal or append-only versioned. |
| `disability_declaration` | Student-declared disability status and declaration lifecycle. | Bitemporal, special category. |
| `student_address` | Address history separate from identity core. | Bitemporal. |
| `student_contact_method` | Email/phone/contact preference history. | Bitemporal. |

### Catalogue and curriculum

| Entity | Purpose | Temporal |
|---|---|---|
| `awarding_body` | Awarding body for programmes and qualifications. | Slowly changing. |
| `programme_route` | Route/pathway/specialism within programme. | Bitemporal. |
| `module_relationship` | Prerequisite/co-requisite/exclusion relationships. | Bitemporal. |
| `learning_outcome` | Programme/module learning outcomes. | Bitemporal. |
| `assessment_pattern` | Catalogue-level assessment structure before delivery instance. | Bitemporal. |
| `programme_rule_set` | Link programme/cohort to progression/classification rules. | Bitemporal. |

### Enrolment, fees, and holds

| Entity | Purpose | Temporal |
|---|---|---|
| `fee_liability` | Fee amount, liability period, fee status, funding source, sponsor. | Bitemporal. |
| `payment_confirmation` | Finance/SLC payment confirmation and allocation. | Append-only or bitemporal corrections. |
| `student_hold` | Financial, library, compliance, disciplinary, or document hold. | Bitemporal. |
| `reenrolment_period` | Tenant/programme re-enrolment window. | Bitemporal. |
| `reenrolment_confirmation` | Student annual confirmation and outstanding actions. | Bitemporal. |

### Timetable, attendance, and engagement

| Entity | Purpose | Temporal |
|---|---|---|
| `timetabled_activity` | TTB activity, module offering, room, time, staff where supplied. | Bitemporal or versioned by publication. |
| `student_timetable_entry` | Student-specific timetable visibility where stored. | Bitemporal. |
| `attendance_record` | Attendance events from AM. | Append-only with correction support. |
| `absence_alert` | Absence/engagement alerts and resolution state. | Bitemporal. |
| `engagement_summary` | Consolidated engagement record, including UKVI-relevant indicators. | Bitemporal snapshots. |

### Assessment and board governance

| Entity | Purpose | Temporal |
|---|---|---|
| `assessment_submission` | Submission context for VLE/AI, if SRS stores it. | Bitemporal or append-only. |
| `exam_board_data_pack` | Generated pack metadata, source transaction time, version, publication state. | Append-only versions. |
| `exam_board_candidate_profile` | Per-student board snapshot. | Append-only versions. |
| `exam_board_member_attendance` | Board member attendance and role. | Append-only. |
| `external_examiner_signoff` | Confirmation, comments, sign-off time. | Append-only. |
| `post_ratification_case` | Appeal/correction case summary linked to workflow. | Bitemporal status. |
| `post_ratification_amendment` | Authorised amendment to locked records. | Append-only. |

### Wellbeing, EC, and misconduct outcomes

| Entity | Purpose | Temporal |
|---|---|---|
| `adjustment_distribution` | One row per adjustment target system, status, attempts, contract version. | Bitemporal status or append-only attempts. |
| `exceptional_circumstance` | Make existing EC entity bitemporal and add effective/scope fields. | Bitemporal. |
| `exceptional_circumstance_board_visibility` | Tracks when EC was included in board pack. | Append-only. |
| `misconduct_case_reference` | External AI case metadata and affected scope. | Bitemporal status. |
| `misconduct_penalty_effect` | How the penalty changes mark/module/progression outcome. | Bitemporal. |

### Exams

| Entity | Purpose | Temporal |
|---|---|---|
| `exam_entry` | Student exam entry sent to EXAMS. | Bitemporal. |
| `exam_candidate` | Candidate number and exam identity. | Bitemporal. |
| `exam_timetable_entry` | Final exam timetable, room, seat, publication status. | Bitemporal/versioned. |
| `exam_accommodation_distribution` | Exam-specific accommodation distribution and status. | Bitemporal/status history. |

### Regulatory exchange

| Entity | Purpose | Temporal |
|---|---|---|
| `ucas_exchange_record` | Application/confirmation/withdrawal/deferral/no-show exchange state. | Append-only with status. |
| `hesa_return` | Return year, scope, generated source time, status. | Append-only versions. |
| `hesa_submission` | Submission attempt, response, accepted/rejected state. | Append-only. |
| `hesa_validation_issue` | Validation errors/warnings and resolution state. | Bitemporal status. |
| `hesa_identifier_assignment` | HESA ID assignment and propagation state. | Bitemporal. |
| `slc_notification` | Enrolment/status notification sent to SLC. | Append-only. |
| `slc_entitlement` | Loan entitlement received. | Bitemporal. |
| `slc_payment_status` | Payment and overpayment state. | Bitemporal. |
| `cas_request` | CAS creation request and status. | Bitemporal status. |
| `cas_assignment` | CAS reference assigned and issued to student. | Bitemporal. |
| `visa_status` | Visa grants, refusals, curtailments. | Bitemporal. |
| `ukvi_compliance_case` | Sponsor compliance alert/review/reporting state. | Bitemporal status. |
| `sponsor_evidence_record` | Evidence retained for UKVI inspection. | Append-only. |

### Documents, reporting, and enterprise feedback

| Entity | Purpose | Temporal |
|---|---|---|
| `student_document` | Transcript, certificate, enrolment form metadata. | Append-only versions. |
| `document_archive_confirmation` | EDRMS archive ID/link/status. | Append-only. |
| `student_risk_flag` | BI at-risk flag and resolution state. | Bitemporal. |
| `data_quality_issue` | DW reconciliation/data quality feedback. | Bitemporal status. |
| `staff_assignment` | Personal tutor, supervisor, module tutor assignment. | Bitemporal. |
| `research_milestone` | PGR milestones from CRIS. | Bitemporal. |
| `policy_publication_notice` | CMS regulatory/policy notice requiring student-record annotation. | Append-only or bitemporal status. |
| `student_obligation` | Generic obligations from library/finance/compliance where useful. | Bitemporal. |

## Existing Entities Needing Changes

| Entity | Change |
|---|---|
| `person` | Consider whether status belongs on person or enrolment. SID-009 includes prospective/deceased statuses not represented by enrolment status. |
| `person_identity` | Split special-category fields or use column-level access carefully; ethnicity and disability declarations have different lawful bases and audiences. |
| `programme` | Add awarding body, owning school/faculty, route/pathway, credit framework. |
| `module` | Add assessment pattern link and learning outcomes. |
| `academic_period` | Consider bitemporal/versioned calendar changes. |
| `module_offering` | Consider bitemporal delivery changes and link to timetable demand. |
| `mark` | Add attempt number, submission reference, mark status, moderation state, and cap/penalty reason. |
| `award` | Consider bitemporal or append-only versioning for post-ratification corrections and certificate reissue. |
| `reasonable_adjustment` | Remove target-specific distribution timestamp columns in favour of `adjustment_distribution`. |
| `exceptional_circumstances` | Make bitemporal and add valid/effective period, affected assessment/component, outcome reason, and board visibility history. |
| `misconduct_outcome` | Add source case metadata and penalty effect modelling. |
| `integration_registration` | Extend as specified in `integration-contract-catalogue.md`. |

## Data Classification

The physical model should identify data classification at entity and field level:

| Class | Examples | Required controls |
|---|---|---|
| Standard personal data | Name, contact details, student number. | Tenant RLS, RBAC, audit on write. |
| Sensitive institutional data | Marks, progression, holds, risk flags. | Tenant RLS, scoped RBAC, audit on read where required. |
| Special category data | Disability, health, EC evidence references, ethnicity. | Restricted RBAC, read audit, data minimisation. |
| Regulatory data | HESA, SLC, UKVI, UCAS exchange state. | Retention policy, audit, replayable exchange history. |

## Acceptance Criteria

- Every Must Have requirement has an authoritative data home or explicit "not stored, externally referenced" rationale.
- Every integration that mutates SRS state has exchange-state persistence.
- Every outbound distribution of sensitive outcomes has per-target status and retry history.
- Every regulatory submission can be reconstructed from source data and submitted artefact versions.
- Every bitemporal entity has documented valid-time and transaction-time semantics.
