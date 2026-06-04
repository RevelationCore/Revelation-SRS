# Requirements to Architecture Traceability Remediation

> Status: Draft for review
> Scope: Functional requirements, data model, API standards, workflow catalogue, event taxonomy, and adapter coverage.

## Summary

Phase 1 captures a broad and mostly appropriate functional scope. Phase 2 establishes architectural patterns, but it does not yet trace every Must Have requirement into concrete data entities, events, APIs, workflows, and adapter contracts. This document identifies the remediation needed to make Phase 2 implementation-ready.

## Traceability Rule

Every Must Have requirement should have, where applicable:

| Trace Target | Question |
|---|---|
| Data entity | Where is the authoritative fact stored? |
| API endpoint | How is the fact created, read, corrected, or actioned? |
| Domain event | What event is emitted when the fact changes? |
| Workflow | Which durable process governs long-running decisions? |
| Integration contract | Which external actor sends or receives the fact? |
| Audit/temporal model | Can the institution reconstruct who knew what, when, and why? |

## Missing or Weak Traceability

### Student identity and admissions

| Requirement | Gap | Remediation |
|---|---|---|
| SID-005, SID-006 | No identity verification request/outcome entity. | Add `identity_verification_check` with status, confidence, fraud flag, source request/response references, valid/recorded time, and OIV integration state. |
| SID-008 | Disability declarations are required but not modelled separately from Wellbeing outcomes. | Add `disability_declaration` as a bitemporal SRS-held declaration record, distinct from approved adjustment plans. |
| UCR-001 to UCR-004 | UCAS application, offer, acceptance, deferral, no-show, and clearing state are not represented. | Add admissions/application entities and UCAS exchange state. Link W001 to these records. |
| ENR-004 | UCAS withdrawal/deferral/no-show outbound notifications have no event or exchange-state model. | Add UCAS outbound events and file/API exchange records. |

### Programme and module catalogue

| Requirement | Gap | Remediation |
|---|---|---|
| CAT-001 | Programme lacks awarding body and detailed credit framework. | Add awarding body, owning school/faculty, programme route/pathway, credit framework, and award targets. |
| CAT-002, ASS-008 | Assessment structures are represented at `module_offering`, but catalogue-level assessment patterns are not clearly versioned. | Distinguish module catalogue assessment pattern from delivery-year assessment components. |
| CAT-003 | Prerequisite and co-requisite relationships are missing. | Add `module_relationship` or `module_requirement` with relationship type and effective dating. |
| CAT-004 | Learning outcomes are missing. | Add programme/module learning outcome entities with versioning and mapping to assessment where needed. |

### Enrolment, finance, and status

| Requirement | Gap | Remediation |
|---|---|---|
| ENR-003, FIN-001, FIN-002 | Fee amount, fee liability, payment confirmations, and financial holds are not modelled beyond a fee band/funding source on enrolment. | Add `fee_liability`, `payment_confirmation`, and `student_hold`, all bitemporal where status/effect changes over time. |
| ENR-008, W010 | Annual re-enrolment workflow has no persistent re-enrolment state. | Add `reenrolment_period` and `reenrolment_confirmation`. |
| ENR-010 | Concurrent enrolment policy is mentioned but no constraints are defined. | Add tenant/programme-level rule support and validation cases. |

### Timetabling, attendance, and exams

| Requirement | Gap | Remediation |
|---|---|---|
| REG-005 | Finalised timetable and room allocation data are required but not modelled. | Add `timetabled_activity` and `student_timetable_entry` or explicitly classify timetable data as externally referenced but not stored. |
| ATT-001 | Attendance records and absence alerts are required but not modelled. | Add `attendance_record`, `absence_alert`, and `engagement_summary`, with UKVI-relevant fields. |
| GOV-008, GOV-009 | Exam entries, accommodations, candidate numbers, seating plans, and final exam timetables are not modelled. | Add `exam_entry`, `exam_timetable_entry`, `exam_candidate`, and `exam_accommodation_distribution`. |

### Assessment, boards, appeals, and records

| Requirement | Gap | Remediation |
|---|---|---|
| GOV-001 | Board data pack content is not represented as a generated artefact with snapshot/reconstruction semantics. | Add `exam_board_data_pack` and `exam_board_candidate_profile` with generated-at, source transaction-time, and publication state. |
| GOV-005 | Board member attendance and external examiner sign-off are under-modelled. | Add `exam_board_member_attendance` and `external_examiner_signoff`. |
| GOV-007, W006 | Appeals/corrections have workflow states but no domain data model. | Add `appeal_case` or `post_ratification_correction` linked to amended entities and audit records. |
| ACI-001 to ACI-004 | Misconduct outcome exists, but case context, submission context, and external exchange state are minimal. | Add source case metadata, affected assessment/module scope, penalty effect, and AI integration exchange records. |

