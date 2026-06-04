# Data Subject Coverage Matrix

> Status: Draft — Phase 2 remediation close-out
> Last updated: 2026-06-04
> Purpose: Reconcile the expanded data model with `docs/requirements/data-subject-register.md`.

## Coverage Matrix

| Data model entities | Data subject register category | Classification | Coverage status / action |
|---|---|---|---|
| `person`, `person_identity`, `student_address`, `student_contact_method` | 1. Student Identity Data | Standard Personal / Special Category for ethnicity | Covered; contact methods and address history are explicit data-model refinements. |
| `identity_verification_check` | 1. Student Identity Data | Sensitive Personal | Covered as identity verification records; fraud flag should be upgraded from Standard to Sensitive in next register update. |
| `student_application`, `admissions_offer`, `ucas_exchange_record` | 2. Admissions Data | Standard Personal / Regulatory | Covered; add UCAS exchange state explicitly to the register. |
| `programme`, `module`, `academic_period`, `module_offering`, `programme_route`, `module_relationship`, `learning_outcome`, `assessment_pattern`, `programme_rule_set` | Not personal data unless linked to a student | Standard/configuration | No data-subject entry required except when included in student records/returns. |
| `enrolment`, `module_registration`, `reenrolment_confirmation` | 3. Enrolment and Registration Data | Standard Personal | Covered. |
| `fee_liability`, `payment_confirmation`, `student_hold`, `student_obligation`, `slc_entitlement`, `slc_payment_status` | 6. Financial Data | Sensitive Personal / Regulatory | Mostly covered; add generic obligations and SLC payment status explicitly. |
| `timetabled_activity`, `student_timetable_entry` | 3. Enrolment and Registration Data / 10. Attendance and Engagement Data | Standard Personal | Student timetable entries should be added explicitly. |
| `attendance_record`, `absence_alert`, `engagement_summary` | 10. Attendance and Engagement Data | Sensitive Personal / Regulatory where UKVI-relevant | Covered; add engagement summary explicitly. |
| `assessment_submission`, `assessment_component`, `mark`, `module_result`, `progression_decision`, `award` | 4. Academic Records | Sensitive Personal | Covered; assessment submission context should be added explicitly. |
| `exam_entry`, `exam_candidate`, `exam_timetable_entry`, `exam_accommodation_distribution` | 4. Academic Records / 7. Disability and Health Data | Sensitive / Special Category where accommodation-derived | Add exam candidate number, seating, and accommodation distribution explicitly. |
| `exam_board`, `exam_board_data_pack`, `exam_board_candidate_profile`, `exam_board_member_attendance`, `external_examiner_signoff` | 4. Academic Records | Sensitive Personal | Covered broadly; add board pack snapshots and member attendance explicitly. |
| `post_ratification_case`, `post_ratification_amendment` | 4. Academic Records | Sensitive Personal | Add appeal/correction case data explicitly. |
| `disability_declaration`, `reasonable_adjustment`, `adjustment_distribution` | 7. Disability and Health Data | Special Category | Covered; add distribution state as a processing activity. |
| `exceptional_circumstances`, `exceptional_circumstances_board_visibility` | 8. Exceptional Circumstances Data | Sensitive / Special Category where evidence or reason reveals health | Covered; add board visibility history explicitly. |
| `misconduct_case_reference`, `misconduct_outcome`, `misconduct_penalty_effect` | 9. Academic Misconduct Data | Sensitive Personal | Covered; add external case reference and structured penalty effect explicitly. |
| `hesa_return`, `hesa_submission`, `hesa_validation_issue`, `hesa_identifier_assignment` | 1, 3, 4, and regulatory processing | Regulatory / Personal / Sensitive depending fields | Add statutory return artefacts, validation issues, and submission state explicitly. |
| `cas_request`, `cas_assignment`, `visa_status`, `ukvi_compliance_case`, `sponsor_evidence_record` | 11. Immigration and Visa Data | Sensitive Personal / Regulatory | Covered; add sponsor evidence record explicitly. |
| `staff_assignment`, `research_milestone` | 5. Research Degree Data / 13. Staff Assignment Data | Standard/Sensitive Personal | Covered; module tutor assignment should be added explicitly. |
| `student_document`, `document_archive_confirmation` | 4. Academic Records / 14. System and Audit Data | Personal/Sensitive depending document | Add EDRMS archive confirmation and access-log reference explicitly. |
| `student_risk_flag`, `data_quality_issue` | 10. Attendance and Engagement Data / 14. System and Audit Data | Sensitive Personal | Risk flags covered partially; data quality issues should be added explicitly where student-identifiable. |
| `account_access_state` | 14. System and Audit Data | Sensitive Personal | Covered conceptually by authentication/account logs; add IAM account state explicitly. |
| `policy_publication_notice` | Regulatory/policy metadata | Standard/regulatory; personal only if targeted at identifiable cohorts | Add where notices are annotated against student records. |
| `integration_contract`, `integration_registration`, `integration_exchange`, `audit_record` | 14. System and Audit Data | Standard/Sensitive depending payload summary | Audit covered; add integration exchange ledger and payload summaries explicitly. |

## Register Updates Required Before Phase 3

1. Reclassify identity verification fraud flags as Sensitive Personal.
2. Add explicit entries for integration exchange ledger payload summaries.
3. Add explicit entries for student timetable entries, exam candidate/seating records, and accommodation distribution.
4. Add statutory return artefacts and validation issue records.
5. Add sponsor evidence records and UKVI compliance artefacts.
6. Add board pack snapshots, appeal/correction cases, and post-ratification amendment records.
7. Add EDRMS archive confirmations and external access-log references.

## Phase 3 Acceptance Criteria

- Every new data-model entity has either a data-subject-register row or a documented "not personal data" rationale.
- Every `special-category` and `sensitive` table has read-audit behavior defined.
- Every integration payload summary avoids storing full special-category payloads unless explicitly justified.
