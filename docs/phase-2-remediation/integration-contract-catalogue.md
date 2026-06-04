# Integration Contract Catalogue Remediation

> Status: Draft for review
> Scope: External system actors, first-party modules, statutory bodies, and governance actors.

## Purpose

The Phase 2 integration architecture defines patterns, but it does not yet enumerate the contracts needed for every system actor and flow. This document provides the remediation catalogue that should be converted into versioned API, event, and file contracts.

## Contract Fields Required

Each integration contract should define:

| Field | Description |
|---|---|
| Contract ID | Stable identifier, e.g. `vle-course-provisioning.v1`. |
| Reference flows | F-numbers covered by the contract. |
| Direction | Inbound, outbound, or bidirectional from the SRS perspective. |
| Pattern | REST, event, file, or mixed. |
| Owner | Core domain module or adapter owner. |
| Payload | Domain entities or file records exchanged. |
| Trigger | Event, schedule, manual action, or inbound request. |
| Idempotency key | Key used to prevent duplicate processing. |
| Contract version | Semver for REST/event, year/spec version for statutory file formats. |
| Failure handling | Retry, dead-letter, reconciliation, and manual repair path. |
| Replay/backfill | How an adapter catches up after outage beyond event retention. |
| Security scope | Service account, RBAC permission, and data classification constraints. |

## Required Contracts by Actor

### Curriculum Management (`CM`)

| Contract | Flows | Direction | Pattern | Notes |
|---|---|---|---|---|
| `curriculum-catalogue-sync.v1` | F001 | Inbound | REST/file/event | Programme, module, learning outcome, prerequisite, assessment pattern, effective dates. |
| `curriculum-performance-metrics.v1` | F002 | Outbound | Event/file | Enrolment, completion, progression, and performance aggregates. |

### Timetabling (`TTB`)

| Contract | Flows | Direction | Pattern | Notes |
|---|---|---|---|---|
| `timetable-demand-feed.v1` | F003 | Outbound | Event/file | Student enrolments and confirmed module registrations. |
| `timetable-publication.v1` | F004 | Inbound | REST/file | Finalised timetable, room allocations, activity IDs, change notifications. |

### CRM (`CRM`)

| Contract | Flows | Direction | Pattern | Notes |
|---|---|---|---|---|
| `crm-admissions-feed.v1` | F005 | Inbound | REST/file | Applicant, offer, acceptance, admissions decision data. |
| `crm-student-lifecycle-updates.v1` | F006 | Outbound | Event | Enrolment status, progression, award, withdrawal/intermission. Missing from Phase 1 requirements. |
| `crm-portal-communications.v1` | F058 | Context | External | CRM to EWP flow. Decide whether SRS stores or brokers communications. |

### Finance (`FIN`)

| Contract | Flows | Direction | Pattern | Notes |
|---|---|---|---|---|
| `finance-fee-liability.v1` | F009 | Outbound | Event/file | Fee amount, liability period, sponsor/funding source, changes. |
| `finance-payment-and-hold.v1` | F010 | Inbound | REST/event/file | Payment confirmation, financial hold status, hold release. |

### Library (`LIB`)

| Contract | Flows | Direction | Pattern | Notes |
|---|---|---|---|---|
| `library-access-entitlement.v1` | F008 | Outbound | Event | Enrolment status and access rights. |
| `library-obligations.v1` | F007 | Inbound | REST/event/file | Loans, fines, overdue obligations. Should map to student obligations. |

### Enterprise Web Portal (`EWP`)

| Contract | Flows | Direction | Pattern | Notes |
|---|---|---|---|---|
| `portal-student-record-read.v1` | F012 | Outbound/read | REST | Authoritative student data, grades, timetable, exam info, notifications. |
| `portal-self-service-update.v1` | F011 | Inbound | REST | Personal data, module selection, declarations, re-enrolment. |

### Attendance Monitoring (`AM`)

| Contract | Flows | Direction | Pattern | Notes |
|---|---|---|---|---|
| `attendance-roster-feed.v1` | F014 | Outbound | Event/file | Rosters and academic calendar. |
| `attendance-records-alerts.v1` | F013 | Inbound | REST/event/file | Attendance records, absence alerts, UKVI-relevant engagement facts. |
| `attendance-adjustments.v1` | F060 | Outbound | Event | Approved attendance adjustment outcomes from SIS only. |
| `attendance-bi-feed.v1` | F056 | Context | External | Non-SIS-facing AM to BI reference flow. |

