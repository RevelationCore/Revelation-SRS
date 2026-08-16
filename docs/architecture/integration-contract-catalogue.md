# Integration Contract Catalogue

> Status: Updated — Partner Systems Sandbox (2026-08-04): CRM, Library, Accommodation, Estates, OIV, SETS, Payroll, Research Proposals, CMS and ITSM contracts seeded and simulated end-to-end
> Last updated: 2026-08-04
> This catalogue enumerates every integration contract between Revelation SRS and external systems or first-party modules. Each contract maps to one or more reference model flows, defines direction, pattern, owner, payload, failure handling, and replay strategy.
>
> **Simulated contracts**: the 19 contracts marked *(simulated)* below have no real external system behind them. `apps/partner-systems-sandbox` is a standalone demo app that exercises both directions of each one against SRS's real integration registry/exchange surface (the same `integration_contract`/`integration_registration`/`integration_exchange` model every other contract in this catalogue uses), so a genuine future system can replace the stub without any change to the contract itself. It is explicitly a placeholder, not a production integration — see the sandbox's own README for scope and non-goals.

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
| **Security scope** | Required service account role / human role and least-privilege permission scope |
| **Data classification** | Highest classification carried by the contract: `standard`, `personal`, `sensitive`, `special-category`, or `regulatory` |

## Normalized Contract Summary

Every contract below must be implemented with the full field set above. Where detailed sections use compact notes, this table is the normalization checklist for Phase 3 and contract-test scaffolding.

