# API Resource Catalogue

> Status: Draft — Phase 2 remediation close-out
> Last updated: 2026-06-04
> Purpose: Map the expanded data model to REST resources before Phase 3/4 OpenAPI generation.

## Resource Classes

| Class | Meaning |
|---|---|
| Public core API | Used by Student Portal, Admin Portal, or external integrations. |
| Internal service API | Used by first-party modules or internal adapters; authenticated service account only. |
| Workflow API | Human task or workflow action endpoint; implemented as command/action rather than generic CRUD. |
| Reporting/export API | Asynchronous or file/export oriented endpoint. |
| No direct API | Accessed only through parent aggregate, generated artefact, event, or internal repository. |

## Catalogue

| Resource | Entities | Class | Example endpoints | Permissions / notes |
|---|---|---|---|---|
| Students | `person`, `person_identity`, `student_address`, `student_contact_method`, `disability_declaration` | Public core API | `GET /api/v1/students`, `GET /api/v1/students/:id`, `PATCH /api/v1/students/:id` | Own-record access for students; scoped staff access; special-category fields separately permissioned. |
| Student identity verification | `identity_verification_check` | Internal service API / workflow API | `POST /api/v1/students/:id/identity-verification`, `POST /api/v1/integrations/oiv/outcomes` | Registry/service account only. |
| Applications and offers | `student_application`, `admissions_offer`, `ucas_exchange_record` | Public core API / integration API | `GET /api/v1/applications`, `POST /api/v1/applications`, `POST /api/v1/integrations/ucas/applications` | Registry and admissions integrations. |
| Programmes and modules | `programme`, `programme_route`, `module`, `module_relationship`, `learning_outcome`, `assessment_pattern` | Public core API / integration API | `GET /api/v1/programmes`, `GET /api/v1/modules`, `POST /api/v1/integrations/curriculum/catalogue` | Bitemporal query support required. |
| Academic periods and module offerings | `academic_period`, `module_offering` | Public core API | `GET /api/v1/academic-periods`, `GET /api/v1/module-offerings` | Read-heavy; managed by Registry/CM integration. |
| Enrolments | `enrolment`, `reenrolment_period`, `reenrolment_confirmation` | Public core API / workflow API | `GET /api/v1/students/:id/enrolments`, `POST /api/v1/enrolments/:id/withdraw`, `POST /api/v1/enrolments/:id/intermit` | Status changes workflow-managed. |
| Module registrations | `module_registration` | Public core API | `GET /api/v1/enrolments/:id/module-registrations`, `POST /api/v1/module-registrations`, `POST /api/v1/module-registrations/:id/withdrawal` | Student self-service within windows; staff override audited. |
| Fees, payments, holds, obligations | `fee_liability`, `payment_confirmation`, `student_hold`, `student_obligation` | Public core API / integration API | `GET /api/v1/enrolments/:id/fee-liabilities`, `POST /api/v1/integrations/finance/payments`, `POST /api/v1/integrations/library/obligations` | Sensitive; Finance/Library service accounts scoped. |
| Timetable and attendance | `timetabled_activity`, `student_timetable_entry`, `attendance_record`, `absence_alert`, `engagement_summary` | Public core API / integration API | `GET /api/v1/students/:id/timetable`, `POST /api/v1/integrations/timetabling/publications`, `POST /api/v1/integrations/attendance/records` | Attendance sensitive/regulatory where UKVI relevant. |
| Assessment submissions and marks | `assessment_submission`, `assessment_component`, `mark`, `module_result` | Public core API / integration API | `POST /api/v1/integrations/vle/results`, `GET /api/v1/module-registrations/:id/results` | Student results only post-publication. |
| Progression and awards | `progression_decision`, `award`, `student_document` | Public core API / workflow/reporting API | `GET /api/v1/students/:id/progression`, `GET /api/v1/students/:id/awards`, `POST /api/v1/awards/:id/documents` | Award documents have artefact/hash metadata. |
| Adjustments and EC | `reasonable_adjustment`, `adjustment_distribution`, `exceptional_circumstances`, `exceptional_circumstances_board_visibility` | Internal service API / public read API | `POST /api/v1/internal/wellbeing/adjustment-outcomes`, `GET /api/v1/students/:id/adjustments` | Special-category; no downstream direct Wellbeing distribution. |
| Academic integrity | `assessment_submission`, `misconduct_case_reference`, `misconduct_outcome`, `misconduct_penalty_effect` | Integration API / public staff API | `GET /api/v1/academic-integrity/context`, `POST /api/v1/integrations/academic-integrity/outcomes` | Sensitive; scoped to active cases and boards. |
| Exams | `exam_entry`, `exam_candidate`, `exam_timetable_entry`, `exam_accommodation_distribution` | Public core API / integration API | `GET /api/v1/students/:id/exams`, `POST /api/v1/integrations/exams/timetable` | Exam accommodations special-category where adjustment-derived. |
| Exam boards | `exam_board`, `exam_board_data_pack`, `exam_board_candidate_profile`, `exam_board_member_attendance`, `external_examiner_signoff` | Workflow API / public staff API | `GET /api/v1/exam-boards/:id/data-pack`, `POST /api/v1/exam-boards/:id/ratify`, `POST /api/v1/exam-boards/:id/external-signoff` | Board roles only; read audit. |
| Appeals and corrections | `post_ratification_case`, `post_ratification_amendment` | Workflow API | `POST /api/v1/appeals`, `POST /api/v1/post-ratification-cases/:id/amendments` | Authorisation trail required. |
| HESA | `hesa_return`, `hesa_submission`, `hesa_validation_issue`, `hesa_identifier_assignment` | Reporting/export API / integration API | `POST /api/v1/hesa-returns`, `POST /api/v1/hesa-returns/:id/submit`, `POST /api/v1/integrations/hesa/validation-reports` | Asynchronous; artefact hash/source transaction time required. |
| SLC | `slc_notification`, `slc_entitlement`, `slc_payment_status` | Integration API / public staff API | `POST /api/v1/integrations/slc/entitlements`, `GET /api/v1/enrolments/:id/slc` | Sensitive/regulatory. |
| UKVI | `cas_request`, `cas_assignment`, `visa_status`, `ukvi_compliance_case`, `sponsor_evidence_record` | Workflow API / integration API | `POST /api/v1/enrolments/:id/cas-requests`, `POST /api/v1/integrations/ukvi/visa-status`, `GET /api/v1/ukvi-compliance-cases` | Sensitive/regulatory; restricted roles. |
| Staff and research | `staff_assignment`, `research_milestone` | Public core API / integration API | `POST /api/v1/integrations/hr/staff-assignments`, `POST /api/v1/integrations/cris/milestones` | Staff assignment visible to students where appropriate. |
| Documents and EDRMS | `student_document`, `document_archive_confirmation` | Public core API / integration API | `GET /api/v1/students/:id/documents`, `POST /api/v1/integrations/edrms/archive-confirmations` | Document access audited where sensitive. |
| Risk and data quality | `student_risk_flag`, `data_quality_issue` | Staff API / integration API | `POST /api/v1/integrations/bi/risk-flags`, `GET /api/v1/data-quality-issues` | Sensitive; lawful basis and scoped access. |
| CMS/ITSM feedback | `policy_publication_notice`, `account_access_state`, `integration_exchange` | Integration API / staff API | `POST /api/v1/integrations/cms/policy-notices`, `POST /api/v1/integrations/iam/account-state` | Regulatory notices may be standard/regulatory. |
| Integration administration | `integration_contract`, `integration_registration`, `integration_exchange` | Admin API | `GET /api/v1/integration-contracts`, `POST /api/v1/integration-registrations`, `GET /api/v1/integration-exchanges` | Tenant admin manages registrations; system admin sees cross-tenant health only. |
| Audit and workflow tasks | `audit_record`, Temporal workflow state | Admin/workflow API | `GET /api/v1/audit-records`, `GET /api/v1/workflow-tasks`, `POST /api/v1/workflow-tasks/:id/complete` | DPO/auditor/admin roles only; sensitive read audit. |

## Phase 3 Acceptance Criteria

- Every public or integration resource has a route schema before implementation.
- Every bitemporal resource supports `validAt` and `recordedAt` where historical reads are meaningful.
- Every integration endpoint requires client credentials and maps to an `integration_registration`.
- Every sensitive/special-category resource declares read-audit behavior.