### Virtual Learning Environment (`VLE`)

| Contract | Flows | Direction | Pattern | Notes |
|---|---|---|---|---|
| `vle-course-provisioning.v1` | F015 | Outbound | Event | Enrolment, module registrations, term dates. |
| `vle-assessment-results.v1` | F016 | Inbound | REST/event | Marks, completion status, academic alerts. |
| `vle-adjustments.v1` | F059 | Outbound | Event | Approved adjustments from SIS only. |
| `vle-learning-analytics.v1` | F055 | Context | External | Non-SIS-facing VLE to BI reference flow unless SRS stores analytics. |

### Accommodation and Estates (`ACC`, `EST`)

| Contract | Flows | Direction | Pattern | Notes |
|---|---|---|---|---|
| `accommodation-eligibility.v1` | F017 | Outbound | Event/file | Student profile, status, programme details. |
| `accommodation-booking-status.v1` | F018 | Inbound | REST/event/file | Room allocation, booking, check-in/out. |
| `estates-occupancy-forecast.v1` | F019 | Outbound | File/event | Missing from Phase 1 requirements. |
| `estates-room-availability.v1` | F020 | Inbound | REST/file | Missing from Phase 1 requirements. |

### IAM (`IAM`)

| Contract | Flows | Direction | Pattern | Notes |
|---|---|---|---|---|
| `iam-account-provisioning.v1` | F021 | Outbound | Event/REST | Identity, status, access eligibility. |
| `iam-account-state.v1` | F022 | Inbound | REST/event | Credential updates, account locks, role assignments. Must not silently overwrite SRS role decisions. |

### EDRMS (`EDRMS`)

| Contract | Flows | Direction | Pattern | Notes |
|---|---|---|---|---|
| `document-archive-submission.v1` | F023 | Outbound | REST/file | Enrolment forms, transcripts, certificates. |
| `document-archive-confirmation.v1` | F024 | Inbound | REST/event | Archive confirmations, document links, access logs. |

### Online ID Verification (`OIV`)

| Contract | Flows | Direction | Pattern | Notes |
|---|---|---|---|---|
| `identity-verification-request.v1` | F025 | Outbound | REST | Student identity data and verification request. |
| `identity-verification-outcome.v1` | F026 | Inbound | REST/webhook | Verification status, confidence score, fraud flag. |

### BI and Data Warehouse (`BI`, `DW`)

| Contract | Flows | Direction | Pattern | Notes |
|---|---|---|---|---|
| `bi-student-performance-feed.v1` | F027 | Outbound | File/event/API | Performance, enrolment, progression data. |
| `bi-risk-flags.v1` | F028 | Inbound | REST/event | At-risk flags and predictive intervention alerts. |
| `dw-student-extract.v1` | F029 | Outbound | File/event | Full and incremental extracts. |
| `dw-data-quality-feedback.v1` | F030 | Inbound | REST/event/file | Data quality reports and reconciliation alerts. |
| `dw-to-bi-context.v1` | F057 | Context | External | Non-SIS-facing reference flow. |

### SETS (`SETS`)

| Contract | Flows | Direction | Pattern | Notes |
|---|---|---|---|---|
| `sets-survey-roster.v1` | F031 | Outbound | File/event/API | Module rosters and registrations. |
| `sets-survey-summary.v1` | F032 | Inbound | REST/file | Completion rates and aggregate feedback only. |

### HR, Payroll, CRIS, and Research Proposals

| Contract | Flows | Direction | Pattern | Notes |
|---|---|---|---|---|
| `hr-student-staff-roles.v1` | F033 | Outbound | Event/file | GTA and student-staff role data. |
| `hr-staff-assignments.v1` | F034 | Inbound | REST/event/file | Tutor and supervisor assignments. |
| `payroll-student-pay-authorisation.v1` | F035 | Outbound | File/API | Bursary and GTA payment authorisation. |
| `payroll-payment-confirmation.v1` | F036 | Inbound | REST/file | Bursary/stipend payment confirmation. |
| `cris-pgr-profile.v1` | F037 | Outbound | REST/event | PGR enrolment and researcher profile. |
| `cris-pgr-milestones.v1` | F038 | Inbound | REST/event | Research milestones and publications. |
| `research-proposal-eligibility.v1` | F039 | Outbound | REST/API | Eligibility and supervisor assignment data. |
| `research-studentship-award.v1` | F040 | Inbound | REST/API | Funded studentship award records. |

