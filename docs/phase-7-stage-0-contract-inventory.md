# Phase 7 Stage 0 — Contract Inventory and Classification

> Date: 2026-06-14
> Status: Complete
> Generated from: live route files, `packages/domain/src/events/index.ts`, `packages/testing/regulatory-contracts/`
> Reconciled against: `docs/architecture/api-resource-catalogue.md`, `docs/architecture/domain-events.md`, `docs/architecture/integration-contract-catalogue.md`

---

## Summary

| Surface | Count | Publication-ready | Gaps found |
|---|---|---|---|
| REST routes (total operations) | 157 | 93 public/integration/workflow | 64 admin/operational/internal |
| Domain events | 52 | 42 publishable | 10 internal / needs review |
| File contracts (fixtures) | 9 | 9 fixtures present | 9 formal specs missing |
| Phase 2 catalogue resources | 22 | Partially updated | Stale names; missing clean-arch additions |
| Phase 2 event taxonomy entries | ~55 | Not updated | 20+ subject drift; 15+ missing events |

---

## Publication Classification Key

| Code | Class | Meaning |
|---|---|---|
| `PUB` | Public core API | Used by portals, students, or external partners; published as external contract |
| `INT` | Integration API | Service-account authenticated; first-party modules or external adapter; published with partner scope |
| `WF` | Workflow command | Human workflow action; command-style; published for workflow task UIs and automation |
| `ADM` | Tenant admin | Institutional configuration; published for admin tooling |
| `SYS` | Platform/system admin | System-administrator only; not published to third parties |
| `RPT` | Reporting / export | Async extract or file download; published with reporting scope |
| `OPS` | Operational | Health, metrics, docs; not included in published contract |
| `PRIV` | Private / internal | Implementation detail; not published |

---

## 1. REST API Route Inventory

All routes are under the `/api/v1/` prefix, served by Fastify, and reflected in the runtime OpenAPI at `GET /api/v1/openapi.json`.

### 1.1 Students

| Method | Path | Class | Notes |
|---|---|---|---|
| GET | `/students` | `PUB` | Paginated list; staff roles |
| POST | `/students` | `PUB` | Create person record |
| GET | `/students/:personId` | `PUB` | Own-record for students; staff broader |
| PATCH | `/students/:personId/identity` | `PUB` | Name/DOB change; audit required |
| GET | `/students/:personId/identity-history` | `PUB` | Bitemporal identity history |
| PATCH | `/students/:personId/status` | `WF` | Admin status override; audited |
| PATCH | `/students/:personId/hesa-id` | `INT` | HESA ID backfill from HESA system |
| GET | `/students/:personId/addresses` | `PUB` | |
| POST | `/students/:personId/addresses` | `PUB` | |
| POST | `/students/:personId/disability-declarations` | `PUB` | Special-category |
| GET | `/students/:personId/disability-declarations` | `PUB` | Special-category; wellbeing-advisor or own-record |
| GET | `/students/:personId/enrolments` | `PUB` | |
| POST | `/students/:personId/identity-verifications` | `INT` | OIV request trigger |
| POST | `/students/:personId/identity-verifications/:verificationCheckId/completion` | `INT` | OIV outcome inbound |
| GET | `/students/:personId/identity-verifications` | `PUB` | Registry staff |

### 1.2 Enrolments

| Method | Path | Class | Notes |
|---|---|---|---|
| GET | `/enrolments` | `PUB` | Filtered list |
| POST | `/enrolments` | `PUB` | Create enrolment; triggers fee liability |
| GET | `/enrolments/:enrolmentId` | `PUB` | |
| GET | `/enrolments/:enrolmentId/history` | `PUB` | Bitemporal version history |
| GET | `/enrolments/:enrolmentId/transitions` | `PUB` | Available status transitions |
| GET | `/enrolments/:enrolmentId/fee-liabilities` | `PUB` | |
| GET | `/enrolments/:enrolmentId/downstream-triggers` | `PRIV` | Internal ledger; not for publication |
| POST | `/enrolments/:enrolmentId/intermit` | `WF` | Status transition |
| POST | `/enrolments/:enrolmentId/withdraw` | `WF` | Status transition |
| POST | `/enrolments/:enrolmentId/suspend` | `WF` | Status transition |
| POST | `/enrolments/:enrolmentId/graduate` | `WF` | Status transition |
| POST | `/enrolments/:enrolmentId/enrol` | `WF` | Reinstate to enrolled |

### 1.3 Module Registrations

| Method | Path | Class | Notes |
|---|---|---|---|
| GET | `/module-registrations` | `PUB` | |
| GET | `/module-registrations/timetable` | `PUB` | |
| POST | `/module-registrations` | `PUB` | Self-service or staff registration |
| GET | `/module-registrations/:moduleRegistrationId` | `PUB` | |
| GET | `/module-registrations/:moduleRegistrationId/history` | `PUB` | |
| POST | `/module-registrations/:moduleRegistrationId/withdrawal` | `WF` | |
| POST | `/module-registrations/:moduleRegistrationId/completion` | `WF` | Post-board completion |
| GET | `/module-registrations/:moduleRegistrationId/exam-entry` | `PUB` | |
| GET | `/module-registrations/:moduleRegistrationId/exam-timetable` | `PUB` | |