| Contract ID | Flows | Direction | Pattern | Owner module | Trigger | Failure handling | Replay / backfill | Idempotency key | Security scope | Data classification |
|---|---|---|---|---|---|---|---|---|---|---|
| `curriculum-catalogue-sync.v1` | F-CM-SIS-01 | Inbound | REST/file | Enrolment & Registration | CM update/scheduled poll | Reject invalid payload; alert; retain prior version | Full catalogue snapshot | CM version hash | `integration-service:curriculum:write` | Standard |
| `curriculum-performance-metrics.v1` | F-SIS-CM-01 | Outbound | Event/file | Enrolment & Registration | Period close/on demand | Retry/DLQ; alert | Metrics snapshot API | Report period + programme | `integration-service:curriculum:read` | Sensitive aggregate |
| `timetable-demand-feed.v1` | F-SIS-TTB-01 | Outbound | Event/file | Enrolment & Registration | Registration change/scheduled extract | Retry/DLQ; alert | Module-registration snapshot | Extract period + module offering | `integration-service:timetable:read` | Personal |
| `timetable-publication.v1` | F-TTB-SIS-01 | Inbound | REST/file | Enrolment & Registration | TTB publication | Reject invalid publication; retain prior version | TTB resubmits publication | TTB publication version | `integration-service:timetable:write` | Personal |
| `crm-admissions-feed.v1` | F-CRM-SIS-01 | Inbound | REST/file | Student Identity | CRM applicant/offer push | Validation error to CRM; alert | CRM resubmits application | CRM application reference | `integration-service:crm:write` | Personal |
| `crm-student-lifecycle-updates.v1` | F-SIS-CRM-01 | Outbound | Event | Student Identity | Student lifecycle event | Retry/DLQ; alert | Student lifecycle snapshot | Event ID | `integration-service:crm:read` | Personal |
| `library-obligations.v1` | F-LIB-SIS-01 | Inbound | REST | Student Standing / Enrolment | Library obligation notice | Reject invalid notice; alert | Library resends open obligations | Library item/fine reference | `integration-service:library:write` | Sensitive |
| `library-access-entitlement.v1` | F-SIS-LIB-01 | Outbound | Event | Student Identity | Enrolment/status change | Retry/DLQ; alert | Student snapshot | Event ID | `integration-service:library:read` | Personal |
| `finance-fee-liability.v1` | F-SIS-FIN-01 | Outbound | Event/file | Enrolment & Registration | Fee liability change | Retry/DLQ; alert | Fee-liability snapshot | Fee liability ID + version | `integration-service:finance:read` | Sensitive |
| `finance-payment-and-hold.v1` | F-FIN-SIS-01 | Inbound | REST | Enrolment & Registration | Finance payment/hold update | Reject invalid payload; alert | Finance resends transaction | Finance payment/hold reference | `integration-service:finance:write` | Sensitive |
| `portal-self-service-update.v1` | F-EWP-SIS-01 | Inbound | REST | Student Identity / Enrolment | User self-service action | RFC 7807; audit; workflow fallback | User retries operation | Portal operation reference | Human RBAC | Personal / special-category where declarations |
| `portal-student-record-read.v1` | F-SIS-EWP-01 | Outbound/read | REST | All domain modules | User reads portal data | RFC 7807; read audit where required | Current/historical API query | Request ID | Human RBAC | Personal / sensitive / special-category |
| `attendance-records-alerts.v1` | F-AM-SIS-01 | Inbound | REST/event | Engagement / Compliance | AM attendance event/alert | Reject invalid event; alert | AM resends from high-water mark | AM event ID | `integration-service:attendance:write` | Sensitive / regulatory |
| `attendance-roster-feed.v1` | F-SIS-AM-01 | Outbound | Event/file | Enrolment & Registration | Registration/calendar change | Retry/DLQ; alert | Roster snapshot | Event/extract ID | `integration-service:attendance:read` | Personal |
| `vle-course-provisioning.v1` | F-SIS-VLE-01 | Outbound | Event | Enrolment & Registration | Enrolment/module registration change | Retry/DLQ; alert | Course provisioning snapshot | Event ID | `integration-service:vle:read` | Personal |
| `vle-assessment-results.v1` | F-VLE-SIS-01 | Inbound | REST | Assessment | VLE grade/completion push | Reject invalid result; reconciliation queue | VLE resends by submission reference | VLE submission/result reference | `integration-service:vle:write` | Sensitive |
| `accommodation-eligibility.v1` | F-SIS-ACC-01 | Outbound | Event/file | Student Identity | Enrolment/profile change | Retry/DLQ; alert | Eligibility snapshot | Event/extract ID | `integration-service:accommodation:read` | Personal |
| `accommodation-booking-status.v1` | F-ACC-SIS-01 | Inbound | REST/file | Student Standing / Enrolment | Accommodation booking update | Reject invalid update; alert | ACC resends booking state | ACC booking reference | `integration-service:accommodation:write` | Personal |
| `estates-occupancy-forecast.v1` | F-SIS-EST-01 | Outbound | File/event | Reporting | Scheduled forecast | Retry; alert | Forecast extract | Forecast period | `integration-service:estates:read` | Aggregate |
| `estates-room-availability.v1` | F-EST-SIS-01 | Inbound | REST/file | Timetable support | Estates availability update | Reject invalid update; alert | EST resends availability snapshot | EST publication reference | `integration-service:estates:write` | Standard |
| `iam-account-provisioning.v1` | F-SIS-IAM-01 | Outbound | Event | Student Identity | Student status/access change | Retry/DLQ; alert | Account eligibility snapshot | Event ID | `integration-service:iam:read` | Personal |
| `iam-account-state.v1` | F-IAM-SIS-01 | Inbound | REST/event | Student Identity | IAM account state event | Reject invalid update; reconciliation queue | IAM resends from high-water mark | IAM event ID | `integration-service:iam:write` | Sensitive |
| `document-archive-submission.v1` | F-SIS-EDRMS-01 | Outbound | REST/file | Records / Governance | Document generated | Retry; alert; manual repair | Document resend by document ID | Student document ID + version | `integration-service:edrms:write` | Personal / sensitive |
| `document-archive-confirmation.v1` | F-EDRMS-SIS-01 | Inbound | REST/event | Records / Governance | EDRMS archive confirmation | Reject invalid confirmation; alert | EDRMS resends confirmation | EDRMS document reference | `integration-service:edrms:write` | Personal / sensitive |
| `identity-verification-request.v1` | F-SIS-OIV-01 | Outbound | REST | Student Identity | Verification requested | Retry; manual review on failure | Request resend by check ID | Verification check ID | `integration-service:oiv:write` | Sensitive |
| `identity-verification-outcome.v1` | F-OIV-SIS-01 | Inbound | REST/webhook | Student Identity | OIV outcome callback | Reject invalid outcome; alert | OIV resends outcome | Provider verification reference | `integration-service:oiv:write` | Sensitive |
| `bi-student-performance-feed.v1` | F-SIS-BI-01 | Outbound | Event/file | Reporting | Scheduled/on demand extract | Retry; alert | Extract by high-water mark | Extract ID | `integration-service:bi:read` | Sensitive |
| `bi-risk-flags.v1` | F-BI-SIS-01 | Inbound | REST/event | Engagement / Student Support | BI risk flag | Reject invalid flag; audit lawful basis | BI resends by flag ID | BI flag ID | `integration-service:bi:write` | Sensitive |
| `dw-student-extract.v1` | F-SIS-DW-01 | Outbound | File/event | Reporting | Scheduled extract | Retry; alert | Full or incremental extract | Extract ID/high-water mark | `integration-service:dw:read` | Sensitive |
| `dw-data-quality-feedback.v1` | F-DW-SIS-01 | Inbound | REST/file | Data Administration | DW quality report | Reject invalid report; alert | DW resends issue list | DW issue/report reference | `integration-service:dw:write` | Sensitive |
| `sets-survey-roster.v1` | F-SIS-SETS-01 | Outbound | File/API | Enrolment & Registration | Survey window opens | Retry; alert | Roster snapshot | Survey period + module | `integration-service:sets:read` | Personal |
| `sets-survey-summary.v1` | F-SETS-SIS-01 | Inbound | REST/file | Reporting | Survey summary published | Reject invalid aggregate | SETS resends summary | Survey summary reference | `integration-service:sets:write` | Aggregate |
| `hr-student-staff-roles.v1` | F-SIS-HR-01 | Outbound | Event/file | HR/Payroll support | Student-staff role change | Retry; alert | Role snapshot | Event/extract ID | `integration-service:hr:read` | Sensitive |
| `hr-staff-assignments.v1` | F-HR-SIS-01 | Inbound | REST/event | Enrolment & Registration | HR assignment confirmation | Reject invalid assignment; alert | HR resends assignments | HR assignment reference | `integration-service:hr:write` | Personal |
| `payroll-student-pay-authorisation.v1` | F-SIS-PAY-01 | Outbound | File/API | Finance support | Payment authorisation approved | Retry; alert | Authorisation snapshot | Authorisation ID | `integration-service:payroll:read` | Sensitive |
| `payroll-payment-confirmation.v1` | F-PAY-SIS-01 | Inbound | REST/file | Finance support | Payroll payment confirmation | Reject invalid payment; alert | Payroll resends payment | Payroll payment reference | `integration-service:payroll:write` | Sensitive |
| `cris-pgr-profile.v1` | F-SIS-CRIS-01 | Outbound | REST/event | Research / PGR | PGR enrolment/profile change | Retry; alert | PGR profile snapshot | Event ID | `integration-service:cris:read` | Personal |
| `cris-pgr-milestones.v1` | F-CRIS-SIS-01 | Inbound | REST/event | Research / PGR | CRIS milestone update | Reject invalid milestone; alert | CRIS resends milestone | CRIS milestone reference | `integration-service:cris:write` | Sensitive |
| `research-proposal-eligibility.v1` | F-SIS-RP-01 | Outbound | REST/API | Research / PGR | Eligibility request/change | Retry; alert | Eligibility snapshot | Request ID | `integration-service:research-proposals:read` | Personal |
| `research-studentship-award.v1` | F-RP-SIS-01 | Inbound | REST/API | Research / Finance support | Studentship award notification | Reject invalid award; alert | RP resends award | RP award reference | `integration-service:research-proposals:write` | Sensitive |
| `cms-cohort-personalisation.v1` | F-SIS-CMS-01 | Outbound | API/event | Student Identity / Reporting | Cohort/programme change | Retry; alert | Cohort snapshot | Event/extract ID | `integration-service:cms:read` | Personal |
| `cms-policy-publication.v1` | F-CMS-SIS-01 | Inbound | REST/event | Records / Compliance | CMS policy publication | Reject invalid notice; alert | CMS resends notice | CMS publication ID | `integration-service:cms:write` | Standard / regulatory |
| `itsm-student-context.v1` | F-SIS-ITSM-01 | Outbound | API | Student Identity | ITSM context lookup | RFC 7807; read audit where required | Current API lookup | Request ID | `integration-service:itsm:read` | Personal / sensitive |
| `itsm-account-impact.v1` | F-ITSM-SIS-01 | Inbound | REST/event | Student Identity | ITSM account-impact update | Reject invalid update; alert | ITSM resends case outcome | ITSM ticket reference | `integration-service:itsm:write` | Sensitive |
| `ucas-admissions-exchange.{cycle}` | F-UCAS-SIS-01, F-SIS-UCAS-01 | Bidirectional | File/API | Student Identity / Admissions | UCAS cycle exchange | Validation report; retry; manual reconciliation | UCAS file/API replay | UCAS transaction/reference | `integration-service:ucas` | Personal / regulatory |
| `hesa-student-return.{year}` | F-SIS-HESA-01, F-HESA-SIS-01 | Bidirectional | File | Regulatory Compliance | HESA return lifecycle | Validation issue workflow; amendments | Regenerate return from source transaction time | HESA submission reference | `integration-service:hesa` | Regulatory |
| `slc-enrolment-exchange.v1` | F-SIS-SLC-01, F-SLC-SIS-01 | Bidirectional | File/API | Regulatory / Finance | Enrolment/payment exchange | Retry; reconciliation workflow | SLC exchange replay/snapshot | SLC transaction reference | `integration-service:slc` | Sensitive / regulatory |
| `ukvi-sponsor-compliance.v1` | F-SIS-UKVI-01, F-UKVI-SIS-01 | Bidirectional | API/file | Regulatory Compliance | CAS/attendance/visa event | Retry; compliance escalation | UKVI case/exchange replay | UKVI/CAS reference | `integration-service:ukvi` | Sensitive / regulatory |
| `ofs-regulatory-extracts.v1` | F-SIS-OFS-01 | Outbound | REST/file | Regulatory Compliance | Scheduled or on-demand extract generation | Retry; alert | Regenerate from source transaction time | Extract ID | `integration-service:ofs` | Regulatory |
| `ofs-regulatory-extracts.v1` | F-SIS-OFS-01 | Outbound | REST/file | Regulatory Compliance | Scheduled or on-demand extract | Retry; alert | Regenerate from source transaction time | Extract ID | `integration-service:ofs` | Regulatory |

