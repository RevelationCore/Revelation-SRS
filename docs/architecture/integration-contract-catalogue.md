# Integration Contract Catalogue

> Status: Draft — Phase 2 remediation
> Last updated: 2026-06-04
> This catalogue enumerates every integration contract between Revelation SRS and external systems or first-party modules. Each contract maps to one or more reference model flows, defines direction, pattern, owner, payload, failure handling, and replay strategy.

---

## Contract Fields

| Field | Description |
|---|---|
| **Contract ID** | Stable logical identifier, e.g. `vle-course-provisioning.v1` |
| **Flows** | Reference model flows covered |
| **Direction** | From the SRS perspective: `inbound` / `outbound` / `bidirectional` / `context` (non-SIS-facing) |
| **Pattern** | `rest` / `event` / `file` / `mixed` |
| **Owner module** | SRS core module responsible for the contract |
| **Trigger** | What initiates the exchange |
| **Failure handling** | Retry, dead-letter, alert, and manual repair path |
| **Replay / backfill** | How an adapter catches up after an outage beyond event retention |
| **Idempotency key** | Key used to prevent duplicate processing |

---

## Curriculum Management

| Field | Value |
|---|---|
| **Contract ID** | `curriculum-catalogue-sync.v1` |
| **Flows** | F001 |
| **Direction** | Inbound |
| **Pattern** | REST or file (institution choice) |
| **Owner module** | Enrolment & Registration |
| **Trigger** | CM pushes catalogue update or SRS polls on schedule |
| **Payload** | Programme, module, learning outcome, prerequisite, assessment pattern, effective dates |
| **Failure handling** | Rejected if validation fails; error logged and alerted; original catalogue version retained |
| **Replay** | CM resends full catalogue snapshot; SRS applies as new bitemporal version |
| **Idempotency key** | `{moduleCode}-{effectiveFrom}` or CM-provided version hash |

| Field | Value |
|---|---|
| **Contract ID** | `curriculum-performance-metrics.v1` |
| **Flows** | F002 |
| **Direction** | Outbound |
| **Pattern** | Event / scheduled file |
| **Owner module** | Regulatory Compliance |
| **Trigger** | End of academic period or on-demand from CM |
| **Payload** | Enrolment counts, module completion rates, aggregate performance bands per programme |
| **Failure handling** | Dead-letter; CM retries or requests snapshot |
| **Replay** | Snapshot API: `GET /api/v1/reports/curriculum-metrics?periodId=&programmeId=` |

---

## Timetabling

| Field | Value |
|---|---|
| **Contract ID** | `timetable-demand-feed.v1` |
| **Flows** | F003 |
| **Direction** | Outbound |
| **Pattern** | Event (`srs.module-registration.created`) + scheduled file |
| **Owner module** | Enrolment & Registration |
| **Trigger** | Module registration confirmed; or scheduled extract at registration close |
| **Payload** | Student enrolments, confirmed module registrations, credit load, academic period |
| **Replay** | Snapshot: `GET /api/v1/module-registrations?periodId=&status=registered` |

| Field | Value |
|---|---|
| **Contract ID** | `timetable-publication.v1` |
| **Flows** | F004 |
| **Direction** | Inbound |
| **Pattern** | REST POST or file |
| **Owner module** | Enrolment & Registration |
| **Trigger** | TTB publishes finalised timetable |
| **Payload** | Activity IDs, room references, scheduled times, change indicators |
| **Failure handling** | Validation rejection; TTB resubmits; previous publication retained |
| **Idempotency key** | TTB publication version ID |

---

## CRM

| Field | Value |
|---|---|
| **Contract ID** | `crm-admissions-feed.v1` |
| **Flows** | F005 |
| **Direction** | Inbound |
| **Pattern** | REST or file |
| **Owner module** | Student Identity / Admissions workflow |
| **Trigger** | CRM pushes applicant, offer, and acceptance records |
| **Payload** | Applicant personal data, programme choice, offer type, acceptance status |
| **Failure handling** | Validation error returned; CRM corrects and resubmits |
| **Idempotency key** | CRM application reference |

| Field | Value |
|---|---|
| **Contract ID** | `crm-student-lifecycle-updates.v1` |
| **Flows** | F006 |
| **Direction** | Outbound |
| **Pattern** | Event (`srs.student.enrolled`, `srs.student.status-changed`, `srs.student.graduated`) |
| **Owner module** | Student Identity |
| **Trigger** | Significant enrolment status changes |
| **Payload** | `personId`, `enrolmentId`, `statusCode`, `effectiveDate`, `programmeCode` |
| **Replay** | Snapshot: `GET /api/v1/students?enrolmentStatus=&academicYear=` |

---

## Finance