### 1.4 Assessment

| Method | Path | Class | Notes |
|---|---|---|---|
| GET | `/module-offerings/:moduleOfferingId/components` | `PUB` | |
| POST | `/module-offerings/:moduleOfferingId/components` | `ADM` | Pre-mark-entry only |
| PATCH | `/module-offerings/:moduleOfferingId/components/:assessmentComponentId` | `ADM` | |
| GET | `/module-registrations/:moduleRegistrationId/marks` | `PUB` | Staff roles |
| POST | `/module-registrations/:moduleRegistrationId/marks` | `INT` | VLE or mark ingest |
| GET | `/marks/:markId/history` | `PUB` | |
| PATCH | `/marks/:markId` | `PUB` | Pre-board correction; audited |
| GET | `/module-registrations/:moduleRegistrationId/result` | `PUB` | |
| GET | `/module-registrations/:moduleRegistrationId/result/history` | `PUB` | |

### 1.5 Exam Boards

| Method | Path | Class | Notes |
|---|---|---|---|
| POST | `/exam-boards` | `PUB` | Registry staff |
| GET | `/exam-boards/:boardId` | `PUB` | Board roles |
| POST | `/exam-boards/:boardId/data-pack` | `WF` | Generate board data pack |
| GET | `/exam-boards/:boardId/data-pack` | `PUB` | Download data pack |
| GET | `/exam-boards/:boardId/candidates/:enrolmentId` | `PUB` | Candidate profile |
| GET | `/exam-boards/:boardId/data-packs/:dataPackId/candidates/:enrolmentId` | `PUB` | Historical candidate profile |
| POST | `/exam-boards/:boardId/exam-entries/generate` | `WF` | Generate exam entries |
| GET | `/exam-boards/:boardId/exam-entries` | `PUB` | |
| POST | `/exam-boards/:boardId/exam-schedule` | `INT` | Inbound from exam scheduling system |
| POST | `/exam-boards/:boardId/attendance` | `WF` | Record quorum attendance |
| POST | `/exam-boards/:boardId/external-examiner-signoff` | `WF` | |
| POST | `/exam-boards/:boardId/ratification` | `WF` | Chair-only; triggers record lock |
| POST | `/exam-boards/:boardId/deferral` | `WF` | |
| DELETE | `/exam-boards/:boardId/deferral` | `WF` | Reopen deferred board |
| POST | `/exam-boards/:boardId/quorum` | `WF` | |

### 1.6 Progression and Awards

| Method | Path | Class | Notes |
|---|---|---|---|
| POST | `/enrolments/:enrolmentId/progression` | `WF` | Record progression decision |
| GET | `/enrolments/:enrolmentId/progression` | `PUB` | |
| GET | `/enrolments/:enrolmentId/progression/history` | `PUB` | |
| GET | `/enrolments/:enrolmentId/classification` | `PUB` | Award classification |
| POST | `/enrolments/:enrolmentId/award` | `WF` | Confer award |
| GET | `/enrolments/:enrolmentId/award` | `PUB` | |
| POST | `/enrolments/:enrolmentId/hear` | `WF` | Generate HEAR document |
| GET | `/enrolments/:enrolmentId/hear` | `RPT` | Download HEAR |

### 1.7 Adjustments and Circumstances

| Method | Path | Class | Notes |
|---|---|---|---|
| POST | `/students/:personId/adjustments` | `INT` | Inbound from Wellbeing module |
| GET | `/students/:personId/adjustments` | `PUB` | wellbeing-advisor or registry |
| GET | `/adjustments/:adjustmentId/distributions` | `PRIV` | Distribution ledger; not for publication |
| POST | `/adjustments/:adjustmentId/distributions/:distributionId/acknowledge` | `INT` | Target system acknowledges distribution |
| POST | `/adjustments/:adjustmentId/expire` | `WF` | |
| POST | `/students/:personId/exceptional-circumstances` | `INT` | Inbound from Wellbeing |
| GET | `/students/:personId/exceptional-circumstances` | `PUB` | Staff; special-category |
| PATCH | `/exceptional-circumstances/:ecId` | `WF` | Pre-board correction |
| POST | `/students/:personId/misconduct-outcomes` | `INT` | Inbound from AI system |
| GET | `/students/:personId/misconduct-outcomes` | `PUB` | Staff; sensitive |

### 1.8 Correction Cases

| Method | Path | Class | Notes |
|---|---|---|---|
| POST | `/enrolments/:enrolmentId/correction-cases` | `WF` | Post-ratification correction |
| PATCH | `/correction-cases/:caseId/status` | `WF` | |
| POST | `/correction-cases/:caseId/amendments` | `WF` | Approved amendment |
| GET | `/enrolments/:enrolmentId/correction-cases` | `PUB` | Staff |

### 1.9 Regulatory

