# Domain Event Taxonomy Remediation

> Status: Draft for review
> Scope: Additions and corrections required for `docs/architecture/domain-events.md`.

## Summary

The Phase 2 event taxonomy covers the central academic lifecycle, but it is not complete enough to support all Must Have integration requirements or the workflow catalogue. This document defines required corrections and additions.

## Naming Corrections

Use fully qualified subject names consistently across all documents.

| Current reference | Problem | Correct subject |
|---|---|---|
| `student.enrolled` in workflow catalogue | Missing `srs.` prefix. | `srs.student.enrolled` |
| `adjustment.approved` in workflow catalogue | Missing `srs.` prefix. | `srs.adjustment.approved` |
| `exceptional-circumstances.approved` in workflow catalogue | Not present in taxonomy. | Use `srs.exceptional-circumstances.flagged` or rename taxonomy to `srs.exceptional-circumstances.approved`. |
| `exam-board.ratified` in workflow catalogue | Missing `srs.` prefix. | `srs.exam-board.ratified` |
| `record.amended-post-ratification` in workflow catalogue | Missing `srs.` prefix. | `srs.record.amended-post-ratification` |
| `student.withdrawn` / `student.intermission-started` | Not present in taxonomy. | Use `srs.student.status-changed`, or add explicit lifecycle events and update consumers. |

Recommendation: Prefer the generic `srs.student.status-changed` for withdrawn/intermission/suspension/graduated transitions unless a downstream contract requires event-specific subjects.

## Required Event Groups

### Catalogue events

| Subject | Trigger | Primary consumers |
|---|---|---|
| `srs.catalogue.programme-updated` | Programme created or version changed. | EWP, VLE, TTB, CMS, BI, DW |
| `srs.catalogue.module-updated` | Module created or version changed. | EWP, VLE, TTB, SETS, BI, DW |
| `srs.catalogue.module-relationship-updated` | Prerequisite/co-requisite changed. | EWP, enrolment module registration service |
| `srs.catalogue.learning-outcome-updated` | Learning outcome changed. | EWP, CM, quality/governance tooling |

### Admissions and identity events

| Subject | Trigger | Primary consumers |
|---|---|---|
| `srs.admissions.application-received` | Application ingested from UCAS/CRM/direct. | CRM, Registry workflow |
| `srs.admissions.offer-accepted` | Offer accepted and enrolment workflow can proceed. | Registry, Finance, IAM |
| `srs.identity.verification-requested` | OIV request initiated. | OIV adapter |
| `srs.identity.verification-completed` | OIV outcome received and stored. | Registry, IAM, compliance |
| `srs.student.disability-declaration-updated` | Student declaration status changed. | Wellbeing |

### Enrolment, finance, and holds

| Subject | Trigger | Primary consumers |
|---|---|---|
| `srs.enrolment.fee-liability-created` | Fee liability first calculated. | Finance, SLC |
| `srs.enrolment.fee-liability-updated` | Liability changes due to status/intensity change. | Finance, SLC |
| `srs.finance.payment-confirmed` | Payment confirmation received from Finance. | EWP, Registry |
| `srs.student.hold-applied` | Financial/library/compliance hold applied. | EWP, Registry, IAM |
| `srs.student.hold-released` | Hold removed or expired. | EWP, Registry, IAM |

### Timetable, attendance, and exams

| Subject | Trigger | Primary consumers |
|---|---|---|
| `srs.timetable.published` | Finalised timetable received from TTB. | EWP, AM, VLE |
| `srs.attendance.record-received` | Attendance record received. | Registry, UKVI compliance, BI/DW |
| `srs.attendance.absence-alert-raised` | Absence alert received or generated. | Personal tutor, Registry, UKVI compliance |
| `srs.exam.entry-created` | Exam entry sent to EXAMS. | EXAMS |
| `srs.exam.timetable-published` | Final exam timetable/candidate number received. | EWP, Registry |
| `srs.exam.accommodation-distributed` | Exam adjustment sent to EXAMS. | EXAMS, Registry |