| Contract ID | Flows | Direction | Pattern | Notes |
|---|---|---|---|---|
| `ofs-regulatory-extracts.v1` | F-SIS-OFS-01 | Outbound | REST/file | OfS B3 student data extract and widening participation / access and participation extract; versioned per academic year |

---

## OfS Regulatory Extracts

| Field | Value |
|---|---|
| **Contract ID** | `ofs-regulatory-extracts.v1` |
| **Flows** | F-SIS-OFS-01 |
| **Direction** | Outbound |
| **Pattern** | REST API (JSON payload, downloadable as file) |
| **Owner module** | Regulatory Compliance |
| **Trigger** | Scheduled annual extract, or on-demand from registry |
| **Payload** | Structured OfS B3 student record data; access and participation metrics per programme and cohort |
| **Failure handling** | Retry; alert; regenerate from source bitemporal data |
| **Replay** | Regenerate extract from source transaction time: `POST /api/v1/regulatory/ofs/b3-extracts` with the relevant `academicYear` |
| **Idempotency key** | Extract ID (returned by generate endpoint) |

**Endpoints:**
- `POST /api/v1/regulatory/ofs/b3-extracts` — generate B3 student record extract for an academic year
- `GET /api/v1/regulatory/ofs/b3-extracts/{extractId}` — retrieve a previously generated extract
- `POST /api/v1/regulatory/ofs/participation-reports` — generate access and participation (widening participation) extract