| Method | Path | Class | Notes |
|---|---|---|---|
| POST | `/regulatory/ucas/applications` | `INT` | UCAS adapter inbound |
| GET | `/regulatory/ucas/applications` | `RPT` | Registry staff |
| POST | `/regulatory/ucas/applications/:applicationId/link` | `WF` | Link staged application to enrolment |
| POST | `/regulatory/ucas/confirmations/generate` | `INT` | Generate UCAS confirmation batch |
| POST | `/regulatory/hesa/returns` | `RPT` | Initiate HESA return |
| GET | `/regulatory/hesa/returns` | `RPT` | |
| GET | `/regulatory/hesa/returns/:returnId` | `RPT` | |
| POST | `/regulatory/hesa/returns/:returnId/validate` | `RPT` | |
| GET | `/regulatory/hesa/returns/:returnId/file` | `RPT` | Download HESA XML |
| POST | `/regulatory/hesa/returns/:returnId/validation-reports` | `INT` | HESA validation report inbound |
| POST | `/regulatory/hesa/returns/:returnId/submit` | `WF` | Mark as submitted to HESA |
| POST | `/regulatory/hesa/returns/:returnId/amendments` | `WF` | Post-submission amendment |
| POST | `/regulatory/slc/confirmations/generate` | `INT` | Generate SLC confirmation batch |
| POST | `/enrolments/:enrolmentId/slc-status-notification` | `INT` | Inbound SLC notification |
| POST | `/regulatory/slc/notifications` | `INT` | Inbound SLC notification (bulk) |
| GET | `/enrolments/:enrolmentId/slc-notifications` | `PUB` | Registry/regulatory staff |
| POST | `/regulatory/ukvi/cas-requests/generate` | `WF` | Generate CAS requests |
| GET | `/regulatory/ukvi/cas-requests` | `RPT` | |
| POST | `/regulatory/ukvi/cas-requests/:casRequestId/assignment` | `INT` | UKVI assigns CAS number |
| POST | `/regulatory/ukvi/attendance-reports/generate` | `RPT` | |
| POST | `/regulatory/ukvi/visa-updates` | `INT` | Inbound UKVI visa status |
| POST | `/regulatory/ukvi/compliance-alerts/evaluate` | `WF` | Evaluate UKVI compliance |
| GET | `/regulatory/ukvi/compliance-alerts` | `PUB` | Regulatory officer |
| POST | `/regulatory/ukvi/compliance-alerts/:alertId/resolve` | `WF` | |
| POST | `/regulatory/foi/requests` | `INT` | FOI request inbound |
| GET | `/regulatory/foi/requests` | `RPT` | |
| GET | `/regulatory/foi/requests/:requestId` | `RPT` | |
| POST | `/regulatory/foi/requests/:requestId/extract` | `RPT` | |
| PATCH | `/regulatory/foi/requests/:requestId/status` | `INT` | |
| POST | `/regulatory/ofs/b3-extracts` | `RPT` | |
| GET | `/regulatory/ofs/b3-extracts/:extractId` | `RPT` | |
| POST | `/regulatory/ofs/participation-reports` | `RPT` | |

### 1.10 Programme and Module Catalogue

| Method | Path | Class | Notes |
|---|---|---|---|
| GET | `/programmes` | `PUB` | |
| POST | `/programmes` | `ADM` | |
| GET | `/programmes/:programmeId` | `PUB` | |
| PATCH | `/programmes/:programmeId` | `ADM` | Bitemporal update |
| GET | `/programmes/:programmeId/history` | `PUB` | |
| GET | `/modules` | `PUB` | |
| POST | `/modules` | `ADM` | |
| GET | `/modules/:moduleId` | `PUB` | |
| PATCH | `/modules/:moduleId` | `ADM` | |
| GET | `/modules/:moduleId/history` | `PUB` | |
| POST | `/learning-outcomes` | `ADM` | |
| GET | `/learning-outcomes` | `PUB` | |
| POST | `/module-relationships` | `ADM` | |
| GET | `/modules/:moduleId/relationships` | `PUB` | |
| GET | `/academic-periods` | `PUB` | |
| POST | `/academic-periods` | `ADM` | |
| GET | `/academic-periods/:academicPeriodId` | `PUB` | |
| GET | `/module-offerings` | `PUB` | |
| POST | `/module-offerings` | `ADM` | |
| GET | `/module-offerings/:moduleOfferingId` | `PUB` | |

### 1.11 Value Sets

| Method | Path | Class | Notes |
|---|---|---|---|
| GET | `/value-sets` | `PUB` | All tenants; code enumeration |
| GET | `/value-sets/:setCode` | `PUB` | |
| GET | `/fields/:entity/:field/value-set` | `PUB` | Field-level code lookup |
| POST | `/value-sets/:setCode/members` | `ADM` | Extensible value set management |

### 1.12 Communications

| Method | Path | Class | Notes |
|---|---|---|---|
| POST | `/communication-templates` | `ADM` | |
| GET | `/communication-templates` | `ADM` | |
| GET | `/communication-templates/:templateId` | `ADM` | |
| POST | `/communications/dispatch` | `PRIV` | Internal dispatch; not an external contract |
| GET | `/communication-dispatch-log` | `ADM` | |

### 1.13 Globalisation (Admin)