### Assessment and governance additions

| Subject | Trigger | Primary consumers |
|---|---|---|
| `srs.assessment.resit-recorded` | Resit mark or attempt recorded. | EWP, board tooling |
| `srs.exam-board.data-pack-superseded` | Board pack regenerated after source correction. | Registry, board members |
| `srs.exam-board.external-examiner-signed-off` | External examiner confirmation received. | Exam Board workflow |
| `srs.appeal.submitted` | Appeal/correction workflow started. | Registry |
| `srs.appeal.resolved` | Appeal dismissed/upheld and closed. | EWP, Registry, DW |

### Adjustment, EC, and misconduct additions

| Subject | Trigger | Primary consumers |
|---|---|---|
| `srs.adjustment.distribution-failed` | Downstream adjustment distribution failed after retry. | Integration dashboard, Registry |
| `srs.exceptional-circumstances.updated` | EC flag corrected or superseded. | Exam Board tooling |
| `srs.misconduct.outcome-updated` | Misconduct outcome corrected pre-board or by appeal. | EWP, Exam Board tooling, DW |

### Regulatory events

| Subject | Trigger | Primary consumers |
|---|---|---|
| `srs.regulatory.ucas-application-received` | UCAS application imported. | Admissions workflow |
| `srs.regulatory.ucas-withdrawal-notified` | UCAS withdrawal/deferral/no-show sent. | Audit/compliance |
| `srs.regulatory.hesa-return-generated` | HESA return generated for review. | Registry |
| `srs.regulatory.hesa-validation-report-received` | Validation report imported. | Registry |
| `srs.regulatory.hesa-return-amended` | Submitted return amended. | Registry, audit |
| `srs.regulatory.slc-entitlement-received` | Loan entitlement received. | Finance, Registry |
| `srs.regulatory.slc-payment-status-received` | Payment status received. | Finance, EWP |
| `srs.regulatory.slc-overpayment-notified` | Overpayment notice received. | Finance, Registry |
| `srs.regulatory.ukvi-visa-status-updated` | Visa grant/refusal/curtailment received. | Registry, UKVI compliance |
| `srs.regulatory.ukvi-sponsor-action-reported` | Sponsor report sent. | Registry, audit |

### Enterprise integration events

| Subject | Trigger | Primary consumers |
|---|---|---|
| `srs.iam.account-state-received` | IAM account lock/credential status received. | Registry, EWP |
| `srs.edrms.document-archived` | EDRMS archive confirmation received. | Registry, DPO |
| `srs.bi.risk-flag-received` | BI at-risk flag received. | Personal tutor, Registry, Wellbeing where lawful |
| `srs.data-quality.issue-received` | DW reconciliation/data quality issue received. | Data administrators |
| `srs.staff-assignment.updated` | Tutor/supervisor assignment received from HR. | EWP, Registry |
| `srs.research.milestone-recorded` | CRIS milestone received. | PGR student, supervisor, Registry |

## Event Envelope Remediation

The event envelope should add or clarify:

| Field | Reason |
|---|---|
| `schemaRef` | Allows consumers to resolve exact JSON Schema. |
| `idempotencyKey` | Required for safe retry and duplicate suppression. |
| `causationId` | Distinguishes original command/event from correlation chain. |
| `dataClassification` | Helps consumers enforce special-category and sensitive-data handling. |
| `validAt` | Useful for bitemporal facts whose effective date differs from publish time. |

## Retention and Replay

The current 7-day retention on many streams should be paired with a documented replay strategy. For each event group, define:

- Minimum broker retention.
- Whether consumers can request event replay.
- Snapshot API for backfill.
- Incremental export endpoint or file.
- Manual reconciliation workflow for failed or missed events.

## Acceptance Criteria

- Workflow catalogue and event taxonomy use the same subject names.
- Every outbound event has at least one named consumer or is marked internal.
- Every integration contract has either an event, REST endpoint, file format, or explicit no-event rationale.
- Events carrying sensitive data declare classification and minimised payload fields.