**Domain event:** `srs.regulatory.ofs-extract-generated`

---

| `wellbeing-student-context.v1` | F-SIS-WELL-01 | Outbound/read | REST | Wellbeing module / Core | Casework context read | RFC 7807; read audit | Bitemporal API query | Request ID | `wellbeing-advisor` / service account | Special-category |
| `vle-learning-analytics.v1` | F-VLE-BI-01 | Context | External | Not SRS-owned | VLE to BI | Not implemented by SRS | Not implemented by SRS | External | External | Context |
| `attendance-bi-feed.v1` | F-AM-BI-01 | Context | External | Not SRS-owned | AM to BI | Not implemented by SRS | Not implemented by SRS | External | External | Context |
| `dw-to-bi-context.v1` | F-DW-BI-01 | Context | External | Not SRS-owned | DW to BI | Not implemented by SRS | Not implemented by SRS | External | External | Context |
| `crm-portal-communications.v1` | F-CRM-EWP-01 | Context | External | Not SRS-owned | CRM to EWP | Not implemented by SRS | Not implemented by SRS | External | External | Context |
| `vle-adjustments.v1` | F-SIS-VLE-02 | Outbound | Event | Assessment / Adjustments | Adjustment approved/distributed | Retry/DLQ; distribution failure event | Adjustment snapshot | Distribution ID/event ID | `integration-service:vle:write` | Special-category |
| `attendance-adjustments.v1` | F-SIS-AM-02 | Outbound | Event | Assessment / Adjustments | Attendance adjustment approved | Retry/DLQ; distribution failure event | Adjustment snapshot | Distribution ID/event ID | `integration-service:attendance:write` | Special-category |
| `exam-scheduling-entries.v1` | F-SIS-EXAMS-01 | Outbound | Event/file | Exam Board & Governance | Exam entries/accommodations generated | Retry; alert | Exam-entry snapshot | Exam entry ID | `integration-service:exams:read` | Sensitive / special-category |
| `exam-scheduling-publication.v1` | F-EXAMS-SIS-01 | Inbound | REST/file | Exam Board & Governance | Exam timetable publication | Reject invalid publication; alert | EXAMS republishes timetable | Exam publication reference | `integration-service:exams:write` | Sensitive |
| `wellbeing-adjustment-outcome.v1` | F-WELL-SIS-01 | Inbound | Internal REST | Assessment / Adjustments | Approved adjustment outcome | Reject invalid outcome; audit | Wellbeing resends outcome | Wellbeing case/outcome reference | Wellbeing service account | Special-category |
| `exam-board-data-pack.v1` | F-SIS-EXAMBOARD-01 | Human/UI | REST/UI | Exam Board & Governance | Board pack generated/read | RBAC denial/RFC 7807; read audit | Regenerate from source transaction time | Data pack ID/version | Exam board roles | Sensitive / special-category |
| `exam-board-ratification.v1` | F-EXAMBOARD-SIS-01 | Human/UI | REST/Temporal | Exam Board & Governance | Chair ratifies board | Workflow retry/audit; manual correction | Workflow query/history | Workflow/task ID | Exam board chair | Sensitive |
| `wellbeing-ec-outcome.v1` | F-WELL-SIS-02 | Inbound | Internal REST | Exam Board & Governance | Approved EC outcome | Reject invalid outcome; audit | Wellbeing resends outcome | Wellbeing case/outcome reference | Wellbeing service account | Special-category |
| `external-examiner-review.v1` | F-SIS-EXTEX-01, F-EXTEX-EXAMBOARD-01 | Human/UI | REST/UI/Temporal | Exam Board & Governance | External review/signoff | RBAC denial/RFC 7807; read audit | Board pack query | Signoff task ID | External examiner role | Sensitive / special-category |
| `academic-integrity-outcome.v1` | F-AI-SIS-01 | Inbound | REST/event | Assessment | AI confirmed outcome | Reject invalid outcome; audit | AI resends outcome | AI case/outcome reference | `integration-service:academic-integrity:write` | Sensitive |
| `academic-integrity-context.v1` | F-SIS-AI-01 | Outbound | REST/event | Assessment | Misconduct case opened/context requested | RFC 7807; read audit | Current/bitemporal context API | Request/event ID | `integration-service:academic-integrity:read` | Sensitive |