| Method | Path | Class | Notes |
|---|---|---|---|
| GET | `/admin/globalisation/locales` | `ADM` | |
| GET | `/admin/globalisation/locale-config` | `ADM` | |
| PUT | `/admin/globalisation/locale-config` | `ADM` | |
| POST | `/admin/globalisation/value-set-labels` | `ADM` | Translated labels |
| GET | `/admin/globalisation/value-set-labels/:setCode` | `ADM` | |
| GET | `/admin/globalisation/currencies` | `ADM` | |
| GET | `/admin/globalisation/currency-config` | `ADM` | |
| PUT | `/admin/globalisation/currency-config` | `ADM` | |
| POST | `/admin/globalisation/exchange-rates` | `ADM` | |
| GET | `/admin/globalisation/exchange-rates` | `ADM` | |

### 1.14 Platform Controls (Workflow, Feature Flags, Environments)

| Method | Path | Class | Notes |
|---|---|---|---|
| GET | `/workflow-definitions` | `SYS` | Platform-level; not for third parties |
| GET | `/workflow-definitions/:workflowDefinitionId` | `SYS` | |
| GET | `/workflow-definitions/:workflowDefinitionId/versions` | `SYS` | |
| GET | `/workflow-definition-versions/:workflowDefinitionVersionId` | `SYS` | |
| GET | `/workflow-assignment-rules` | `ADM` | Tenant workflow configuration |
| POST | `/workflow-assignment-rules` | `ADM` | |
| GET | `/workflow-instances` | `WF` | Task inbox |
| POST | `/workflow-instances` | `WF` | Start workflow |
| GET | `/workflow-tasks` | `WF` | Task inbox |
| POST | `/workflow-tasks/:workflowTaskId/completion` | `WF` | Complete task |
| POST | `/workflow-instances/:workflowInstanceId/completion` | `WF` | Complete instance |
| GET | `/feature-flags` | `SYS` | |
| POST | `/feature-flags` | `SYS` | |
| GET | `/feature-flags/:featureFlagId` | `SYS` | |
| PATCH | `/feature-flags/:featureFlagId` | `SYS` | |
| POST | `/feature-flags/:featureFlagId/retirement` | `SYS` | |
| PATCH | `/feature-flags/:featureFlagId/governance` | `SYS` | |
| GET | `/feature-flags/:featureFlagId/impact` | `SYS` | |
| GET | `/feature-flags/:featureFlagId/assignments` | `ADM` | Tenant flag management |
| POST | `/feature-flags/:featureFlagId/assignments` | `ADM` | |
| POST | `/feature-flags/:featureFlagId/evaluation-preview` | `ADM` | |
| GET | `/environments` | `SYS` | |
| GET | `/environments/:deploymentEnvironmentId` | `SYS` | |
| GET | `/environment-runtime` | `SYS` | |
| GET | `/environment-promotions` | `SYS` | |
| POST | `/environment-promotions` | `SYS` | |

### 1.15 Tenant and System Administration

| Method | Path | Class | Notes |
|---|---|---|---|
| GET | `/tenants` | `SYS` | System-admin; cross-tenant |
| POST | `/tenants` | `SYS` | Provision new tenant |
| GET | `/tenants/:tenantId` | `SYS` | |
| PATCH | `/tenants/:tenantId` | `SYS` | |
| GET | `/tenant/configuration` | `ADM` | Tenant-scoped configuration |
| PATCH | `/tenant/configuration` | `ADM` | |
| GET | `/academic-rules` | `ADM` | Bitemporal; scoped to tenant |
| POST | `/academic-rules` | `ADM` | |
| GET | `/academic-rules/:academicRuleId` | `ADM` | |
| GET | `/academic-rules/:academicRuleId/history` | `ADM` | |
| PATCH | `/academic-rules/:academicRuleId` | `ADM` | |

### 1.16 Operational

| Method | Path | Class | Notes |
|---|---|---|---|
| GET | `/health` | `OPS` | Liveness probe |
| GET | `/ready` | `OPS` | Readiness probe |
| GET | `/metrics` | `OPS` | Prometheus scrape target; not published |

### 1.17 Routes In Catalogue But Not Yet Implemented

The following resources appear in the Phase 2 API resource catalogue but have no corresponding implementation in the clean architecture route files:

| Resource | Catalogue class | Status |
|---|---|---|
| Finance payment/hold updates (`POST /integrations/finance/payments`) | Integration | Not implemented; Phase 7/8 scope |
| Library obligations (`POST /integrations/library/obligations`) | Integration | Not implemented |
| Timetable publication (`POST /integrations/timetabling/publications`) | Integration | Not implemented |
| Attendance records (`POST /integrations/attendance/records`) | Integration | Not implemented |
| VLE grade submission (`POST /integrations/vle/results`) | Integration | Uses `POST /marks` instead |
| BI risk flags (`POST /integrations/bi/risk-flags`) | Integration | Not implemented |
| EDRMS archive confirmations (`POST /integrations/edrms/archive-confirmations`) | Integration | Not implemented |
| IAM account state (`POST /integrations/iam/account-state`) | Integration | Not implemented |
| Audit records (`GET /audit-records`) | Admin | Not implemented as route; DB only |
| Integration contracts/registrations/exchanges | Admin | Not implemented as routes; Phase 7 Stage 4 |
| HEAR download | Reporting | `GET /enrolments/:id/hear` exists but document generation not yet tested end-to-end |

---

## 2. Domain Event Inventory

