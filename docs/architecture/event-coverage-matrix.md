# Event Coverage Matrix

> Status: Draft — Phase 2 remediation close-out
> Last updated: 2026-07-27
> Purpose: Ensure every significant SRS state change has a domain event or an explicit no-event rationale.

## Coverage Rules

| Rule | Description |
|---|---|
| Significant state change | A change that affects student status, access, progression, compliance, finance, downstream provisioning, audit, or user-visible records. |
| Internal-only event | Allowed where no external consumer exists, but the event must still support audit, workflow, or internal orchestration. |
| No-event rationale | Allowed for immutable append-only facts consumed only through query APIs or generated artefacts. |

## Matrix

| Data entity / operation | Event subject(s) | Consumers | Notes |
|---|---|---|---|
| `person` created | `srs.student.created` | IAM, CRM | Includes source system/reference. |
| `person_identity`, `student_address`, `student_contact_method` changed | `srs.student.identity-updated` | IAM, EWP, LIB | Payload lists changed fields, minimised for consumers. |
| `disability_declaration` changed | `srs.student.disability-declaration-updated` | WELL | Special-category; payload minimised. |
| `identity_verification_check` requested/completed | `srs.identity.verification-requested`, `srs.identity.verification-completed` | OIV, Registry, IAM | Fraud flag treated as sensitive. |
| `student_application` received | `srs.admissions.application-received`, `srs.regulatory.ucas-application-received` | Admissions workflow, CRM | UCAS-specific event only when source is UCAS. |
| `admissions_offer` accepted | `srs.admissions.offer-accepted` | Registry, FIN, IAM | Offer made/declined remain workflow state unless external consumer appears. |
| `programme`, `programme_route` updated | `srs.catalogue.programme-updated` | EWP, VLE, TTB, BI, DW | Includes effective date. |
| `module`, `assessment_pattern` updated | `srs.catalogue.module-updated` | EWP, VLE, TTB, SETS, BI, DW | Includes effective date. |
| `module_relationship` updated | `srs.catalogue.module-relationship-updated` | EWP, Enrolment | Drives registration/prerequisite validation. |
| `learning_outcome` updated | `srs.catalogue.learning-outcome-updated` | EWP, CM, quality tooling | Add to taxonomy if not already present before implementation. |
| `enrolment` created/confirmed | `srs.student.enrolled` | VLE, IAM, LIB, FIN, CRM, AM, EWP | Triggers downstream provisioning. |
| `enrolment.status_code` changed | `srs.student.status-changed` | VLE, IAM, LIB, FIN, SLC, UKVI, EWP, CRM | Generic lifecycle event for withdrawal/intermission/suspension/graduation. |
| `reenrolment_confirmation` confirmed | `srs.student.re-enrolled` | VLE, IAM, EWP | Lapsed state handled by workflow and `status-changed` if withdrawal follows. |
| `module_registration` created/withdrawn/completed | `srs.module-registration.created`, `srs.module-registration.withdrawn`, `srs.module-registration.completed` | VLE, AM, TTB, SETS, CRIS | Completion is post-ratification. |
| `fee_liability` created/updated | `srs.enrolment.fee-liability-created`, `srs.enrolment.fee-liability-updated` | FIN, SLC | Fee amount is sensitive. |
| `payment_confirmation` received | `srs.finance.payment-confirmed` | EWP, Registry | Source exchange tracked in `integration_exchange`. |
| `student_hold` applied/released | `srs.student.hold-applied`, `srs.student.hold-released` | EWP, IAM | Hold details minimised where sensitive. |
| `student_obligation` changed | No dedicated event initially | EWP via API, Registry | Use hold events if obligation affects access/status; otherwise query API. |
| `timetabled_activity` / `student_timetable_entry` published | `srs.timetable.published` | EWP, AM, VLE | One event per publication batch. |
| `expected_engagement_event` created | `srs.engagement.expected-event.created` | Engagement service, Registry, integration audit | Carries source identity/version and schedule; does not assert attendance or engagement. |
| `engagement_observation` recorded | `srs.engagement.observation.recorded` | Engagement service, Registry, BI | Sensitive, minimised evidence event; source and idempotency controls prevent duplicates. |
| `engagement_observation` corrected | `srs.engagement.observation.corrected` | Engagement service, Registry, BI | Identifies superseded and replacement versions; original evidence remains immutable. |
| Engagement alert raised | `srs.engagement.alert.raised` (planned Increment D) | Personal tutor, Engagement Officer, Registry | Must remain an explainable review prompt, not an automatic adverse decision. |
| `assessment_submission` received | No dedicated event initially | Academic Integrity via context API | Use `srs.assessment.mark-received` when mark is ingested. |
| `mark` received/updated | `srs.assessment.mark-received`, `srs.assessment.mark-updated` | Internal | May feed provisional grade publication if configured. |
| `module_result` calculated/ratified | `srs.assessment.module-result-calculated`, `srs.assessment.module-result-ratified` | EWP, VLE, DW, BI | Ratified event is external-facing. |
| `progression_decision` recorded | `srs.progression.decided` | EWP, VLE, CRM | Only after ratification. |
| `award` conferred | `srs.award.conferred`, `srs.student.graduated` | EWP, EDRMS, CRIS, IAM, CRM | `student.graduated` closes lifecycle. |
| `reasonable_adjustment` approved/expired | `srs.adjustment.approved`, `srs.adjustment.expired` | Internal, VLE, AM, EXAMS | Special-category payload minimised. |
| `adjustment_distribution` succeeds/fails | `srs.adjustment.distributed`, `srs.adjustment.distribution-failed` | Target system, integration dashboard, Registry | One event per target. |
| `exceptional_circumstances` recorded/updated | `srs.exceptional-circumstances.flagged`, `srs.exceptional-circumstances.updated` | Exam Board tooling | Special-category depending on reason/evidence. |
| `misconduct_outcome` recorded/updated | `srs.misconduct.outcome-recorded`, `srs.misconduct.outcome-updated` | EWP, Exam Board tooling, DW | Penalty effects queryable via related table. |
| `exam_entry` created | `srs.exam.entry-created` | EXAMS | Includes assessment component and enrolment. |
| `exam_timetable_entry` / `exam_candidate` published | `srs.exam.timetable-published` | EWP, Registry | One event per student entry or publication batch. |
| `exam_accommodation_distribution` succeeds | `srs.exam.accommodation-distributed` | EXAMS | Also tracked via adjustment distribution where relevant. |
| `exam_board_data_pack` generated/superseded | `srs.exam-board.data-pack-ready`, `srs.exam-board.data-pack-superseded` | Registry, board members | Artefact hash stored in data model. |
| `external_examiner_signoff` recorded | `srs.exam-board.external-examiner-signed-off` | Exam board workflow | Human/governance event. |
| `exam_board` ratified | `srs.exam-board.ratified`, `srs.record.locked` | EWP, VLE, SLC, DW, BI | Record lock event can remain internal. |
| `post_ratification_case` submitted/resolved | `srs.appeal.submitted`, `srs.appeal.resolved` | Registry, EWP, DW | Amendments also emit record amendment. |
| `post_ratification_amendment` written | `srs.record.amended-post-ratification` | EWP, DW | Exact amendment stored append-only. |
| `ucas_exchange_record` outbound confirmation/withdrawal | `srs.regulatory.ucas-enrolment-confirmed`, `srs.regulatory.ucas-withdrawal-notified` | Audit/compliance | Inbound application has its own event. |
| `hesa_return` generated/submitted/accepted/amended | `srs.regulatory.hesa-return-generated`, `srs.regulatory.hesa-return-submitted`, `srs.regulatory.hesa-return-accepted`, `srs.regulatory.hesa-return-amended` | Registry, audit | Status summary updated only after append-only evidence row. |
| `hesa_validation_issue` received | `srs.regulatory.hesa-validation-report-received` | Registry | Issues query via API. |
| `hesa_identifier_assignment` received | `srs.regulatory.hesa-ids-received` | IAM, EWP | Updates `person.hesa_id`. |
| `slc_notification`, `slc_entitlement`, `slc_payment_status` changed | `srs.regulatory.slc-enrolment-confirmed`, `srs.regulatory.slc-status-notified`, `srs.regulatory.slc-entitlement-received`, `srs.regulatory.slc-payment-status-received`, `srs.regulatory.slc-overpayment-notified` | FIN, EWP, Registry | Sensitive/regulatory. |
| `cas_request` assigned/issued | `srs.regulatory.ukvi-cas-created` | EWP | CAS reference sensitive/regulatory. |
| `visa_status` received | `srs.regulatory.ukvi-visa-status-updated` | Registry, UKVI compliance | Sensitive/regulatory. |
| `ukvi_compliance_case` alert/report | `srs.regulatory.ukvi-compliance-alert`, `srs.regulatory.ukvi-sponsor-action-reported` | WELL, Registry, audit | Sponsor evidence retained separately. |
| `account_access_state` received | `srs.iam.account-state-received` | Registry, EWP | Does not override SRS RBAC. |
| `student_document` archived | `srs.edrms.document-archived` | Registry, DPO | Generated event may be added if consumers need it. |
| `student_risk_flag` received | `srs.bi.risk-flag-received` | Personal tutor, Registry | Sensitive; lawful basis required. |
| `data_quality_issue` received | `srs.data-quality.issue-received` | Data administrators | Resolution via API/workflow initially. |
| `staff_assignment` updated | `srs.staff-assignment.updated` | EWP, Registry | Personal data. |
| `research_milestone` recorded | `srs.research.milestone-recorded` | PGR student, Supervisor, Registry | Sensitive academic data. |
| Workflow task assigned/completed/deadline/completed | `srs.workflow.task-assigned`, `srs.workflow.task-completed`, `srs.workflow.deadline-breached`, `srs.workflow.completed` | Notification service, DW | Applies to W001-W012. |

## Phase 3 Acceptance Criteria

- Every event in this matrix has a TypeScript schema and JSON Schema.
- Every event carrying `sensitive`, `special-category`, or `regulatory` data has a minimised payload and classification set in the event envelope.
- Every no-event rationale is reviewed when API resources are designed.