---

## Curriculum Management

| Field | Value |
|---|---|
| **Contract ID** | `curriculum-catalogue-sync.v1` |
| **Flows** | F-CM-SIS-01 |
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
| **Flows** | F-SIS-CM-01 |
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
| **Flows** | F-SIS-TTB-01 |
| **Direction** | Outbound |
| **Pattern** | Event (`srs.enrolment.module-registered`) + scheduled file |
| **Owner module** | Enrolment & Registration |
| **Trigger** | Module registration confirmed; or scheduled extract at registration close |
| **Payload** | Student enrolments, confirmed module registrations, credit load, academic period |
| **Replay** | Snapshot: `GET /api/v1/module-registrations?periodId=&status=registered` |

| Field | Value |
|---|---|
| **Contract ID** | `timetable-publication.v1` |
| **Flows** | F-TTB-SIS-01 |
| **Direction** | Inbound |
| **Pattern** | REST POST or file |
| **Owner module** | Enrolment & Registration |
| **Trigger** | TTB publishes finalised timetable |
| **Payload** | Activity IDs, room references, scheduled times, change indicators |
| **Failure handling** | Validation rejection; TTB resubmits; previous publication retained |
| **Idempotency key** | TTB publication version ID |

---

## CRM *(simulated — see `apps/partner-systems-sandbox`)*

| Field | Value |
|---|---|
| **Contract ID** | `crm-admissions-feed.v1` |
| **Flows** | F-CRM-SIS-01 |
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
| **Flows** | F-SIS-CRM-01 |
| **Direction** | Outbound |
| **Pattern** | Event (`srs.student.enrolled`, `srs.student.status-changed`, `srs.award.conferred`) |
| **Owner module** | Student Identity |
| **Trigger** | Significant enrolment status changes; award conferred |
| **Payload** | `personId`, `enrolmentId`, `statusCode`, `effectiveDate`, `programmeCode` |
| **Replay** | Snapshot: `GET /api/v1/students?enrolmentStatus=&academicYear=` |

---

## Finance