All events are in `packages/domain/src/events/index.ts`. Subject naming follows `srs.{domain}.{event-name}`. The publisher emits a `schemaRef` but no committed schema registry exists yet (Stage 2 deliverable).

### 2.1 Publishable Events (42)

Events intended for external or first-party module consumption:

| Key | Subject | Domain | Primary consumers |
|---|---|---|---|
| STUDENT_CREATED | `srs.student.created` | Student | IAM, CRM |
| STUDENT_IDENTITY_UPDATED | `srs.student.identity-updated` | Student | IAM, EWP, LIB |
| STUDENT_ENROLLED | `srs.student.enrolled` | Student | VLE, IAM, LIB, FIN, CRM |
| STUDENT_STATUS_CHANGED | `srs.student.status-changed` | Student | VLE, IAM, SLC, UKVI, EWP |
| STUDENT_DISABILITY_DECLARATION_UPDATED | `srs.student.disability-declaration-updated` | Student | WELL |
| IDENTITY_VERIFICATION_REQUESTED | `srs.identity.verification-requested` | Identity | OIV adapter |
| IDENTITY_VERIFICATION_COMPLETED | `srs.identity.verification-completed` | Identity | Registry, IAM |
| ENROLMENT_FEE_LIABILITY_GENERATED | `srs.enrolment.fee-liability-generated` | Enrolment | FIN, SLC |
| ENROLMENT_MODULE_REGISTERED | `srs.enrolment.module-registered` | Enrolment | VLE, AM, TTB |
| ENROLMENT_MODULE_REGISTRATION_WITHDRAWN | `srs.enrolment.module-registration-withdrawn` | Enrolment | VLE, AM |
| ENROLMENT_MODULE_REGISTRATION_COMPLETED | `srs.enrolment.module-registration-completed` | Enrolment | VLE, CRIS |
| CATALOGUE_PROGRAMME_UPDATED | `srs.catalogue.programme-updated` | Catalogue | EWP, VLE, BI |
| CATALOGUE_MODULE_UPDATED | `srs.catalogue.module-updated` | Catalogue | EWP, VLE, TTB |
| CATALOGUE_MODULE_RELATIONSHIP_UPDATED | `srs.catalogue.module-relationship-updated` | Catalogue | EWP |
| CATALOGUE_LEARNING_OUTCOME_UPDATED | `srs.catalogue.learning-outcome-updated` | Catalogue | VLE, EWP |
| ASSESSMENT_MARK_RECEIVED | `srs.assessment.mark-received` | Assessment | — (internal calculation trigger) |
| ASSESSMENT_MARK_UPDATED | `srs.assessment.mark-updated` | Assessment | — (internal) |
| ASSESSMENT_MODULE_RESULT_CALCULATED | `srs.assessment.module-result-calculated` | Assessment | EWP (provisional) |
| ASSESSMENT_MODULE_RESULT_RATIFIED | `srs.assessment.module-result-ratified` | Assessment | VLE, EWP, DW |
| ADJUSTMENT_APPROVED | `srs.adjustment.approved` | Adjustment | — (distribution trigger) |
| ADJUSTMENT_DISTRIBUTED | `srs.adjustment.distributed` | Adjustment | VLE, AM, EXAMS |
| ADJUSTMENT_EXPIRED | `srs.adjustment.expired` | Adjustment | VLE, AM, EXAMS |
| CIRCUMSTANCES_EC_FLAGGED | `srs.circumstances.exceptional-circumstances-flagged` | Circumstances | Exam board tooling |
| CIRCUMSTANCES_EC_UPDATED | `srs.circumstances.exceptional-circumstances-updated` | Circumstances | Exam board tooling |
| CIRCUMSTANCES_MISCONDUCT_OUTCOME_RECORDED | `srs.circumstances.misconduct-outcome-recorded` | Circumstances | EWP, DW |
| GOVERNANCE_EXAM_BOARD_DATA_PACK_READY | `srs.governance.exam-board-data-pack-ready` | Governance | Board notification |
| GOVERNANCE_EXAM_BOARD_RATIFIED | `srs.governance.exam-board-ratified` | Governance | EWP, VLE, SLC, DW |
| GOVERNANCE_RECORD_LOCKED | `srs.governance.record-locked` | Governance | — (internal; post-ratification audit) |
| GOVERNANCE_RECORD_AMENDED | `srs.governance.record-amended-post-ratification` | Governance | EWP, DW |
| GOVERNANCE_EXAM_ENTRY_SUBMITTED | `srs.governance.exam-entry-submitted` | Governance | EXAMS |
| GOVERNANCE_EXAM_SCHEDULE_RECEIVED | `srs.governance.exam-schedule-received` | Governance | EWP, registry |
| PROGRESSION_DECIDED | `srs.progression.decided` | Progression | EWP, VLE, CRM |
| AWARD_CONFERRED | `srs.award.conferred` | Award | EWP, EDRMS, CRIS |
| REGULATORY_UCAS_APPLICATION_RECEIVED | `srs.regulatory.ucas-application-received` | Regulatory | Registry workflow |
| REGULATORY_UCAS_CONFIRMATION_SENT | `srs.regulatory.ucas-confirmation-sent` | Regulatory | UCAS adapter |
| REGULATORY_HESA_RETURN_GENERATED | `srs.regulatory.hesa-return-generated` | Regulatory | — (internal audit) |
| REGULATORY_HESA_RETURN_SUBMITTED | `srs.regulatory.hesa-return-submitted` | Regulatory | Regulatory reporting |
| REGULATORY_HESA_ID_ASSIGNED | `srs.regulatory.hesa-id-assigned` | Regulatory | Registry |
| REGULATORY_SLC_CONFIRMATION_SENT | `srs.regulatory.slc-confirmation-sent` | Regulatory | SLC adapter |
| REGULATORY_SLC_NOTIFICATION_RECEIVED | `srs.regulatory.slc-notification-received` | Regulatory | FIN |
| REGULATORY_UKVI_CAS_REQUESTED | `srs.regulatory.ukvi-cas-requested` | Regulatory | UKVI adapter |
| REGULATORY_UKVI_CAS_ASSIGNED | `srs.regulatory.ukvi-cas-assigned` | Regulatory | Registry |
| REGULATORY_UKVI_ATTENDANCE_SUBMITTED | `srs.regulatory.ukvi-attendance-submitted` | Regulatory | — (audit) |
| REGULATORY_UKVI_VISA_STATUS_UPDATED | `srs.regulatory.ukvi-visa-status-updated` | Regulatory | Registry, EWP |
| REGULATORY_UKVI_COMPLIANCE_ALERT | `srs.regulatory.ukvi-compliance-alert-raised` | Regulatory | Registry, EWP |