| Field | Value |
|---|---|
| **Contract ID** | `finance-fee-liability.v1` |
| **Flows** | F009 |
| **Direction** | Outbound |
| **Pattern** | Event (`srs.enrolment.fee-liability-created`, `srs.enrolment.fee-liability-updated`) |
| **Owner module** | Enrolment & Registration |
| **Trigger** | Enrolment confirmed or intensity changed |
| **Payload** | `enrolmentId`, `feeLiabilityId`, `academicYear`, `feeAmount`, `fundingSource` |
| **Replay** | Snapshot: `GET /api/v1/enrolments/:id/fee-liabilities?academicYear=` |

| Field | Value |
|---|---|
| **Contract ID** | `finance-payment-and-hold.v1` |
| **Flows** | F010 |
| **Direction** | Inbound |
| **Pattern** | REST POST |
| **Owner module** | Enrolment & Registration |
| **Trigger** | Finance confirms payment or applies/releases financial hold |
| **Payload** | `enrolmentId`, `amount`, `paymentSource`, `paymentReference` / `holdTypeCode`, `appliedAt` |
| **Idempotency key** | Finance system payment reference |

---

## Library

| Field | Value |
|---|---|
| **Contract ID** | `library-access-entitlement.v1` |
| **Flows** | F008 |
| **Direction** | Outbound |
| **Pattern** | Event (`srs.student.enrolled`, `srs.student.status-changed`) |
| **Owner module** | Student Identity |
| **Payload** | `personId`, `studentNumber`, `enrolmentStatusCode`, `programmeCode` |
| **Replay** | Snapshot: `GET /api/v1/students/:id` |

| Field | Value |
|---|---|
| **Contract ID** | `library-obligations.v1` |
| **Flows** | F007 |
| **Direction** | Inbound |
| **Pattern** | REST POST |
| **Owner module** | Student Identity |
| **Trigger** | Library notifies of outstanding loans, fines, overdue items |
| **Payload** | `personId`, `obligationTypeCode`, `description`, `dueDate` |
| **Idempotency key** | Library item / fine reference |

---

## Enterprise Web Portal

| Field | Value |
|---|---|
| **Contract ID** | `portal-student-record-read.v1` |
| **Flows** | F012 |
| **Direction** | Outbound (read) |
| **Pattern** | REST GET |
| **Owner module** | All domain modules |
| **Trigger** | Student / staff navigates in portal |
| **Payload** | Enrolment status, module registrations, grades, timetable, exam timetable, adjustments, notifications |

| Field | Value |
|---|---|
| **Contract ID** | `portal-self-service-update.v1` |
| **Flows** | F011 |
| **Direction** | Inbound |
| **Pattern** | REST PATCH / POST |
| **Owner module** | Student Identity / Enrolment & Registration |
| **Trigger** | Student submits self-service update |
| **Payload** | Personal data changes, module selections, re-enrolment confirmation |
| **Idempotency key** | Portal session + operation reference |

---

## Attendance Monitoring

| Contract ID | Flows | Direction | Pattern | Owner | Notes |
|---|---|---|---|---|---|
| `attendance-roster-feed.v1` | F014 | Outbound | Event + file | Enrolment | Module rosters, academic calendar, adjustment distribution |
| `attendance-records-alerts.v1` | F013 | Inbound | REST / event | Student Identity | Attendance events and absence alerts; `ukviRelevant` flag required |
| `attendance-adjustments.v1` | F060 | Outbound | Event (`srs.adjustment.distributed`) | Assessment | Approved attendance adjustments from SIS only |

---

## Virtual Learning Environment

| Contract ID | Flows | Direction | Pattern | Owner | Notes |
|---|---|---|---|---|---|
| `vle-course-provisioning.v1` | F015 | Outbound | Event | Enrolment | `srs.student.enrolled`, `srs.module-registration.created`, `srs.student.status-changed` |
| `vle-assessment-results.v1` | F016 | Inbound | REST POST | Assessment | Marks, completion status, academic alerts; idempotency key = VLE submission reference |
| `vle-adjustments.v1` | F059 | Outbound | Event (`srs.adjustment.distributed`) | Assessment | Approved adjustments from SIS only; VLE must not receive directly from Wellbeing |

---

## Identity and Access Management

| Contract ID | Flows | Direction | Pattern | Owner | Notes |
|---|---|---|---|---|---|
| `iam-account-provisioning.v1` | F021 | Outbound | Event | Student Identity | `srs.student.enrolled`, `srs.student.status-changed`; triggers account create / update / deactivate |
| `iam-account-state.v1` | F022 | Inbound | REST / event | Student Identity | Credential updates, account locks, role assignments; must not overwrite SRS-owned RBAC decisions |

---

## Exam Scheduling

| Contract ID | Flows | Direction | Pattern | Owner | Notes |
|---|---|---|---|---|---|
| `exam-scheduling-entries.v1` | F061 | Outbound | Event / file | Exam Board | Exam entries, module registrations, approved physical accommodations |
| `exam-scheduling-publication.v1` | F062 | Inbound | REST / file | Exam Board | Final timetable, seating plans, candidate numbers |

---

## Governance (Human / UI Contracts — not system adapters)