| Field | Value |
|---|---|
| **Contract ID** | `finance-fee-liability.v1` |
| **Flows** | F-SIS-FIN-01 |
| **Direction** | Outbound |
| **Pattern** | Event (`srs.enrolment.fee-liability-generated`) |
| **Owner module** | Enrolment & Registration |
| **Trigger** | Enrolment confirmed; fee liability calculated |
| **Payload** | `enrolmentId`, `feeLiabilityId`, `academicYear`, `feeAmount`, `fundingSource` |
| **Replay** | Snapshot: `GET /api/v1/enrolments/:id/fee-liabilities?academicYear=` |

| Field | Value |
|---|---|
| **Contract ID** | `finance-payment-and-hold.v1` |
| **Flows** | F-FIN-SIS-01 |
| **Direction** | Inbound |
| **Pattern** | REST POST |
| **Owner module** | Enrolment & Registration |
| **Trigger** | Finance confirms payment or applies/releases financial hold |
| **Payload** | `enrolmentId`, `amount`, `paymentSource`, `paymentReference` / `holdTypeCode`, `appliedAt` |
| **Idempotency key** | Finance system payment reference |

---

## Library *(simulated — see `apps/partner-systems-sandbox`)*

| Field | Value |
|---|---|
| **Contract ID** | `library-access-entitlement.v1` |
| **Flows** | F-SIS-LIB-01 |
| **Direction** | Outbound |
| **Pattern** | Event (`srs.student.enrolled`, `srs.student.status-changed`) |
| **Owner module** | Student Identity |
| **Payload** | `personId`, `studentNumber`, `enrolmentStatusCode`, `programmeCode` |
| **Replay** | Snapshot: `GET /api/v1/students/:id` |

| Field | Value |
|---|---|
| **Contract ID** | `library-obligations.v1` |
| **Flows** | F-LIB-SIS-01 |
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
| **Flows** | F-SIS-EWP-01 |
| **Direction** | Outbound (read) |
| **Pattern** | REST GET |
| **Owner module** | All domain modules |
| **Trigger** | Student / staff navigates in portal |
| **Payload** | Enrolment status, module registrations, grades, timetable, exam timetable, adjustments, notifications |

| Field | Value |
|---|---|
| **Contract ID** | `portal-self-service-update.v1` |
| **Flows** | F-EWP-SIS-01 |
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
| `attendance-roster-feed.v1` | F-SIS-AM-01 | Outbound | Event + file | Enrolment | Module rosters, academic calendar, adjustment distribution |
| `attendance-records-alerts.v1` | F-AM-SIS-01 | Inbound | REST / event | Student Identity | Attendance events and absence alerts; `ukviRelevant` flag required |
| `attendance-adjustments.v1` | F-SIS-AM-02 | Outbound | Event (`srs.adjustment.distributed`) | Assessment | Approved attendance adjustments from SIS only |

---

## Virtual Learning Environment

| Contract ID | Flows | Direction | Pattern | Owner | Notes |
|---|---|---|---|---|---|
| `vle-course-provisioning.v1` | F-SIS-VLE-01 | Outbound | Event | Enrolment | `srs.student.enrolled`, `srs.enrolment.module-registered`, `srs.student.status-changed` |
| `vle-assessment-results.v1` | F-VLE-SIS-01 | Inbound | REST POST | Assessment | Marks, completion status, academic alerts; idempotency key = VLE submission reference |
| `vle-adjustments.v1` | F-SIS-VLE-02 | Outbound | Event (`srs.adjustment.distributed`) | Assessment | Approved adjustments from SIS only; VLE must not receive directly from Wellbeing |

---

## Identity and Access Management

| Contract ID | Flows | Direction | Pattern | Owner | Notes |
|---|---|---|---|---|---|
| `iam-account-provisioning.v1` | F-SIS-IAM-01 | Outbound | Event | Student Identity | `srs.student.enrolled`, `srs.student.status-changed`; triggers account create / update / deactivate |
| `iam-account-state.v1` | F-IAM-SIS-01 | Inbound | REST / event | Student Identity | Credential updates, account locks, role assignments; must not overwrite SRS-owned RBAC decisions |

---

## Exam Scheduling

| Contract ID | Flows | Direction | Pattern | Owner | Notes |
|---|---|---|---|---|---|
| `exam-scheduling-entries.v1` | F-SIS-EXAMS-01 | Outbound | Event / file | Exam Board | Exam entries, module registrations, approved physical accommodations |
| `exam-scheduling-publication.v1` | F-EXAMS-SIS-01 | Inbound | REST / file | Exam Board | Final timetable, seating plans, candidate numbers |

---

## Governance (Human / UI Contracts — not system adapters)