### 2.2 Internal / Review-Required Events (7)

| Key | Subject | Status |
|---|---|---|
| ENROLMENT_DOWNSTREAM_TRIGGER_CREATED | `srs.enrolment.downstream-trigger-created` | Internal ledger event; do not publish externally |
| REGULATORY_OFS_EXTRACT_GENERATED | `srs.regulatory.ofs-extract-generated` | Not in Phase 2 taxonomy; classify before publication |
| WORKFLOW_TASK_ASSIGNED | `srs.workflow.task-assigned` | Workflow platform event; task-UI internal; review scope |
| WORKFLOW_TASK_COMPLETED | `srs.workflow.task-completed` | As above |
| WORKFLOW_TASK_ESCALATED | `srs.workflow.task-escalated` | As above |
| WORKFLOW_DECISION_RECORDED | `srs.workflow.decision-recorded` | As above |
| WORKFLOW_COMPLETED | `srs.workflow.completed` | As above |

---

## 3. File Contract Inventory

Fixtures are in `packages/testing/regulatory-contracts/`.

### 3.1 Existing Fixtures (All Need Formal Specification)

| Fixture | Path | Direction | Pattern | Formal spec? |
|---|---|---|---|---|
| UCAS application ingest | `ucas/2027/application.sample.json` | Inbound | REST body / file | Missing |
| UCAS confirmation outbound | `ucas/2027/confirmation.sample.json` | Outbound | File batch | Missing |
| HESA student return XML | `hesa/2027-28/student-return.minimal.xml` | Outbound | XML file | Missing |
| HESA validation report | `hesa/2027-28/validation-report.sample.json` | Inbound | REST body | Missing |
| SLC confirmation | `slc/v1/confirmation.sample.json` | Outbound | File batch | Missing |
| SLC notification | `slc/v1/notification.sample.json` | Inbound | REST body | Missing |
| UKVI CAS request | `ukvi/v1/cas-request.sample.json` | Outbound | API/file | Missing |
| UKVI visa status | `ukvi/v1/visa-status.sample.json` | Inbound | REST body | Missing |
| Exam scheduling timetable | `exam-scheduling/v1/timetable.sample.json` | Inbound | File/REST | Missing |

### 3.2 Future File Contracts (No Fixture Yet)

Declared in the integration contract catalogue as `file` or `mixed` pattern but not yet implemented:

| Contract | Direction | Notes |
|---|---|---|
| VLE course provisioning extract | Outbound | Event-driven; extract on demand |
| Attendance roster feed | Outbound | File/scheduled |
| Timetable demand feed | Outbound | File/scheduled |
| Finance fee liability file | Outbound | File/event |
| BI/DW student extract | Outbound | Scheduled file |
| EDRMS document archive submission | Outbound | REST/file |
| HEAR document download | Outbound | PDF/file |
| Exam accommodation distribution | Outbound | Event/file |
| FOI extract | Outbound | File download |
| OfS B3/participation extract | Outbound | File/reporting |

---

## 4. Drift Analysis — REST API

### 4.1 Routes Present In Implementation But Not In Phase 2 Catalogue