### CMS and ITSM

| Contract | Flows | Direction | Pattern | Notes |
|---|---|---|---|---|
| `cms-cohort-personalisation.v1` | F041 | Outbound | API/event | Missing from Phase 1 requirements. |
| `cms-policy-publication.v1` | F042 | Inbound | REST/event | Missing from Phase 1 requirements; may support CMA/FOI/regulatory notifications. |
| `itsm-student-context.v1` | F043 | Outbound | API | Missing from Phase 1 requirements. |
| `itsm-account-impact.v1` | F044 | Inbound | REST/event | Missing from Phase 1 requirements. |

### Statutory Actors

| Contract | Flows | Direction | Pattern | Notes |
|---|---|---|---|---|
| `ucas-admissions-exchange.{cycle}` | F045, F046 | Bidirectional | File/API | Applications, offers, clearing, enrolment confirmation, withdrawal/deferral/no-show. |
| `hesa-student-return.{year}` | F047, F048 | Bidirectional | File | Return generation, validation report, HESA IDs, amendments. |
| `slc-enrolment-exchange.v1` | F049, F050 | Bidirectional | File/API | Enrolment confirmation, status changes, loan entitlement, payments, overpayments. |
| `ukvi-sponsor-compliance.v1` | F051, F052 | Bidirectional | API/file | CAS requests, attendance compliance, visa status, sponsor alerts. |

### Wellbeing and Disability (`WELL`)

| Contract | Flows | Direction | Pattern | Notes |
|---|---|---|---|---|
| `wellbeing-student-context.v1` | F053 | Outbound/read | REST/event | Student profiles, disability declarations, academic records. |
| `wellbeing-adjustment-outcome.v1` | F063 | Inbound | Internal REST | Approved adjustments only; SIS distributes downstream. |
| `wellbeing-exceptional-circumstance-outcome.v1` | F066 | Inbound | Internal REST | Approved EC outcomes only; SIS surfaces in boards. |

### Exams, Governance, and Academic Integrity

| Contract | Flows | Direction | Pattern | Notes |
|---|---|---|---|---|
| `exam-scheduling-entries.v1` | F061 | Outbound | Event/file | Exam entries, registrations, accommodations. |
| `exam-scheduling-publication.v1` | F062 | Inbound | REST/file | Exam timetable, seating plans, candidate numbers. |
| `exam-board-data-pack.v1` | F064 | Human/governance | REST/UI | Secure board pack, not a system adapter unless external board tooling exists. |
| `exam-board-ratification.v1` | F065 | Human/governance | REST/UI/workflow | Ratified decisions and record locking. |
| `external-examiner-review.v1` | F067, F068 | Human/governance | REST/UI/workflow | Sample access, profiles, confirmation. |
| `academic-integrity-context.v1` | F070 | Outbound | REST/event | Student, module registration, submission context. |
| `academic-integrity-outcome.v1` | F069 | Inbound | REST/event | Confirmed outcomes and penalties. |

## Plugin Registry Remediation

The `integration_registration` table should be extended to support these contracts:

| Field | Purpose |
|---|---|
| `contract_id` | Stable logical contract identifier. |
| `direction_code` | `inbound`, `outbound`, `bidirectional`, `context`. |
| `owner_module_code` | Core module responsible for handling the contract. |
| `subject_filter` | Event subject filter for event consumers. |
| `consumer_group` | NATS durable consumer group where applicable. |
| `endpoint_url` | External REST endpoint where applicable. |
| `file_schedule` | Cron/manual schedule for file exchange. |
| `transport_code` | `rest`, `event`, `sftp`, `https-file`, etc. |
| `secret_ref` | Reference to OpenBao secret, never the secret value. |
| `last_successful_exchange_at` | Health and reconciliation signal. |
| `replay_supported` | Whether backfill can be requested. |
| `retry_policy` | JSONB policy for retry, dead-letter, and escalation. |

## Replay and Reconciliation

Event retention alone is not enough for enterprise integrations. Every outbound contract must define one of:

- Event replay within broker retention.
- Snapshot API with `validAt` / `recordedAt`.
- Full export file.
- Incremental export from a high-water mark.
- Manual reconciliation workflow.