| Contract ID | Flows | Pattern | Notes |
|---|---|---|---|
| `exam-board-data-pack.v1` | F-SIS-EXAMBOARD-01 | REST + UI | Secure board pack served to authorised board members; not an external system adapter |
| `exam-board-ratification.v1` | F-EXAMBOARD-SIS-01 | REST + Temporal signal | Ratified decisions submitted via UI; triggers record lock workflow |
| `external-examiner-review.v1` | F-SIS-EXTEX-01, F-EXTEX-EXAMBOARD-01 | REST + UI | Scoped read access to candidate profiles; confirmation returned via UI/signal |

---

## Academic Integrity

| Contract ID | Flows | Direction | Pattern | Owner | Notes |
|---|---|---|---|---|---|
| `academic-integrity-context.v1` | F-SIS-AI-01 | Outbound | REST / event | Assessment | Student identity, module registrations, submission context for case management |
| `academic-integrity-outcome.v1` | F-AI-SIS-01 | Inbound | REST POST | Assessment | Confirmed outcome and penalty; idempotency key = AI system case reference |

---

## Wellbeing and Disability (First-Party Module)

| Contract ID | Flows | Direction | Pattern | Notes |
|---|---|---|---|---|
| `wellbeing-student-context.v1` | F-SIS-WELL-01 | Outbound / read | REST (scoped) | Core provides student profiles, disability declarations, academic performance; RLS enforced |
| `wellbeing-adjustment-outcome.v1` | F-WELL-SIS-01 | Inbound | Internal REST | Approved adjustment outcomes only; Core distributes downstream; Wellbeing does not publish to downstream systems directly |
| `wellbeing-ec-outcome.v1` | F-WELL-SIS-02 | Inbound | Internal REST | Approved EC outcomes only; Core surfaces to board |

---

## Statutory Bodies

| Contract ID | Flows | Direction | Pattern | Notes |
|---|---|---|---|---|
| `ucas-admissions-exchange.{cycle}` | F-UCAS-SIS-01, F-SIS-UCAS-01 | Bidirectional | File / API | Applications, offers, clearing, enrolment confirmation, withdrawal / deferral / no-show; versioned per UCAS cycle |
| `hesa-student-return.{year}` | F-SIS-HESA-01, F-HESA-SIS-01 | Bidirectional | File | Return generation, validation report, HESA IDs, amendments; versioned per HESA coding manual year |
| `slc-enrolment-exchange.v1` | F-SIS-SLC-01, F-SLC-SIS-01 | Bidirectional | File / API | Enrolment confirmation, status changes, loan entitlement, payments, overpayments |
| `ukvi-sponsor-compliance.v1` | F-SIS-UKVI-01, F-UKVI-SIS-01 | Bidirectional | API / file | CAS requests, attendance compliance data, visa status updates, sponsor alerts |

---

## BI, Data Warehouse, and Analytics

| Contract ID | Flows | Direction | Pattern | Notes |
|---|---|---|---|---|
| `bi-student-performance-feed.v1` | F-SIS-BI-01 | Outbound | Event / file | Structured performance, enrolment, progression extracts |
| `bi-risk-flags.v1` | F-BI-SIS-01 | Inbound | REST / event | At-risk flags; SRS records as `student_risk_flag`; lawful basis required |
| `dw-student-extract.v1` | F-SIS-DW-01 | Outbound | File / scheduled event | Full and incremental extracts; high-water mark approach for incremental |
| `dw-data-quality-feedback.v1` | F-DW-SIS-01 | Inbound | REST / file | Reconciliation alerts; SRS records as `data_quality_issue` |

---

## HR, Payroll, and Research

Payroll and Research Proposals rows are *(simulated — see `apps/partner-systems-sandbox`)*; HR and CRIS rows are real, built for the PGR lifecycle (ADR-023).

| Contract ID | Flows | Direction | Pattern | Notes |
|---|---|---|---|---|
| `hr-staff-assignments.v1` | F-HR-SIS-01 | Inbound | REST / event | Tutor / supervisor assignment confirmations |
| `hr-student-staff-roles.v1` | F-SIS-HR-01 | Outbound | Event / file | GTA and student-staff role data |
| `payroll-student-pay-authorisation.v1` | F-SIS-PAY-01 | Outbound | File / API | Bursary and GTA payment authorisations |
| `payroll-payment-confirmation.v1` | F-PAY-SIS-01 | Inbound | REST / file | Bursary / stipend payment confirmations |
| `research-proposal-eligibility.v1` | F-SIS-RP-01 | Outbound | REST / API | Student researcher eligibility and supervisor assignment data |
| `research-studentship-award.v1` | F-RP-SIS-01 | Inbound | REST / API | Funded research studentship award records |
| `cris-pgr-profile.v1` | F-SIS-CRIS-01 | Outbound | REST / event | PGR enrolment and researcher profile |
| `cris-pgr-milestones.v1` | F-CRIS-SIS-01 | Inbound | REST / event | Research milestones and publications |