| Contract ID | Flows | Pattern | Notes |
|---|---|---|---|
| `exam-board-data-pack.v1` | F064 | REST + UI | Secure board pack served to authorised board members; not an external system adapter |
| `exam-board-ratification.v1` | F065 | REST + Temporal signal | Ratified decisions submitted via UI; triggers record lock workflow |
| `external-examiner-review.v1` | F067, F068 | REST + UI | Scoped read access to candidate profiles; confirmation returned via UI/signal |

---

## Academic Integrity

| Contract ID | Flows | Direction | Pattern | Owner | Notes |
|---|---|---|---|---|---|
| `academic-integrity-context.v1` | F070 | Outbound | REST / event | Assessment | Student identity, module registrations, submission context for case management |
| `academic-integrity-outcome.v1` | F069 | Inbound | REST POST | Assessment | Confirmed outcome and penalty; idempotency key = AI system case reference |

---

## Wellbeing and Disability (First-Party Module)

| Contract ID | Flows | Direction | Pattern | Notes |
|---|---|---|---|---|
| `wellbeing-student-context.v1` | F053 | Outbound / read | REST (scoped) | Core provides student profiles, disability declarations, academic performance; RLS enforced |
| `wellbeing-adjustment-outcome.v1` | F063 | Inbound | Internal REST | Approved adjustment outcomes only; Core distributes downstream; Wellbeing does not publish to downstream systems directly |
| `wellbeing-ec-outcome.v1` | F066 | Inbound | Internal REST | Approved EC outcomes only; Core surfaces to board |

---

## Statutory Bodies

| Contract ID | Flows | Direction | Pattern | Notes |
|---|---|---|---|---|
| `ucas-admissions-exchange.{cycle}` | F045, F046 | Bidirectional | File / API | Applications, offers, clearing, enrolment confirmation, withdrawal / deferral / no-show; versioned per UCAS cycle |
| `hesa-student-return.{year}` | F047, F048 | Bidirectional | File | Return generation, validation report, HESA IDs, amendments; versioned per HESA coding manual year |
| `slc-enrolment-exchange.v1` | F049, F050 | Bidirectional | File / API | Enrolment confirmation, status changes, loan entitlement, payments, overpayments |
| `ukvi-sponsor-compliance.v1` | F051, F052 | Bidirectional | API / file | CAS requests, attendance compliance data, visa status updates, sponsor alerts |

---

## BI, Data Warehouse, and Analytics

| Contract ID | Flows | Direction | Pattern | Notes |
|---|---|---|---|---|
| `bi-student-performance-feed.v1` | F027 | Outbound | Event / file | Structured performance, enrolment, progression extracts |
| `bi-risk-flags.v1` | F028 | Inbound | REST / event | At-risk flags; SRS records as `student_risk_flag`; lawful basis required |
| `dw-student-extract.v1` | F029 | Outbound | File / scheduled event | Full and incremental extracts; high-water mark approach for incremental |
| `dw-data-quality-feedback.v1` | F030 | Inbound | REST / file | Reconciliation alerts; SRS records as `data_quality_issue` |

---

## HR, Payroll, and Research

| Contract ID | Flows | Direction | Pattern | Notes |
|---|---|---|---|---|
| `hr-staff-assignments.v1` | F034 | Inbound | REST / event | Tutor / supervisor assignment confirmations |
| `hr-student-staff-roles.v1` | F033 | Outbound | Event / file | GTA and student-staff role data |
| `payroll-student-pay-authorisation.v1` | F035 | Outbound | File / API | Bursary and GTA payment authorisations |
| `payroll-payment-confirmation.v1` | F036 | Inbound | REST / file | Bursary / stipend payment confirmations |
| `cris-pgr-profile.v1` | F037 | Outbound | REST / event | PGR enrolment and researcher profile |
| `cris-pgr-milestones.v1` | F038 | Inbound | REST / event | Research milestones and publications |

---

## Non-SIS-Facing Reference Flows (Context Only)

The following flows are present in the reference model but do not involve the SRS directly. No Revelation SRS contract is defined for them unless a future decision explicitly brings them in scope.

| Flow | Direction | Status |
|---|---|---|
| F055 | VLE → BI | Reference context only |
| F056 | AM → BI | Reference context only |
| F057 | DW → BI | Reference context only |
| F058 | CRM → EWP | Reference context only |

---

## Replay and Reconciliation Policy

Every outbound integration contract defines at least one replay strategy. Strategies in priority order:

1. **Event replay within broker retention** (7 days default; 30–90 days for regulatory streams). Consumer requests replay from a known sequence position.
2. **Snapshot API** — `GET /api/v1/{resource}?asOf={datetime}` returns current or historical state.
3. **Incremental export from high-water mark** — adapter supplies the `recordedAt` of its last successful sync; SRS returns changes since that timestamp.
4. **Scheduled full export** — bulk file generation on demand for large-dataset reconciliation.
5. **Manual reconciliation workflow** — admin-initiated for statutory bodies (HESA, SLC, UKVI) where automated replay is not appropriate.