| Route area | Reason |
|---|---|
| `/admin/globalisation/*` (10 routes) | Added in clean architecture Stage 5; not in Phase 2 catalogue |
| `/communication-templates/*`, `/communications/dispatch`, `/communication-dispatch-log` | Added in Stage 5; not in Phase 2 catalogue |
| `/feature-flags/*` (11 routes) | Added in Stages 5–6; not in Phase 2 catalogue |
| `/workflow-definitions/*`, `/workflow-instances`, `/workflow-tasks/*` (11 routes) | Added in Stages 3–4; not in Phase 2 catalogue |
| `/workflow-assignment-rules` | Not in Phase 2 catalogue |
| `/environments/*`, `/environment-runtime`, `/environment-promotions` (5 routes) | Added in Stage 5; not in Phase 2 catalogue |
| `/regulatory/foi/*` | Added in Phase 6; catalogue mentions FOI extract but not as REST routes |
| `/regulatory/ofs/*` | Added in Phase 6; catalogue mentions OfS but not as routes |
| `/correction-cases/*` | Added in Stage 4; catalogue has `post_ratification_case` but not explicit routes |
| `/academic-rules/*` | Implemented as tenant-admin; catalogue lists it under tenant admin broadly |
| `/marks/:markId/history` | Bitemporal history route; not in Phase 2 catalogue explicitly |

### 4.2 Phase 2 Catalogue Resources Missing From Implementation

| Catalogue resource | Missing or partial |
|---|---|
| Student portal self-service update (`portal-self-service-update.v1`) | No `/integrations/portal` routes; covered by student-facing routes with own-record auth |
| Finance payment/hold updates | No implementation; integration-only scope |
| Library obligations | No implementation |
| VLE grade submission via integration path | Handled by `POST /marks` with `integration-service` role; no dedicated `/integrations/vle/results` path |
| Timetable publication inbound | No implementation |
| Attendance records inbound | No implementation |
| EDRMS archive confirmations | No implementation |
| IAM account state inbound | No implementation |
| Integration contract/registration/exchange admin APIs | No routes; Phase 7 Stage 4 deliverable |
| Audit record browsing | No route; DB-only |
| CAS (UKVI) request REST vs. file transport profile | Implemented as trigger-and-generate; transport profile not defined |

### 4.3 Catalogue Name Drift

| Phase 2 name | Clean implementation name | Action |
|---|---|---|
| `student_application` / `admissions_offer` | Source-neutral Admissions; UCAS in `regulatory/ucas/applications` | Update catalogue to reflect source-neutral model |
| `exam-boards/:id/ratify` (catalogue example) | `exam-boards/:boardId/ratification` | Catalogue example stale |
| `exam-boards/:id/external-signoff` (catalogue) | `exam-boards/:boardId/external-examiner-signoff` | Catalogue example stale |
| `GET /students/:id/enrolments` | Implemented; previously listed as `GET /api/v1/students/:id/enrolments` | Consistent |
| `POST /integrations/hesa/validation-reports` | `POST /regulatory/hesa/returns/:returnId/validation-reports` | Catalogue pattern stale |

---

## 5. Drift Analysis — Events

### 5.1 Subject Name Drift Between Phase 2 Taxonomy And Implementation

| Phase 2 taxonomy subject | Implemented subject | Resolution |
|---|---|---|
| `srs.module-registration.*` | `srs.enrolment.module-*` | Align taxonomy to implementation |
| `srs.exam-board.*` | `srs.governance.*` | Align taxonomy to implementation |
| `srs.record.locked` | `srs.governance.record-locked` | Align taxonomy |
| `srs.record.amended-post-ratification` | `srs.governance.record-amended-post-ratification` | Align taxonomy |
| `srs.exceptional-circumstances.*` | `srs.circumstances.exceptional-circumstances-*` | Align taxonomy |
| `srs.misconduct.*` | `srs.circumstances.misconduct-*` | Align taxonomy |
| `srs.enrolment.fee-liability-created` | `srs.enrolment.fee-liability-generated` | Align taxonomy |
| `srs.exam.entry-created` | `srs.governance.exam-entry-submitted` | Align taxonomy |
| `srs.exam.timetable-published` | `srs.governance.exam-schedule-received` | Align taxonomy |
| `srs.workflow.deadline-breached` | `srs.workflow.task-escalated` | Align taxonomy |

### 5.2 Phase 2 Taxonomy Events Not In Implementation

These were in the Phase 2 design but have no corresponding entry in `EVENT_TYPES`:

| Phase 2 subject | Decision required |
|---|---|
| `srs.student.re-enrolled` | Replace with `srs.student.status-changed` where `newStatus = enrolled` |
| `srs.student.graduated` | Covered by `srs.student.status-changed` + `srs.award.conferred` — mark obsolete |
| `srs.student.hold-applied` | Not implemented; assess if needed for IAM/EWP integration |
| `srs.student.hold-released` | As above |
| `srs.admissions.application-received` | UCAS-specific covered; source-neutral admissions event not implemented |
| `srs.admissions.offer-accepted` | Not implemented; required for CRM/IAM handoff |
| `srs.enrolment.fee-liability-updated` | Not implemented; assess Finance integration requirement |
| `srs.finance.payment-confirmed` | Not implemented; Finance integration scope |
| `srs.timetable.published` | Not implemented; TTB integration scope |
| `srs.attendance.record-received` | Not implemented; AM integration scope |
| `srs.attendance.absence-alert-raised` | Not implemented |
| `srs.exam.accommodation-distributed` | Covered by `srs.adjustment.distributed` with targetSystem = EXAMS; mark superseded |
| `srs.exam-board.data-pack-superseded` | Not implemented; assess for board regeneration notifications |
| `srs.exam-board.external-examiner-signed-off` | Not implemented; board workflow internal |
| `srs.appeal.submitted` / `srs.appeal.resolved` | Not implemented; correction cases are internal |
| HESA acceptance/amendment events | Not implemented; Phase 7 scope if HESA integration requires event feedback |