---

## Accommodation and Conferencing *(simulated — see `apps/partner-systems-sandbox`)*

| Contract ID | Flows | Direction | Pattern | Owner | Notes |
|---|---|---|---|---|---|
| `accommodation-eligibility.v1` | F-SIS-ACC-01 | Outbound | Event / file | Student Identity | Enrolment/profile change drives an eligibility snapshot |
| `accommodation-booking-status.v1` | F-ACC-SIS-01 | Inbound | REST / file | Student Standing / Enrolment | Room allocation, booking status, check-in/out records |

---

## Estates *(simulated — see `apps/partner-systems-sandbox`)*

| Contract ID | Flows | Direction | Pattern | Owner | Notes |
|---|---|---|---|---|---|
| `estates-occupancy-forecast.v1` | F-SIS-EST-01 | Outbound | File / event | Reporting | Scheduled enrolment/timetable-derived occupancy forecast |
| `estates-room-availability.v1` | F-EST-SIS-01 | Inbound | REST / file | Timetable support | Room allocation confirmations and availability updates |

---

## Online ID Verification *(simulated — see `apps/partner-systems-sandbox`)*

| Contract ID | Flows | Direction | Pattern | Owner | Notes |
|---|---|---|---|---|---|
| `identity-verification-request.v1` | F-SIS-OIV-01 | Outbound | REST | Student Identity | Verification requested at enrolment / onboarding |
| `identity-verification-outcome.v1` | F-OIV-SIS-01 | Inbound | REST / webhook | Student Identity | Verification outcome, confidence score, fraud flags |

---

## Student Evaluation of Teaching Software *(simulated — see `apps/partner-systems-sandbox`)*

| Contract ID | Flows | Direction | Pattern | Owner | Notes |
|---|---|---|---|---|---|
| `sets-survey-roster.v1` | F-SIS-SETS-01 | Outbound | File / API | Enrolment & Registration | Module roster and student registration data for survey distribution |
| `sets-survey-summary.v1` | F-SETS-SIS-01 | Inbound | REST / file | Reporting | Survey completion rates and aggregated feedback scores |

---

## Content Management Systems *(simulated — see `apps/partner-systems-sandbox`)*

| Contract ID | Flows | Direction | Pattern | Owner | Notes |
|---|---|---|---|---|---|
| `cms-cohort-personalisation.v1` | F-SIS-CMS-01 | Outbound | API / event | Student Identity / Reporting | Cohort and programme data for content personalisation |
| `cms-policy-publication.v1` | F-CMS-SIS-01 | Inbound | REST / event | Records / Compliance | Published regulatory and policy notifications |

---

## IT Service Management *(simulated — see `apps/partner-systems-sandbox`)*

| Contract ID | Flows | Direction | Pattern | Owner | Notes |
|---|---|---|---|---|---|
| `itsm-student-context.v1` | F-SIS-ITSM-01 | Outbound | API | Student Identity | Identity and account context for incident handling |
| `itsm-account-impact.v1` | F-ITSM-SIS-01 | Inbound | REST / event | Student Identity | Service request outcomes affecting student account status |

---

## Non-SIS-Facing Reference Flows (Context Only)

The following flows are present in the reference model but do not involve the SRS directly. No Revelation SRS contract is defined for them unless a future decision explicitly brings them in scope.

| Flow | Direction | Status |
|---|---|---|
| F-VLE-BI-01 | VLE → BI | Reference context only |
| F-AM-BI-01 | AM → BI | Reference context only |
| F-DW-BI-01 | DW → BI | Reference context only |
| F-CRM-EWP-01 | CRM → EWP | Reference context only |

---

## Replay and Reconciliation Policy

Every outbound integration contract defines at least one replay strategy. Strategies in priority order:

1. **Event replay within broker retention** (7 days default; 30–90 days for regulatory streams). Consumer requests replay from a known sequence position.
2. **Snapshot API** — `GET /api/v1/{resource}?asOf={datetime}` returns current or historical state.
3. **Incremental export from high-water mark** — adapter supplies the `recordedAt` of its last successful sync; SRS returns changes since that timestamp.
4. **Scheduled full export** — bulk file generation on demand for large-dataset reconciliation.
5. **Manual reconciliation workflow** — admin-initiated for statutory bodies (HESA, SLC, UKVI) where automated replay is not appropriate.