### Wellbeing, EC, and adjustments

| Requirement | Gap | Remediation |
|---|---|---|
| ADJ-001 to ADJ-006 | Adjustment outcome exists, but distribution state is encoded as three timestamp columns. | Replace with `adjustment_distribution` rows per target system, status, attempt count, last error, and contract version. |
| EXC-001 to EXC-004 | Exceptional circumstances are not bitemporal despite the requirement to preserve board-relevant outcomes and corrections. | Make `exceptional_circumstance` bitemporal, add assessment/component scope, outcome reason, expiry/effective period, and board surfacing history. |

### Regulatory compliance

| Requirement | Gap | Remediation |
|---|---|---|
| HES-001 to HES-005 | HESA return, validation reports, amendments, and submitted deltas are not modelled. | Add `hesa_return`, `hesa_submission`, `hesa_validation_issue`, and `hesa_identifier_assignment`. |
| SLC-001 to SLC-003 | SLC inbound and outbound exchange state is not modelled. | Add `slc_notification`, `slc_entitlement`, `slc_payment_status`, and `slc_overpayment_notice`. |
| UKV-001 to UKV-005 | CAS, visa status, sponsor alerts, and inspection evidence are not modelled. | Add `cas_request`, `cas_assignment`, `visa_status`, `ukvi_compliance_case`, and `sponsor_evidence_record`. |
| OFS-001 to OFS-005 | OfS, APP, Prevent, FOI, and CMA support are high-level only. | Add reporting extract definitions, disclosure workflow records, and policy/course publication notification records where in scope. |

### Enterprise integrations

| Requirement | Gap | Remediation |
|---|---|---|
| LIB-002 | Library obligations are not modelled. | Add generic `student_obligation` or library-specific obligation records. |
| IAM-002 | Credential updates, account locks, and role assignments are not modelled as inbound integration facts. | Add `account_access_state` or IAM exchange records. |
| EDR-001, EDR-002 | Official document archive state and access logs are not modelled. | Add `student_document`, `document_archive_confirmation`, and optional `document_access_log_reference`. |
| ANA-002, ANA-004 | BI risk flags and DW reconciliation alerts are not modelled. | Add `student_risk_flag` and `data_quality_issue`. |
| HRP-002, PRG-007 | Tutor/supervisor assignments and PGR milestones are not modelled. | Add `staff_assignment` and `research_milestone`. |

## Reference Flows Not Covered in Functional Requirements

The following published reference flows are absent from `functional-requirements.md`:

| Flow | Direction | Recommendation |
|---|---|---|
| F006 | SIS -> CRM | Add CRM enrolment/progression update requirement, or mark explicitly out of scope. |
| F019 | SIS -> EST | Add Estates occupancy/forecast outbound integration, or mark out of scope. |
| F020 | EST -> SIS | Add Estates room availability/allocation inbound integration, or mark out of scope. |
| F041 | SIS -> CMS | Add CMS cohort/programme personalisation integration, or mark out of scope. |
| F042 | CMS -> SIS | Add policy/regulatory publication notification requirement, or mark out of scope. |
| F043 | SIS -> ITSM | Add ITSM incident-context outbound integration, or mark out of scope. |
| F044 | ITSM -> SIS | Add ITSM service outcome/account-status inbound integration, or mark out of scope. |
| F055 | VLE -> BI | Mark as non-SIS-facing reference context unless SRS brokers the flow. |
| F056 | AM -> BI | Mark as non-SIS-facing reference context unless SRS brokers the flow. |
| F057 | DW -> BI | Mark as non-SIS-facing reference context unless SRS brokers the flow. |

## Acceptance Criteria for Remediation

- Every Must Have requirement has a trace row to data/API/event/workflow/integration where applicable.
- Every omitted reference flow has an explicit exclusion rationale.
- Every external system actor has a named contract, owner, direction, pattern, and failure/replay strategy.
- Workflow event names exactly match domain event subjects or explicitly describe internal workflow state only.
- No Phase 3 platform primitive is implemented against an incomplete contract assumption.