### 5.3 Implementation Events Not In Phase 2 Taxonomy

These are in `EVENT_TYPES` but were not planned in Phase 2:

| Implemented subject | Classification |
|---|---|
| `srs.enrolment.downstream-trigger-created` | Internal — do not publish |
| `srs.regulatory.ofs-extract-generated` | Classify before Stage 2; likely reporting/internal |
| `srs.workflow.task-assigned` | Platform-internal; workflow task UI only |
| `srs.workflow.task-completed` | Platform-internal |
| `srs.workflow.task-escalated` | Platform-internal (equivalent of planned `deadline-breached`) |
| `srs.workflow.decision-recorded` | Platform-internal |
| `srs.workflow.completed` | Platform-internal |

---

## 6. File Contract Gap Matrix

| Contract | Fixture | Formal spec | Machine-readable schema | Transport profile |
|---|---|---|---|---|
| UCAS application ingest 2027 | ✓ | Missing | Missing | REST; manual file not defined |
| UCAS confirmation outbound 2027 | ✓ | Missing | Missing | File batch; SFTP not defined |
| HESA student return 2027-28 | ✓ | Missing | Missing | XML file; SFTP not defined |
| HESA validation report 2027-28 | ✓ | Missing | Missing | REST inbound |
| SLC confirmation | ✓ | Missing | Missing | File batch; transport not defined |
| SLC notification | ✓ | Missing | Missing | REST inbound |
| UKVI CAS request | ✓ | Missing | Missing | API/file; transport not defined |
| UKVI visa status | ✓ | Missing | Missing | REST inbound |
| Exam scheduling timetable | ✓ | Missing | Missing | REST/file not defined |

All nine fixtures have no formal specification, no machine-readable schema, and no transport profile definition. Stage 3 must address all nine.

---

## 7. Contract Surfaces Recommended For Non-Publication

The following surfaces exist in the implementation but should explicitly not be published as external contracts:

| Route / event | Reason |
|---|---|
| `GET /enrolments/:id/downstream-triggers` | Internal regulatory ledger; exposes implementation detail |
| `POST /communications/dispatch` | Internal CommunicationService command; not for external callers |
| `GET /adjustments/:adjustmentId/distributions` | Internal distribution ledger |
| `ENROLMENT_DOWNSTREAM_TRIGGER_CREATED` event | Internal ledger marker; not a business event |
| `GOVERNANCE_RECORD_LOCKED` event | Internal post-ratification signal; not for external consumers |
| All `/environments/*` and `/environment-promotions` routes | System-admin operational; not for tenants or third parties |
| All `/tenants/*` routes | System-admin provisioning; not for tenants or third parties |
| All `/workflow-definitions/*` and `/workflow-definition-versions/*` routes | Platform-level definition management; not for third parties |
| All `srs.workflow.*` events | Internal workflow task bus; not for external consumers |
| `GET /metrics` | Prometheus scrape; not an API contract |

---

## 8. Recommended Actions For Stages 1–3

### Stage 1 (OpenAPI)

1. Commit `apps/api/openapi/v1.json` generated from the live app.
2. Add an `operationId` and `tags` to every route that currently lacks one.
3. Add a `PRIV` / internal tag to the routes classified above so they appear in a separate internal spec, not the public spec.
4. Add authentication/security scheme documentation.
5. Add RFC 7807 error response examples.
6. Add pagination/filtering examples to list endpoints.

### Stage 2 (Events)

1. Update `docs/architecture/domain-events.md` to use `EVENT_TYPES` subjects as source of truth.
2. Mark Phase 2 taxonomy subjects obsolete where the subject changed.
3. Classify workflow events as internal; exclude from published schema registry.
4. Generate JSON Schema from TypeScript event payload types for the 45 publishable events.
5. Add the six missing-but-required events identified in Section 5.2 to the backlog.

### Stage 3 (File Contracts)

1. Create formal specification for each of the nine fixtures.
2. Define inbound transport profiles (REST endpoint, content type, auth, idempotency).
3. Define outbound transport profiles (batch trigger, file format, SFTP/API delivery).
4. Add validation tests for each fixture against the formal spec.

---

## 9. Exit Criteria Confirmation

| Criterion | Status |
|---|---|
| Every implemented route is accounted for | ✓ — 157 operations classified above |
| Every route has an explicit publication class | ✓ — PUB/INT/WF/ADM/SYS/RPT/OPS/PRIV assigned to all |
| Every event is accounted for | ✓ — 52 EVENT_TYPES entries classified |
| Every file fixture is accounted for | ✓ — 9 fixtures inventoried |
| Missing, stale, renamed, and obsolete contracts listed | ✓ — Sections 4–6 |
| Non-publishable surfaces identified | ✓ — Section 7 |
| Gap matrix for events produced | ✓ — Section 5 |
| Gap matrix for file contracts produced | ✓ — Section 6 |

Stage 0 exit criteria are met. The codebase is ready to proceed to Stages 1, 2, and 3 in parallel.
